import type { AppConfig } from "../../config.js";
import type { Provider } from "../providers/types.js";
import type { ToolRegistry } from "../tools/registry.js";
import type {
  KnowledgeRuntime,
  MemoryRuntime,
  PromptLibraryRuntime,
  SkillRuntime,
  TeamMemberInfo,
  TeamMemberStatus,
  TeamRuntime,
  TodoRuntime,
  ToolContext,
  WebToolsConfig,
  TeamDeliveryResult,
} from "../tools/types.js";
import { createSubAgentRuntime } from "../subagents.js";
import { resolveDefaultSubAgents, mergeDefaultSubAgents } from "../sub-agents/index.js";
import { allowedTeamAgentTools } from "../tools/teamTools.js";
import { createScheduleRuntime } from "../tools/scheduleRuntime.js";
import type { ScheduleStore } from "../../cron/store.js";
import type { ScheduleScheduler } from "../../cron/scheduler.js";
import { isVisionCapableModel } from "../../utils/vision.js";
import type { ConnectorRuntime } from "../connectors/runtime.js";
import type { McpRuntime } from "../mcp/runtime.js";
import { buildLeaderReportReminder, frameMailbox } from "./systemprompt.js";
import { runHeadAgent } from "./head/runner.js";
import { runMemberAgent } from "./members/runner.js";
import {
  EV_AGENT_DONE,
  EV_AGENT_START,
  EV_TEAM_MESSAGE,
  EV_TEAM_START,
  EV_TEAM_STATUS,
  SYSTEM_SENDER_ID,
  USER_SENDER_ID,
  type AgentTeamDefinition,
  type MailboxMessage,
  type TeamAgentContext,
  type TeamMemberDefinition,
  type TeamMessageKind,
} from "./types.js";
import type { TeamAgentStatus } from "../tools/types.js";

/**
 * Safety valves against runaway multi-agent loops (the failure mode that previously froze the app).
 * They cap the TOTAL number of inter-agent messages and the TOTAL number of agent LLM runs across a
 * single turn, so an infinite A->B->A delegation loop cannot generate unbounded tokens/work. They are
 * deliberately high — real collaboration stays well under them — and only trip on pathological loops.
 */
const MAX_TEAM_MESSAGES = 400;
const MAX_AGENT_RUNS = 800;

/**
 * How many times the orchestrator will automatically nudge a single member to report back to the
 * leader for one outstanding delegated task before giving up. Kept small so a member that keeps
 * ignoring the nudge cannot spin the actor forever; the counter resets whenever a fresh task is
 * delegated to that member.
 */
const MAX_LEADER_REPORT_REMINDERS = 2;

/** Runtime state of one team agent (its persistent context + live mailbox + status). */
interface Actor {
  context: TeamAgentContext;
  member?: TeamMemberDefinition;
  mailbox: MailboxMessage[];
  busy: boolean;
  status: TeamAgentStatus;
  subAgentRuntime: ReturnType<typeof createSubAgentRuntime>;
  /**
   * A member has a delegated task outstanding that it has not yet reported to the leader. Set when a
   * task is delegated to it, cleared as soon as it messages the leader. Drives the automatic
   * "inform the team leader" nudge so a member that finishes silently never leaves the leader hanging.
   */
  pendingLeaderReport: boolean;
  /** Auto-nudges sent for the current outstanding task; reset when a fresh task is delegated. */
  leaderReportReminders: number;
}

export interface TeamOrchestratorDeps {
  provider: Provider;
  tools: ToolRegistry;
  config: AppConfig;
  team: AgentTeamDefinition;
  sendMessageToTeamEnabled: boolean;
  /** The persistent per-agent contexts for this chat (loaded/saved by the session store). */
  contexts: Map<string, TeamAgentContext>;
  chatId: string;
  model: string;
  /** Provider id snapshot for schedules created by team agents (resolved from Settings at run). */
  providerId?: string;
  apiKey: string;
  baseUrl?: string;
  temperature?: number;
  effort?: string;
  web: WebToolsConfig;
  /** Optional persistent schedule store + background scheduler for the schedule_* tools. */
  scheduleStore?: ScheduleStore;
  scheduleScheduler?: ScheduleScheduler;
  memory: MemoryRuntime;
  knowledge: KnowledgeRuntime;
  /** The persistent prompt library — lets every team agent (head + members) manage saved prompts. */
  promptLibrary?: PromptLibraryRuntime;
  /** The persistent custom-agents runtime — lets every team agent manage custom agents. */
  customAgents?: import("../tools/types.js").CustomAgentsRuntime;
  /** The persistent custom-system-prompts runtime — lets every team agent manage saved system prompts. */
  customSystemPrompts?: import("../tools/types.js").CustomSystemPromptsRuntime;
  skills: SkillRuntime;
  todos: TodoRuntime;
  subAgentDefinitions: Awaited<ReturnType<typeof resolveDefaultSubAgents>>;
  userSubAgents: import("../tools/types.js").SubAgentDefinition[];
  /** The turn's connector runtime (connected Composio apps), shared by every agent. */
  connectors: ConnectorRuntime;
  /** The turn's MCP runtime (connected MCP servers), shared by every agent. */
  mcp?: McpRuntime;
  /** The persisted MCP manager — lets team agents use the MCP management tools. */
  mcpManager?: import("../mcp/manager.js").McpManager;
  /** The persisted connector manager — lets team agents use the connector management tools. */
  connectorManager?: import("../connectors/manager.js").ConnectorManager;
  /** The messaging-channel manager — lets team agents use the channel_* tools. */
  channelManager?: import("../../channels/manager.js").ChannelManager;
  /** Raw SSE emitter onto the turn buffer. */
  send: (event: string, data: Record<string, unknown>) => void;
  signal: AbortSignal;
  /**
   * Effective context-window limit (tokens) for sub-agent summarization handoff.
   * Absent = handoff disabled (safe).
   */
  contextLimit?: number | null;
  /** Utilization fraction (0..1) that triggers sub-agent summarization (default 90%). */
  summaryThreshold?: number;
  /** Context-management method for team agents ("summarization" default). */
  contextManagementMethod?: string;
  /** Fraction freed per sliding-window trigger (default 0.3). */
  slidingWindowTruncatePercent?: number;
}

/**
 * The multi-agent orchestrator — an actor system. Each team agent (head + members) is a serial actor
 * with a mailbox: it never runs two LLM loops at once, and messages delivered while it is busy are
 * queued and delivered together the next time it is free. The head is seeded with the user's message;
 * agents deliver messages to each other through the team tools; the turn ends when the whole team is
 * quiescent (no agent busy and every mailbox empty) or the run is aborted.
 */
export class TeamOrchestrator {
  private readonly actors = new Map<string, Actor>();
  private readonly leaderId: string;
  private messageCount = 0;
  private runCount = 0;
  private resolveDone: (() => void) | null = null;
  private settled = false;
  private readonly registryNames: string[];
  private readonly visionCapable: boolean;

  constructor(private readonly deps: TeamOrchestratorDeps) {
    this.leaderId = deps.team.leader_name;
    this.registryNames = deps.tools.names();
    this.visionCapable = isVisionCapableModel(deps.model, deps.config);
    this.buildActors();
  }

  /** True while any actor is running or has queued work. */
  private get quiescent(): boolean {
    for (const actor of this.actors.values()) {
      if (actor.busy || actor.mailbox.length > 0) return false;
    }
    return true;
  }

  /** Materialize an Actor per team agent, reusing any persisted context. */
  private buildActors(): void {
    const { team } = this.deps;

    const ensure = (
      id: string,
      role: "leader" | "member",
      description: string,
      systemPrompt: string,
      member?: TeamMemberDefinition,
    ): void => {
      let context = this.deps.contexts.get(id.toLowerCase());
      if (!context) {
        context = { id, role, description, systemPrompt, messages: [] };
        this.deps.contexts.set(id.toLowerCase(), context);
      } else {
        // Keep the latest prompt/description/role (the team definition may have been edited).
        context.role = role;
        context.description = description;
        context.systemPrompt = systemPrompt;
      }
      this.actors.set(id.toLowerCase(), {
        context,
        member,
        mailbox: [],
        busy: false,
        status: "idle",
        subAgentRuntime: this.buildSubAgentRuntime(context),
        pendingLeaderReport: false,
        leaderReportReminders: 0,
      });
    };

    ensure(team.leader_name, "leader", "Team head / leader", team.leader_system_prompt);
    for (const m of team.members) {
      if (!m.name || !m.name.trim()) continue;
      ensure(m.name, "member", m.description, m.system_prompt, m);
    }
  }

  private buildSubAgentRuntime(context: TeamAgentContext): ReturnType<typeof createSubAgentRuntime> {
    return createSubAgentRuntime({
      provider: this.deps.provider,
      tools: this.deps.tools,
      config: this.deps.config,
      chatId: this.deps.chatId,
      definitions: mergeDefaultSubAgents(this.deps.subAgentDefinitions, this.deps.userSubAgents),
      model: this.deps.model,
      apiKey: this.deps.apiKey,
      baseUrl: this.deps.baseUrl,
      temperature: this.deps.temperature,
      effort: this.deps.effort,
      send: this.deps.send,
      connectors: this.deps.connectors.active ? this.deps.connectors : undefined,
      mcp: this.deps.mcp?.active ? this.deps.mcp : undefined,
      getConversationContext: () => context.messages,
      contextLimit: typeof this.deps.contextLimit === "number" ? this.deps.contextLimit : null,
      summaryThreshold: this.deps.summaryThreshold ?? this.deps.config.summaryThreshold ?? 0.9,
      contextManagementMethod: this.deps.contextManagementMethod,
      slidingWindowTruncatePercent: this.deps.slidingWindowTruncatePercent,
    });
  }

  private actor(id: string): Actor | undefined {
    return this.actors.get(id.trim().toLowerCase());
  }

  /**
   * Run the turn to quiescence. Seeds the head with the user's message (prepended with any
   * first-message memory/knowledge context) and resolves when the whole team goes idle or aborts.
   */
  async run(userMessage: string, firstMessageContext: string): Promise<void> {
    // Announce the roster so the UI can pre-render every agent block.
    this.deps.send(EV_TEAM_START, {
      team_id: this.deps.team.id,
      team_name: this.deps.team.name,
      leader_id: this.leaderId,
      send_message_enabled: this.deps.sendMessageToTeamEnabled,
      members: this.rosterInfo(),
    });

    const head = this.actor(this.leaderId);
    if (!head) {
      this.deps.send("error", { code: "no_leader", message: "The team has no head/leader." });
      return;
    }

    const seeded =
      firstMessageContext.trim().length > 0
        ? `${firstMessageContext.trim()}\n\n${userMessage}`
        : userMessage;

    head.mailbox.push({ from: USER_SENDER_ID, message: seeded, kind: "user" });
    this.emitStatus(head);

    const donePromise = new Promise<void>((resolve) => {
      this.resolveDone = resolve;
    });

    const onAbort = () => this.settle();
    if (this.deps.signal.aborted) {
      this.settle();
    } else {
      this.deps.signal.addEventListener("abort", onAbort, { once: true });
      this.schedule(this.leaderId);
    }

    await donePromise;
    this.deps.signal.removeEventListener("abort", onAbort);
  }

  private settle(): void {
    if (this.settled) return;
    this.settled = true;
    this.resolveDone?.();
    this.resolveDone = null;
  }

  private rosterInfo(): TeamMemberInfo[] {
    const info: TeamMemberInfo[] = [];
    for (const actor of this.actors.values()) {
      info.push({
        agent_id: actor.context.id,
        role: actor.context.role,
        description: actor.context.description,
      });
    }
    return info;
  }

  private emitStatus(actor: Actor): void {
    this.deps.send(EV_TEAM_STATUS, {
      agent_id: actor.context.id,
      role: actor.context.role,
      status: actor.status,
      queued: actor.mailbox.length,
    });
  }

  /** Schedule an actor to process its mailbox (no-op if already running). */
  private schedule(id: string): void {
    if (this.deps.signal.aborted) return;
    const actor = this.actor(id);
    if (!actor || actor.busy) return;
    void this.runActor(actor);
  }

  /** Drive one actor: drain its mailbox in batches and run its agentic loop until nothing is left. */
  private async runActor(actor: Actor): Promise<void> {
    actor.busy = true;
    try {
      while (actor.mailbox.length > 0 && !this.deps.signal.aborted) {
        if (this.runCount >= MAX_AGENT_RUNS) {
          this.deps.send("error", {
            code: "team_run_budget_exceeded",
            message: `The team reached the maximum of ${MAX_AGENT_RUNS} agent runs for this turn.`,
          });
          break;
        }
        this.runCount += 1;

        // Deliver EVERYTHING queued so far as one batch (requirement: queued messages arrive
        // together when the agent is next free).
        const batch = actor.mailbox.splice(0, actor.mailbox.length);
        actor.status = "working";
        this.emitStatus(actor);

        const framed = frameMailbox(actor.context.role, actor.context.id, batch);
        actor.context.messages.push({ role: "user", content: framed });

        this.deps.send(EV_AGENT_START, {
          agent_id: actor.context.id,
          role: actor.context.role,
          trigger: this.triggerLabel(batch),
        });

        const result = await this.runOneLoop(actor);
        actor.status = result.ok ? "completed" : "failed";
        this.deps.send(EV_AGENT_DONE, {
          agent_id: actor.context.id,
          role: actor.context.role,
          ok: result.ok,
          status: actor.status,
          error: result.error,
        });

        // Safety net: a member sometimes ends its run without ever calling message_team_leader,
        // leaving the leader waiting forever on a delegated task (delegated work is only "done"
        // once explicitly reported). If that happened — the run succeeded, the task is still
        // outstanding, and nothing new is queued to work on — inject an automatic nudge telling the
        // member to report back. Bounded by MAX_LEADER_REPORT_REMINDERS so it can never loop forever.
        this.maybeNudgeMemberToReport(actor, result);

        // Loop again if new messages arrived while this run was executing.
      }
    } finally {
      actor.busy = false;
      if (actor.mailbox.length === 0 && actor.status === "working") actor.status = "idle";
      this.emitStatus(actor);
      // If more work snuck in after the while-condition check, reschedule; else test for quiescence.
      if (actor.mailbox.length > 0 && !this.deps.signal.aborted) {
        this.schedule(actor.context.id);
      } else if (this.quiescent || this.deps.signal.aborted) {
        this.settle();
      }
    }
  }

  private triggerLabel(batch: MailboxMessage[]): string {
    if (batch.length === 1 && batch[0]!.kind === "user") return "user request";
    if (batch.length === 1 && batch[0]!.kind === "system") return "team-coordination check";
    const froms = [
      ...new Set(
        batch.map((m) =>
          m.from === USER_SENDER_ID
            ? "the user"
            : m.from === SYSTEM_SENDER_ID
              ? "the system"
              : m.from,
        ),
      ),
    ];
    return `${batch.length} message(s) from ${froms.join(", ")}`;
  }

  /**
   * If a member finished a run but still owes the leader a report (it was delegated a task and never
   * messaged the leader), queue an automatic nudge into its own mailbox so it runs again and reports.
   * No-op for the leader, for failed/aborted runs, when the member already has other work queued, or
   * once the per-task reminder budget is spent. The queued nudge keeps the actor non-quiescent, so
   * runActor's loop picks it up on the next pass without any extra scheduling.
   */
  private maybeNudgeMemberToReport(actor: Actor, result: { ok: boolean }): void {
    if (actor.context.role !== "member") return;
    if (!result.ok || this.deps.signal.aborted) return;
    if (!actor.pendingLeaderReport) return;
    if (actor.mailbox.length > 0) return;
    if (actor.leaderReportReminders >= MAX_LEADER_REPORT_REMINDERS) return;

    actor.leaderReportReminders += 1;
    actor.mailbox.push({
      from: SYSTEM_SENDER_ID,
      message: buildLeaderReportReminder(actor.context.id, this.leaderId),
      kind: "system",
    });
    actor.status = "queued";
    this.emitStatus(actor);
  }

  /** Run a single LLM loop for the actor via the head/member runner. */
  private async runOneLoop(actor: Actor) {
    const send = (event: string, data: Record<string, unknown>): void =>
      this.deps.send(event, { agent_id: actor.context.id, role: actor.context.role, ...data });

    const connectors = this.deps.connectors;
    const mcp = this.deps.mcp;
    const allowed = new Set(
      allowedTeamAgentTools(
        this.registryNames,
        actor.context.role,
        this.deps.sendMessageToTeamEnabled,
        connectors.active ? connectors.names() : [],
        mcp?.active ? mcp.names() : [],
      ),
    );
    // Registry schemas for the granted static tools + every connector/MCP tool natively.
    const toolSchemas = [
      ...this.deps.tools.schemasFor([...allowed].filter((name) => this.deps.tools.has(name))),
      ...connectors.schemas().filter((s) => allowed.has(s.function.name)),
      ...(mcp ? mcp.schemas().filter((s) => allowed.has(s.function.name)) : []),
    ];
    const toolCtx = this.buildToolCtx(actor, allowed);

    const connectorSuffix = connectors.active ? `# Connected apps\n- ${connectors.hint()}` : undefined;
    const mcpSuffix = mcp?.active ? `# Connected MCP servers\n- ${mcp.hint()}` : undefined;
    const systemSuffix = [connectorSuffix, mcpSuffix].filter((s): s is string => Boolean(s)).join("\n") || undefined;
    const common = {
      workspaceRoot: this.deps.config.workspaceRoot,
      sendMessageEnabled: this.deps.sendMessageToTeamEnabled,
      messages: actor.context.messages,
      allowedTools: allowed,
      toolSchemas,
      toolCtx,
      connectors: connectors.active ? connectors : undefined,
      mcp: mcp?.active ? mcp : undefined,
      systemSuffix,
      send,
      signal: this.deps.signal,
      provider: this.deps.provider,
      tools: this.deps.tools,
      model: this.deps.model,
      apiKey: this.deps.apiKey,
      baseUrl: this.deps.baseUrl,
      temperature: this.deps.temperature,
      effort: this.deps.effort,
      usageScope: "team" as const,
      providerId: this.deps.providerId,
      contextLimit: typeof this.deps.contextLimit === "number" ? this.deps.contextLimit : null,
      contextManagementMethod: this.deps.contextManagementMethod,
      slidingWindowTruncatePercent: this.deps.slidingWindowTruncatePercent,
    };

    if (actor.context.role === "leader") {
      return runHeadAgent({ ...common, team: this.deps.team });
    }
    return runMemberAgent({
      ...common,
      team: this.deps.team,
      member: actor.member ?? {
        name: actor.context.id,
        description: actor.context.description,
        system_prompt: actor.context.systemPrompt,
      },
    });
  }

  /** Build the tool-execution context for an agent, including its bound team runtime. */
  private buildToolCtx(actor: Actor, allowed: Set<string>): ToolContext {
    return {
      workspaceRoot: this.deps.config.workspaceRoot,
      chatId: this.deps.chatId,
      shellTimeoutMs: this.deps.config.shellTimeoutMs,
      signal: this.deps.signal,
      web: this.deps.web,
      // Each agent gets its own sub-agent runtime (bound to its conversation for context sharing).
      subAgents: actor.subAgentRuntime,
      skills: this.deps.skills,
      todos: this.deps.todos,
      memory: this.deps.memory,
      knowledge: this.deps.knowledge,
      promptLibrary: this.deps.promptLibrary,
      customAgents: this.deps.customAgents,
      customSystemPrompts: this.deps.customSystemPrompts,
      schedules: createScheduleRuntime({
        store: this.deps.scheduleStore,
        scheduler: this.deps.scheduleScheduler,
        agent: { type: "default", provider: this.deps.providerId ?? "", model: this.deps.model },
      }),
      team: this.buildTeamRuntime(actor),
      connectors: this.deps.connectors,
      connectorManager: this.deps.connectorManager,
      mcp: this.deps.mcp ?? undefined,
      mcpManager: this.deps.mcpManager,
      channelManager: this.deps.channelManager,
      model: this.deps.model,
      visionCapable: this.visionCapable,
      availableToolNames: [
        ...this.registryNames,
        ...(this.deps.connectors.active ? this.deps.connectors.names() : []),
        ...(this.deps.mcp ? this.deps.mcp.names() : []),
      ],
      emit: this.deps.send,
    };
  }

  /** The TeamRuntime bound to a specific calling agent (powers the five collaboration tools). */
  private buildTeamRuntime(actor: Actor): TeamRuntime {
    return {
      selfId: actor.context.id,
      isLeader: actor.context.role === "leader",
      leaderId: this.leaderId,
      sendMessageToTeamEnabled: this.deps.sendMessageToTeamEnabled,
      listMembers: () => this.rosterInfo(),
      status: (ids) => this.statusOf(ids),
      deliver: (messages, kind) => this.deliver(actor.context.id, messages, kind),
    };
  }

  private statusOf(ids: string[]): TeamMemberStatus[] {
    const out: TeamMemberStatus[] = [];
    for (const id of ids) {
      const actor = this.actor(id);
      if (!actor) continue;
      out.push({
        agent_id: actor.context.id,
        role: actor.context.role,
        description: actor.context.description,
        status: actor.busy ? "working" : actor.mailbox.length > 0 ? "queued" : actor.status,
        queued_messages: actor.mailbox.length,
      });
    }
    return out;
  }

  /**
   * Deliver messages from one agent to targets: enqueue into each target's mailbox and schedule it.
   * Enforces the message budget. Called synchronously from within a sender's tool execution, so the
   * target's mailbox is non-empty before the sender's run finalizes — keeping quiescence correct.
   */
  private deliver(
    from: string,
    messages: Array<{ agent_id: string; message: string }>,
    kind: TeamMessageKind,
  ): TeamDeliveryResult {
    if (this.messageCount >= MAX_TEAM_MESSAGES) {
      return {
        ok: false,
        delivered: [],
        unknown: [],
        message: "The team collaboration message budget for this turn is exhausted.",
        error: {
          code: "collaboration_budget_exceeded",
          message:
            `The team has exchanged the maximum of ${MAX_TEAM_MESSAGES} messages this turn. ` +
            "Wrap up: finish with your own tools and, if you are the leader, give the user your best final answer.",
        },
      };
    }

    const delivered: string[] = [];
    const unknown: string[] = [];
    for (const { agent_id, message } of messages) {
      const actor = this.actor(agent_id);
      if (!actor) {
        unknown.push(agent_id);
        continue;
      }
      if (this.messageCount >= MAX_TEAM_MESSAGES) {
        unknown.push(agent_id);
        continue;
      }
      this.messageCount += 1;
      actor.mailbox.push({ from, message, kind });
      delivered.push(actor.context.id);

      // Track the member<->leader report obligation that powers the automatic "inform the leader"
      // nudge. Delegating a task to a member opens the obligation (and resets its reminder budget);
      // any message a member delivers TO the leader (a report, an answer, a question) closes it.
      if (kind === "delegate" && actor.context.role === "member") {
        actor.pendingLeaderReport = true;
        actor.leaderReportReminders = 0;
      }
      if (actor.context.id.toLowerCase() === this.leaderId.toLowerCase()) {
        const sender = this.actor(from);
        if (sender && sender.context.role === "member") sender.pendingLeaderReport = false;
      }
      this.deps.send(EV_TEAM_MESSAGE, {
        from,
        to: actor.context.id,
        kind,
        message,
      });
      if (!actor.busy) {
        actor.status = "queued";
      }
      this.emitStatus(actor);
      this.schedule(actor.context.id);
    }

    const parts: string[] = [];
    if (delivered.length > 0) parts.push(`Delivered to: ${delivered.join(", ")}.`);
    if (unknown.length > 0) parts.push(`Unknown agent id(s) skipped: ${unknown.join(", ")}.`);
    return {
      ok: delivered.length > 0,
      delivered,
      unknown,
      message: parts.join(" ") || "No messages delivered.",
      error:
        delivered.length === 0
          ? { code: "no_valid_targets", message: `No matching team member for: ${unknown.join(", ")}.` }
          : undefined,
    };
  }
}
