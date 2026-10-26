import type { AppConfig } from "../../../config.js";
import type { Provider } from "../../providers/types.js";
import type { ToolRegistry } from "../../tools/registry.js";
import type {
  CeoRuntime,
  CeoTeamInfo,
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
  TeamAgentStatus,
} from "../../tools/types.js";
import { createSubAgentRuntime } from "../../subagents.js";
import { resolveDefaultSubAgents, mergeDefaultSubAgents } from "../../sub-agents/index.js";
import { allowedCeoAgentTools } from "../../tools/teamTools.js";
import { createScheduleRuntime } from "../../tools/scheduleRuntime.js";
import type { ScheduleStore } from "../../../cron/store.js";
import type { ScheduleScheduler } from "../../../cron/scheduler.js";
import { isVisionCapableModel } from "../../../utils/vision.js";
import type { ConnectorRuntime } from "../../connectors/runtime.js";
import type { McpRuntime } from "../../mcp/runtime.js";
import { buildLeaderReportReminder, frameMailbox } from "../systemprompt.js";
import { runHeadAgent } from "../head/runner.js";
import { runMemberAgent } from "../members/runner.js";
import { runCeoAgent } from "./runner.js";
import { buildCeoReportReminder, frameCeoMailbox, frameCeoTaskPrompt } from "./systemprompt.js";
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
  type TeamMemberDefinition,
  type TeamMessageKind,
} from "../types.js";
import type { CeoActorRole, CeoAgentContext, CeoAgentDefinition } from "./types.js";

/**
 * Safety valves against runaway multi-agent loops (identical philosophy to the team orchestrator, but
 * scaled up because a CEO system runs several teams at once). They cap the TOTAL number of inter-agent
 * messages and the TOTAL number of agent LLM runs across a single turn, so a pathological
 * CEO->leader->member->leader->CEO loop cannot generate unbounded work. They are deliberately high —
 * real collaboration stays well under them.
 */
const MAX_CEO_MESSAGES = 800;
const MAX_AGENT_RUNS = 1600;

/** How many times a member/leader is auto-nudged to report back for one outstanding task. */
const MAX_REPORT_REMINDERS = 2;

/** Runtime state of one agent inside the CEO system (CEO, a team head/leader, or a team member). */
interface CeoActor {
  context: CeoAgentContext;
  role: CeoActorRole;
  /** The team this leader/member belongs to (undefined for the CEO). */
  team?: AgentTeamDefinition;
  /** The member definition (for members only). */
  member?: TeamMemberDefinition;
  mailbox: MailboxMessage[];
  busy: boolean;
  status: TeamAgentStatus;
  subAgentRuntime: ReturnType<typeof createSubAgentRuntime>;
  /** A member owes its team leader a report for an outstanding delegated task. */
  pendingLeaderReport: boolean;
  leaderReportReminders: number;
  /** A team leader owes the CEO a report for an outstanding CEO-assigned task. */
  pendingCeoReport: boolean;
  ceoReportReminders: number;
}

export interface CeoOrchestratorDeps {
  provider: Provider;
  tools: ToolRegistry;
  config: AppConfig;
  ceo: CeoAgentDefinition;
  sendMessageToTeamEnabled: boolean;
  /** The persistent per-agent contexts for this chat (loaded/saved by the CEO session store). */
  contexts: Map<string, CeoAgentContext>;
  chatId: string;
  model: string;
  /** Provider id snapshot for schedules created by CEO-system agents (resolved at run). */
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
  /** The persistent prompt library — lets the CEO/leader/member agents manage saved prompts. */
  promptLibrary?: PromptLibraryRuntime;
  /** The persistent custom-agents runtime — lets the CEO/leader/member agents manage custom agents. */
  customAgents?: import("../../tools/types.js").CustomAgentsRuntime;
  /** The persistent custom-system-prompts runtime — lets the CEO/leader/member agents manage saved system prompts. */
  customSystemPrompts?: import("../../tools/types.js").CustomSystemPromptsRuntime;
  skills: SkillRuntime;
  todos: TodoRuntime;
  subAgentDefinitions: Awaited<ReturnType<typeof resolveDefaultSubAgents>>;
  userSubAgents: import("../../tools/types.js").SubAgentDefinition[];
  /** The turn's connector runtime (connected Composio apps), shared by every agent. */
  connectors: ConnectorRuntime;
  /** The turn's MCP runtime (connected MCP servers), shared by every agent. */
  mcp?: McpRuntime;
  /** The persisted MCP manager — lets CEO/team agents use the MCP management tools. */
  mcpManager?: import("../../mcp/manager.js").McpManager;
  /** The persisted connector manager — lets CEO/leader/member agents manage app connectors. */
  connectorManager?: import("../../connectors/manager.js").ConnectorManager;
  /** The messaging-channel manager — lets CEO/team agents use the channel_* tools. */
  channelManager?: import("../../../channels/manager.js").ChannelManager;
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
  /** Context-management method for CEO-system agents ("summarization" default). */
  contextManagementMethod?: string;
  /** Fraction freed per sliding-window trigger (default 0.3). */
  slidingWindowTruncatePercent?: number;
}

/**
 * The CEO multi-agent orchestrator — an actor system built ON the SAME multi-agent runtime as the
 * team orchestrator (same mailbox/serial-actor model, same head/member agent runners, same agent
 * loop). It adds one top-level layer: a single CEO agent that controls the head/leaders of several
 * teams. Each agent (CEO + leaders + members) is a serial actor with a mailbox: it never runs two LLM
 * loops at once, and messages delivered while it is busy are queued and delivered together the next
 * time it is free. The CEO is seeded with the user's message; the CEO assigns tasks to team leaders;
 * leaders delegate to their own members; members report to their leader; leaders report to the CEO.
 * The turn ends when the whole organization is quiescent or the run is aborted.
 */
export class CeoOrchestrator {
  private readonly actors = new Map<string, CeoActor>();
  private readonly ceoId: string;
  private messageCount = 0;
  private runCount = 0;
  private resolveDone: (() => void) | null = null;
  private settled = false;
  private readonly registryNames: string[];
  private readonly visionCapable: boolean;
  /** Ordered list of the teams the CEO controls (deduped, valid leaders only). */
  private readonly teams: AgentTeamDefinition[];

  constructor(private readonly deps: CeoOrchestratorDeps) {
    this.ceoId = deps.ceo.name;
    this.registryNames = deps.tools.names();
    this.visionCapable = isVisionCapableModel(deps.model, deps.config);
    this.teams = (deps.ceo.teams ?? []).filter((t) => t && t.leader_name?.trim());
    this.buildActors();
  }

  /** True while no actor is running and every mailbox is empty. */
  private get quiescent(): boolean {
    for (const actor of this.actors.values()) {
      if (actor.busy || actor.mailbox.length > 0) return false;
    }
    return true;
  }

  /** Materialize one actor per agent (CEO + every team's leader + members), reusing any persisted context. */
  private buildActors(): void {
    const ensure = (
      id: string,
      role: CeoActorRole,
      description: string,
      systemPrompt: string,
      opts?: { teamId?: string; team?: AgentTeamDefinition; member?: TeamMemberDefinition },
    ): void => {
      const key = id.trim().toLowerCase();
      if (!key || this.actors.has(key)) return; // first wins on any id collision
      let context = this.deps.contexts.get(key);
      if (!context) {
        context = { id, role, teamId: opts?.teamId, description, systemPrompt, messages: [] };
        this.deps.contexts.set(key, context);
      } else {
        // Keep the latest role/team/prompt/description (the CEO definition may have been edited).
        context.role = role;
        context.teamId = opts?.teamId;
        context.description = description;
        context.systemPrompt = systemPrompt;
      }
      this.actors.set(key, {
        context,
        role,
        team: opts?.team,
        member: opts?.member,
        mailbox: [],
        busy: false,
        status: "idle",
        subAgentRuntime: this.buildSubAgentRuntime(context),
        pendingLeaderReport: false,
        leaderReportReminders: 0,
        pendingCeoReport: false,
        ceoReportReminders: 0,
      });
    };

    ensure(this.deps.ceo.name, "ceo", this.deps.ceo.description || "CEO", this.deps.ceo.system_prompt);
    for (const team of this.teams) {
      ensure(team.leader_name, "leader", `Head / leader of team "${team.name}"`, team.leader_system_prompt, {
        teamId: team.id,
        team,
      });
      for (const m of team.members) {
        if (!m.name || !m.name.trim()) continue;
        ensure(m.name, "member", m.description, m.system_prompt, {
          teamId: team.id,
          team,
          member: m,
        });
      }
    }
  }

  private buildSubAgentRuntime(context: CeoAgentContext): ReturnType<typeof createSubAgentRuntime> {
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

  private actor(id: string): CeoActor | undefined {
    return this.actors.get(id.trim().toLowerCase());
  }

  /**
   * Run the turn to quiescence. Seeds the CEO with the user's message (prepended with any
   * first-message memory/knowledge context) and resolves when the whole organization goes idle or aborts.
   */
  async run(userMessage: string, firstMessageContext: string): Promise<void> {
    this.deps.send(EV_TEAM_START, {
      team_id: this.deps.ceo.id,
      team_name: this.deps.ceo.name,
      leader_id: this.ceoId,
      is_ceo: true,
      send_message_enabled: this.deps.sendMessageToTeamEnabled,
      members: this.rosterInfo(),
    });

    const ceo = this.actor(this.ceoId);
    if (!ceo) {
      this.deps.send("error", { code: "no_ceo", message: "The CEO system has no CEO agent." });
      return;
    }

    const seeded =
      firstMessageContext.trim().length > 0
        ? `${firstMessageContext.trim()}\n\n${userMessage}`
        : userMessage;

    ceo.mailbox.push({ from: USER_SENDER_ID, message: seeded, kind: "user" });
    this.emitStatus(ceo);

    const donePromise = new Promise<void>((resolve) => {
      this.resolveDone = resolve;
    });

    const onAbort = () => this.settle();
    if (this.deps.signal.aborted) {
      this.settle();
    } else {
      this.deps.signal.addEventListener("abort", onAbort, { once: true });
      this.schedule(this.ceoId);
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

  /** Full roster (CEO + leaders + members) for the UI's team_start event. The CEO is surfaced as a
   * "leader"-role block (the frontend only knows leader/member roles). */
  private rosterInfo(): TeamMemberInfo[] {
    const info: TeamMemberInfo[] = [];
    for (const actor of this.actors.values()) {
      info.push({
        agent_id: actor.context.id,
        role: actor.role === "member" ? "member" : "leader",
        description: actor.context.description,
      });
    }
    return info;
  }

  private emitStatus(actor: CeoActor): void {
    this.deps.send(EV_TEAM_STATUS, {
      agent_id: actor.context.id,
      role: actor.role === "member" ? "member" : "leader",
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
  private async runActor(actor: CeoActor): Promise<void> {
    actor.busy = true;
    try {
      while (actor.mailbox.length > 0 && !this.deps.signal.aborted) {
        if (this.runCount >= MAX_AGENT_RUNS) {
          this.deps.send("error", {
            code: "ceo_run_budget_exceeded",
            message: `The CEO system reached the maximum of ${MAX_AGENT_RUNS} agent runs for this turn.`,
          });
          break;
        }
        this.runCount += 1;

        // Deliver EVERYTHING queued so far as one batch (queued messages arrive together).
        const batch = actor.mailbox.splice(0, actor.mailbox.length);
        actor.status = "working";
        this.emitStatus(actor);

        const framed =
          actor.role === "ceo"
            ? frameCeoMailbox(batch)
            : frameMailbox(actor.role === "leader" ? "leader" : "member", actor.context.id, batch);
        actor.context.messages.push({ role: "user", content: framed });

        this.deps.send(EV_AGENT_START, {
          agent_id: actor.context.id,
          role: actor.role === "member" ? "member" : "leader",
          trigger: this.triggerLabel(batch),
        });

        const result = await this.runOneLoop(actor);
        actor.status = result.ok ? "completed" : "failed";
        this.deps.send(EV_AGENT_DONE, {
          agent_id: actor.context.id,
          role: actor.role === "member" ? "member" : "leader",
          ok: result.ok,
          status: actor.status,
          error: result.error,
        });

        // Safety nets: nudge a member that never reported to its leader, or a leader that never
        // reported to the CEO — so no one is ever left waiting on a silently-finished agent.
        this.maybeNudgeToReport(actor, result);
      }
    } finally {
      actor.busy = false;
      if (actor.mailbox.length === 0 && actor.status === "working") actor.status = "idle";
      this.emitStatus(actor);
      if (actor.mailbox.length > 0 && !this.deps.signal.aborted) {
        this.schedule(actor.context.id);
      } else if (this.quiescent || this.deps.signal.aborted) {
        this.settle();
      }
    }
  }

  private triggerLabel(batch: MailboxMessage[]): string {
    if (batch.length === 1 && batch[0]!.kind === "user") return "user request";
    if (batch.length === 1 && batch[0]!.kind === "system") return "coordination check";
    const froms = [
      ...new Set(
        batch.map((m) =>
          m.from === USER_SENDER_ID ? "the user" : m.from === SYSTEM_SENDER_ID ? "the system" : m.from,
        ),
      ),
    ];
    return `${batch.length} message(s) from ${froms.join(", ")}`;
  }

  /**
   * Inject an automatic "you didn't report back" nudge into an actor's mailbox when it finished a run
   * but still owes a report. Members owe their team leader; team leaders owe the CEO. No-op for the
   * CEO, for failed/aborted runs, when the actor already has other work queued, or once the per-task
   * reminder budget is spent.
   */
  private maybeNudgeToReport(actor: CeoActor, result: { ok: boolean }): void {
    if (!result.ok || this.deps.signal.aborted) return;
    if (actor.mailbox.length > 0) return;

    if (actor.role === "member" && actor.pendingLeaderReport && actor.team) {
      if (actor.leaderReportReminders >= MAX_REPORT_REMINDERS) return;
      actor.leaderReportReminders += 1;
      actor.mailbox.push({
        from: SYSTEM_SENDER_ID,
        message: buildLeaderReportReminder(actor.context.id, actor.team.leader_name),
        kind: "system",
      });
      actor.status = "queued";
      this.emitStatus(actor);
      return;
    }

    if (actor.role === "leader" && actor.pendingCeoReport) {
      if (actor.ceoReportReminders >= MAX_REPORT_REMINDERS) return;
      actor.ceoReportReminders += 1;
      actor.mailbox.push({
        from: SYSTEM_SENDER_ID,
        message: buildCeoReportReminder(actor.context.id, this.ceoId),
        kind: "system",
      });
      actor.status = "queued";
      this.emitStatus(actor);
    }
  }

  /** Run a single LLM loop for the actor via the CEO / head / member runner. */
  private async runOneLoop(actor: CeoActor) {
    const send = (event: string, data: Record<string, unknown>): void =>
      this.deps.send(event, {
        agent_id: actor.context.id,
        role: actor.role === "member" ? "member" : "leader",
        ...data,
      });

    const connectors = this.deps.connectors;
    const mcp = this.deps.mcp;
    const allowed = new Set(
      allowedCeoAgentTools(
        this.registryNames,
        actor.role,
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
      providerId: this.deps.providerId,
      contextLimit: typeof this.deps.contextLimit === "number" ? this.deps.contextLimit : null,
      contextManagementMethod: this.deps.contextManagementMethod,
      slidingWindowTruncatePercent: this.deps.slidingWindowTruncatePercent,
    };

    if (actor.role === "ceo") {
      return runCeoAgent({
        ...common,
        ceo: this.deps.ceo,
        teams: this.teams,
        contextManagementMethod: this.deps.contextManagementMethod,
        slidingWindowTruncatePercent: this.deps.slidingWindowTruncatePercent,
      });
    }
    if (actor.role === "leader") {
      const team = actor.team!;
      return runHeadAgent({
        ...common,
        sendMessageEnabled: this.deps.sendMessageToTeamEnabled,
        team,
        ceo: { name: this.ceoId },
        usageScope: "ceo",
      });
    }
    const team = actor.team!;
    return runMemberAgent({
      ...common,
      sendMessageEnabled: this.deps.sendMessageToTeamEnabled,
      team,
      member: actor.member ?? {
        name: actor.context.id,
        description: actor.context.description,
        system_prompt: actor.context.systemPrompt,
      },
      usageScope: "ceo",
    });
  }

  /** Build the tool-execution context for an agent, wiring the CEO runtime (CEO) or a scoped team
   * runtime (leaders/members). */
  private buildToolCtx(actor: CeoActor, _allowed: Set<string>): ToolContext {
    const ctx: ToolContext = {
      workspaceRoot: this.deps.config.workspaceRoot,
      chatId: this.deps.chatId,
      shellTimeoutMs: this.deps.config.shellTimeoutMs,
      signal: this.deps.signal,
      web: this.deps.web,
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
    if (actor.role === "ceo") {
      ctx.ceo = this.buildCeoRuntime(actor);
    } else {
      ctx.team = this.buildTeamRuntime(actor);
    }
    return ctx;
  }

  // ---- CEO runtime (powers assign_tasks_to_teams + list_teams) ---------------------------------

  private buildCeoRuntime(actor: CeoActor): CeoRuntime {
    return {
      selfId: actor.context.id,
      listTeams: () => this.teamInfos(),
      assignTasks: (tasks) => this.assignTasks(actor.context.id, tasks),
    };
  }

  private teamInfos(): CeoTeamInfo[] {
    return this.teams.map((team) => ({
      team_id: team.id,
      team_name: team.name,
      team_leader: team.leader_name,
      members: team.members.map((m) => ({ name: m.name, description: m.description })),
    }));
  }

  /**
   * Assign one task prompt to each named team leader. Each prompt is framed so the leader knows the
   * task comes from the CEO and must report completion back. Unknown / non-leader ids are skipped.
   */
  private assignTasks(
    from: string,
    tasks: Array<{ team_leader: string; prompt: string }>,
  ): TeamDeliveryResult {
    if (this.messageCount >= MAX_CEO_MESSAGES) return this.budgetExhausted();

    const delivered: string[] = [];
    const unknown: string[] = [];
    for (const { team_leader, prompt } of tasks) {
      const target = this.actor(team_leader);
      if (!target || target.role !== "leader") {
        unknown.push(team_leader);
        continue;
      }
      if (this.messageCount >= MAX_CEO_MESSAGES) {
        unknown.push(team_leader);
        continue;
      }
      this.messageCount += 1;
      const framed = frameCeoTaskPrompt(prompt, this.ceoId);
      target.mailbox.push({ from, message: framed, kind: "delegate" });
      delivered.push(target.context.id);
      // Open the CEO-report obligation for this leader (reset its reminder budget).
      target.pendingCeoReport = true;
      target.ceoReportReminders = 0;
      this.emitDelivery(from, target, "delegate", framed);
      this.schedule(target.context.id);
    }

    return this.deliveryResult(delivered, unknown, "team leader");
  }

  // ---- Team runtime bound to a leader/member (scoped to that agent's team) ---------------------

  private buildTeamRuntime(actor: CeoActor): TeamRuntime {
    const team = actor.team!;
    return {
      selfId: actor.context.id,
      isLeader: actor.role === "leader",
      leaderId: team.leader_name,
      sendMessageToTeamEnabled: this.deps.sendMessageToTeamEnabled,
      listMembers: () => this.teamRoster(actor.context.teamId),
      status: (ids) => this.statusWithin(actor.context.teamId, ids),
      deliver: (messages, kind) => this.deliverWithinTeam(actor, messages, kind),
      inCeoMode: true,
      ceoId: this.ceoId,
      reportToCeo: (summary) => this.reportToCeo(actor, summary),
    };
  }

  /** Roster of one team (its leader + members), for list_agent_team_members. */
  private teamRoster(teamId: string | undefined): TeamMemberInfo[] {
    const info: TeamMemberInfo[] = [];
    for (const actor of this.actors.values()) {
      if (actor.role === "ceo" || actor.context.teamId !== teamId) continue;
      info.push({
        agent_id: actor.context.id,
        role: actor.role === "member" ? "member" : "leader",
        description: actor.context.description,
      });
    }
    return info;
  }

  /** Status of the requested agents, restricted to the caller's own team. */
  private statusWithin(teamId: string | undefined, ids: string[]): TeamMemberStatus[] {
    const out: TeamMemberStatus[] = [];
    for (const id of ids) {
      const actor = this.actor(id);
      if (!actor || actor.role === "ceo" || actor.context.teamId !== teamId) continue;
      out.push({
        agent_id: actor.context.id,
        role: actor.role === "member" ? "member" : "leader",
        description: actor.context.description,
        status: actor.busy ? "working" : actor.mailbox.length > 0 ? "queued" : actor.status,
        queued_messages: actor.mailbox.length,
      });
    }
    return out;
  }

  /**
   * Deliver messages from a leader/member to targets WITHIN the same team (delegation from the leader,
   * peer messaging, or a member reporting up to its leader). Cross-team targets are reported as
   * unknown so a leader can never reach another team's members.
   */
  private deliverWithinTeam(
    from: CeoActor,
    messages: Array<{ agent_id: string; message: string }>,
    kind: TeamMessageKind,
  ): TeamDeliveryResult {
    if (this.messageCount >= MAX_CEO_MESSAGES) return this.budgetExhausted();

    const delivered: string[] = [];
    const unknown: string[] = [];
    for (const { agent_id, message } of messages) {
      const target = this.actor(agent_id);
      if (!target || target.role === "ceo" || target.context.teamId !== from.context.teamId) {
        unknown.push(agent_id);
        continue;
      }
      if (this.messageCount >= MAX_CEO_MESSAGES) {
        unknown.push(agent_id);
        continue;
      }
      this.messageCount += 1;
      target.mailbox.push({ from: from.context.id, message, kind });
      delivered.push(target.context.id);

      // Track the member<->leader report obligation (mirrors the team orchestrator).
      if (kind === "delegate" && target.role === "member") {
        target.pendingLeaderReport = true;
        target.leaderReportReminders = 0;
      }
      if (target.role === "leader" && from.role === "member") {
        from.pendingLeaderReport = false;
      }
      this.emitDelivery(from.context.id, target, kind, message);
      this.schedule(target.context.id);
    }

    return this.deliveryResult(delivered, unknown, "team member");
  }

  /** A team leader reports task completion up to the CEO (report_task_completion_to_ceo). */
  private reportToCeo(from: CeoActor, summary: string): TeamDeliveryResult {
    if (this.messageCount >= MAX_CEO_MESSAGES) return this.budgetExhausted();
    const ceo = this.actor(this.ceoId);
    if (!ceo) {
      return {
        ok: false,
        delivered: [],
        unknown: [this.ceoId],
        message: "The CEO agent is not available.",
        error: { code: "no_ceo", message: "The CEO agent is not available." },
      };
    }
    this.messageCount += 1;
    const framed = `From team leader "${from.context.id}" (team "${from.team?.name ?? ""}"):\n\n${summary}`;
    ceo.mailbox.push({ from: from.context.id, message: framed, kind: "to_leader" });
    // Close this leader's CEO-report obligation.
    from.pendingCeoReport = false;
    this.emitDelivery(from.context.id, ceo, "to_leader", framed);
    this.schedule(ceo.context.id);
    return { ok: true, delivered: [ceo.context.id], unknown: [], message: `Reported to the CEO ("${ceo.context.id}").` };
  }

  // ---- Shared delivery plumbing ----------------------------------------------------------------

  private emitDelivery(from: string, target: CeoActor, kind: TeamMessageKind, message: string): void {
    this.deps.send(EV_TEAM_MESSAGE, { from, to: target.context.id, kind, message });
    if (!target.busy) target.status = "queued";
    this.emitStatus(target);
  }

  private deliveryResult(
    delivered: string[],
    unknown: string[],
    targetKind: string,
  ): TeamDeliveryResult {
    const parts: string[] = [];
    if (delivered.length > 0) parts.push(`Delivered to: ${delivered.join(", ")}.`);
    if (unknown.length > 0) parts.push(`Unknown ${targetKind}(s) skipped: ${unknown.join(", ")}.`);
    return {
      ok: delivered.length > 0,
      delivered,
      unknown,
      message: parts.join(" ") || "No messages delivered.",
      error:
        delivered.length === 0
          ? {
              code: "no_valid_targets",
              message: `No matching ${targetKind} for: ${unknown.join(", ")}.`,
            }
          : undefined,
    };
  }

  private budgetExhausted(): TeamDeliveryResult {
    return {
      ok: false,
      delivered: [],
      unknown: [],
      message: "The CEO collaboration message budget for this turn is exhausted.",
      error: {
        code: "collaboration_budget_exceeded",
        message:
          `The organization has exchanged the maximum of ${MAX_CEO_MESSAGES} messages this turn. ` +
          "Wrap up and, if you are the CEO, give the user your best final answer.",
      },
    };
  }
}
