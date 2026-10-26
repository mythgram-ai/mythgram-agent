import type { AppConfig } from "../config.js";
import type { ProviderRegistry } from "../agents/providers/registry.js";
import type { ToolRegistry } from "../agents/tools/registry.js";
import type { AgentRunner, RunAgentRequest } from "../agents/agent.js";
import type { CustomAgentRunner } from "../agents/customagent/index.js";
import type { CustomAgentManager } from "../agents/customagent/index.js";
import type { CustomAgentConfig } from "../agents/customagent/configuration.js";
import type { MainAgentPromptManager } from "../agents/mainagentprompt/index.js";
import type { PlanApprovalStore } from "../services/planApprovalStore.js";
import type { ChatSession } from "../services/sessionStore.js";
import { SessionEventBuffer } from "../services/eventBuffer.js";
import { createChatSessionId, randomId } from "../database/ids.js";
import type { MythgramDatabase } from "../database/index.js";
import type { ChannelChatRow } from "../database/repositories/channelChatsRepo.js";
import type { McpManager } from "../agents/mcp/index.js";
import type { MemoryAgentService } from "../agents/memoryagent/index.js";
import type { ChannelToolContext } from "../agents/tools/types.js";
import { commandPrefix, parseChannelCommand } from "./commands.js";
import { resolveChannelRunContext } from "./context.js";
import { catalogContextLimit } from "../agents/contextLimits.js";
import { ChannelStore } from "./store.js";
import type {
  ChannelConnection,
  ChannelIncoming,
  ChannelSender,
  ChannelTarget,
} from "./types.js";

/** How long a channel submit_plan waits for /@ok / /@no before continuing alone. */
export const CHANNEL_PLAN_TIMEOUT_MS = 10 * 60_000;

/** Hard cap on one channel turn (abort + fail past this point). */
export const CHANNEL_TURN_TIMEOUT_MS = 30 * 60_000;

/**
 * Nudge sent back into the SAME agent session when a channel turn finished without the
 * model using send_responses — the user would otherwise receive nothing, because plain
 * final-answer text is never delivered to channels.
 */
export const CHANNEL_SUMMARY_NUDGE =
  "Your previous reply did not reach the user: on messaging-channel turns the user ONLY sees " +
  "what you send through the send_responses tool — your plain final-answer text is never " +
  "delivered to the channel. Now call send_responses with a complete, user-facing summary of " +
  "the task result (what was done, the key results, relevant file paths, and next steps). Keep " +
  "it clear and concise; never include internal reasoning, hidden thoughts, raw tool output, or " +
  "execution logs. After send_responses succeeds, end your turn.";

export interface ChannelRunnerDeps {
  providers: ProviderRegistry;
  tools: ToolRegistry;
  config: AppConfig;
  db: MythgramDatabase;
  store: ChannelStore;
  agent: AgentRunner;
  customAgentRunner: CustomAgentRunner;
  customAgents: CustomAgentManager;
  mainAgentPrompts: MainAgentPromptManager;
  planApprovals: PlanApprovalStore;
  memoryAgent?: MemoryAgentService;
  mcpManager?: McpManager;
  scheduleStore?: import("../cron/store.js").ScheduleStore;
  scheduleScheduler?: import("../cron/scheduler.js").ScheduleScheduler;
  /**
   * Override for how long submit_plan waits on a channel turn (tests use a short
   * window; production uses CHANNEL_PLAN_TIMEOUT_MS).
   */
  planTimeoutMs?: number;
}

interface LiveTurn {
  startedAt: number;
  agentName: string;
}

/**
 * Executes one channel turn per incoming message through the EXISTING agent runtime
 * (built-in Main Agent or a user Custom Agent). No separate agent exists for channels:
 * the request is built exactly like a chat turn, plus the channel context that
 * advertises send_responses and routes ask/attach/plan behavior to the channel.
 */
export class ChannelTurnRunner {
  /** chatId -> in-flight turn (busy guard + status replies). */
  private readonly running = new Map<string, LiveTurn>();
  /** chatId -> pending submit_plan review (resolved by /@ok / /@no). */
  private readonly pendingPlans = new Map<string, { toolCallId: string }>();
  /**
   * Latest `context_usage` per channel chat (captured from the turn's event buffer).
   * Powers the Channels dashboard meter + raw-context view. In-memory only:
   * a restart clears it (raw transcript stays available, usage shows as unavailable
   * until the next turn) — same resilience posture as the main agent's ephemeral meter.
   */
  private readonly lastUsage = new Map<string, Record<string, unknown>>();

  constructor(private readonly deps: ChannelRunnerDeps) {}

  /** True while a turn is executing for a chat (used by status replies + tests). */
  isRunning(chatId: string): boolean {
    return this.running.has(chatId);
  }

  /** Latest captured context usage for a channel chat, if any turn has reported it. */
  lastContextUsage(chatId: string): Record<string, unknown> | null {
    return this.lastUsage.get(chatId) ?? null;
  }

  /**
   * Handle one inbound channel message end-to-end: commands (/​@switch, /​@ok, /​@no,
   * /​@new-chat) are answered locally, everything else runs an agent turn. Never throws —
   * every failure is reported back to the channel the request came from.
   */
  async handleIncoming(
    connection: ChannelConnection,
    sender: ChannelSender,
    incoming: ChannelIncoming,
  ): Promise<void> {
    const { db } = this.deps;
    const command = parseChannelCommand(incoming.text, {
      mentionRequired: incoming.needsMention,
      mention: { botId: connection.botId, botName: connection.botName },
    });
    // Mention-gated channels: messages not addressing the bot are ignored silently.
    if (!command) return;

    const prefix = commandPrefix(connection.kind, connection.botName);
    try {
      // Resolve (or create) this user's chat first — every path below needs it.
      let chat = db.channelChats.latestForUser(connection.id, incoming.userKey);
      if (!chat) {
        chat = this.createChat(connection, incoming.userKey, incoming.userLabel, "");
      }
      if (command.type === "switch") {
        await this.handleSwitch(connection, sender, incoming.target, chat, command.name, prefix);
        return;
      }
      if (command.type === "ok" || command.type === "no") {
        await this.handlePlanDecision(sender, incoming.target, chat, command.type);
        return;
      }
      if (command.type === "new-chat") {
        const fresh = this.createChat(connection, incoming.userKey, incoming.userLabel, "");
        // New chats inherit the CURRENT chat's agent (a switch applies going forward).
        if (fresh.agentId !== chat.agentId) {
          db.channelChats.setAgent(fresh.id, chat.agentId);
          fresh.agentId = chat.agentId;
        }
        await sender.sendMessage(
          incoming.target,
          `New chat started.\n- Chat: ${shortId(fresh.id)}\n- Agent: ${this.agentDisplayName(fresh.agentId)}\n- Channel: ${connection.name}\nSend your task whenever ready.`,
        );
        return;
      }

      const live = this.running.get(chat.id);
      if (live) {
        const secs = Math.max(1, Math.round((Date.now() - live.startedAt) / 1000));
        await sender.sendMessage(
          incoming.target,
          `A task is already running in this chat.\n- Agent: ${live.agentName}\n- Running for: ${secs}s\n- Chat: ${shortId(chat.id)}\nYour message was not started. Wait for the current task to finish, or send ${prefix}/@new-chat to start fresh.`,
        );
        return;
      }

      const userMessage = this.withAttachmentNotice(command.text, incoming);
      if (!userMessage.trim()) return;
      await this.runTurn(connection, sender, incoming.target, chat, userMessage);
    } catch (error) {
      try {
        await sender.sendMessage(
          incoming.target,
          `Something went wrong handling your message: ${error instanceof Error ? error.message : String(error)}`,
        );
      } catch {
        // The channel itself is unreachable — nothing more we can do.
      }
    }
  }

  // ---- Commands -------------------------------------------------------------

  private async handleSwitch(
    connection: ChannelConnection,
    sender: ChannelSender,
    target: ChannelTarget,
    chat: ChannelChatRow,
    rawName: string,
    prefix: string,
  ): Promise<void> {
    const name = rawName.trim();
    if (!name) {
      await sender.sendMessage(
        target,
        `Usage: ${prefix}/@switch <agent name> (or ${prefix}/@switch default).\n${this.agentListLine()}`,
      );
      return;
    }
    const lowered = name.toLowerCase();
    if (lowered === "default" || lowered === "main") {
      this.deps.db.channelChats.setAgent(chat.id, null);
      await sender.sendMessage(
        target,
        `Agent switched to the Default Agent (built-in Main Agent).\nSend ${prefix}/@switch <name> to use a custom agent again.`,
      );
      return;
    }
    const match =
      this.deps.customAgents
        .list()
        .find((a) => a.name.trim().toLowerCase() === lowered) ?? null;
    if (!match) {
      await sender.sendMessage(
        target,
        `Unknown agent "${name}". The agent was not switched.\n${this.agentListLine()}\nUsage: ${prefix}/@switch <agent name> (or ${prefix}/@switch default).`,
      );
      return;
    }
    this.deps.db.channelChats.setAgent(chat.id, match.id);
    const description = match.description.trim() || "No description.";
    await sender.sendMessage(
      target,
      `Agent switched to "${match.name}" (custom agent).\n- ${description.slice(0, 300)}\nSend ${prefix}/@switch default to go back to the Default Agent.`,
    );
  }

  private agentListLine(): string {
    const customs = this.deps.customAgents.list();
    if (customs.length === 0) return "Available agents: default (no custom agents yet).";
    return `Available agents: default, ${customs.map((a) => a.name).join(", ")}.`;
  }

  private async handlePlanDecision(
    sender: ChannelSender,
    target: ChannelTarget,
    chat: ChannelChatRow,
    decision: "ok" | "no",
  ): Promise<void> {
    const pending = this.pendingPlans.get(chat.id);
    if (!pending) {
      await sender.sendMessage(
        target,
        "There is no pending plan to review in this chat. Plans appear here when the agent submits one with submit_plan.",
      );
      return;
    }
    const supplied = this.deps.planApprovals.decide(
      chat.id,
      pending.toolCallId,
      decision === "ok" ? "approved" : "canceled",
    );
    this.pendingPlans.delete(chat.id);
    await sender.sendMessage(
      target,
      supplied
        ? decision === "ok"
          ? "Plan approved — the agent continues with the task."
          : "Plan rejected — the agent will retry with a better plan."
        : "That plan review already closed (it timed out or was decided). The agent continues on its own.",
    );
  }

  // ---- Turns ----------------------------------------------------------------

  private createChat(
    connection: ChannelConnection,
    userKey: string,
    userLabel: string,
    title: string,
  ): ChannelChatRow {
    const now = Date.now();
    const row: ChannelChatRow = {
      id: createChatSessionId(),
      channelId: connection.id,
      userKey,
      userLabel,
      agentId: connection.activeAgentId,
      title,
      createdAt: now,
      updatedAt: now,
    };
    this.deps.db.channelChats.save(row);
    return row;
  }

  /** Append the uploaded-files notice so the agent reads attachments first (like the app). */
  private withAttachmentNotice(
    text: string,
    incoming: ChannelIncoming,
  ): string {
    if (incoming.attachments.length === 0) return text;
    const refs = incoming.attachments
      .map((f) => `${f.filename} (${f.absolutePath})`)
      .join(", ");
    const hasImage = incoming.attachments.some(
      (f) =>
        f.contentType.startsWith("image/") || /\.(png|jpe?g|gif|webp|heic|heif)$/i.test(f.filename),
    );
    const notice =
      `The user has attached ${incoming.attachments.length} file${incoming.attachments.length === 1 ? "" : "s"} ` +
      `with this message — please examine ${incoming.attachments.length === 1 ? "it" : "them"} first: ${refs}. ` +
      `The files are saved under the agent workspace's uploads/ folder. ` +
      `Read text and document files with file_read (absolute path) before answering` +
      (hasImage ? `, and inspect attached images with read_image (it needs a vision-capable model)` : ``) +
      `.`;
    return text.trim().length > 0 ? `${text.trim()}\n\n${notice}` : notice;
  }

  private agentDisplayName(agentId: string | null): string {
    if (!agentId) return "Default Agent";
    return this.deps.customAgents.get(agentId)?.name ?? "Default Agent";
  }

  private async runTurn(
    connection: ChannelConnection,
    sender: ChannelSender,
    target: ChannelTarget,
    chat: ChannelChatRow,
    userMessage: string,
  ): Promise<void> {
    const { db } = this.deps;

    // Resolve the serving agent (a deleted Custom Agent falls back to Default).
    let customAgent: CustomAgentConfig | null = null;
    if (chat.agentId) {
      customAgent = this.deps.customAgents.get(chat.agentId);
      if (!customAgent) {
        db.channelChats.setAgent(chat.id, null);
        chat.agentId = null;
      }
    }
    const agentName = customAgent ? customAgent.name : "Default Agent";

    const ctx = this.buildRunContext();
    if (!ctx.provider || !ctx.model) {
      await sender.sendMessage(
        target,
        "The agent has no provider/model configured yet. Open the app Settings, add an API key and pick a model first.",
      );
      return;
    }
    if (!ctx.apiKey && ctx.provider !== "local" && !ctx.customProvider) {
      await sender.sendMessage(
        target,
        `No API key is configured for provider "${ctx.provider}". Add one in the app Settings first.`,
      );
      return;
    }

    // Automatic summarization handoff needs the model's context window. The
    // manual Settings entry (if any) is already in ctx; otherwise resolve the
    // cached provider catalog once per turn so a long channel conversation
    // compacts exactly like a web turn. Unknown stays null (handoff safely
    // disabled) and never blocks the turn.
    if (ctx.contextLimit === null) {
      ctx.contextLimit = await catalogContextLimit({
        providers: this.deps.providers,
        provider: ctx.provider,
        model: ctx.model,
        apiKey: ctx.apiKey,
        baseUrl: ctx.baseUrl,
        customProvider: ctx.customProvider,
      });
    }

    // The agent runtime resolves the provider itself and reports resolution failures
    // as an "error" buffer event, which the watcher forwards to the channel.
    const channel: ChannelToolContext = {
      kind: connection.kind,
      channelId: connection.id,
      channelName: connection.name,
      userKey: chat.userKey,
      userLabel: chat.userLabel,
      sendMessage: (text: string) => sender.sendMessage(target, text),
      sendFiles: async (files) => {
        let delivered = 0;
        const errors: string[] = [];
        for (const file of files) {
          try {
            await sender.sendFile(target, file);
            delivered += 1;
          } catch (error) {
            errors.push(
              `${file.filename}: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
        }
        return { delivered, errors };
      },
    };

    const session: ChatSession = {
      chatId: chat.id,
      messages: db.channelMessages.list(chat.id),
      eventBuffer: null,
      abortController: null,
      running: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    const request: RunAgentRequest = {
      chatId: chat.id,
      userMessage,
      provider: ctx.provider,
      model: ctx.model,
      apiKey: ctx.apiKey,
      baseUrl: ctx.baseUrl,
      customProvider: ctx.customProvider,
      temperature: ctx.temperature,
      effort: ctx.effort,
      tavilyApiKey: ctx.tavilyApiKey,
      exaApiKey: ctx.exaApiKey,
      serpapiApiKey: ctx.serpapiApiKey,
      searchProvider: ctx.searchProvider,
      fetchProvider: ctx.fetchProvider,
      firecrawlApiKey: ctx.firecrawlApiKey,
      subAgents: ctx.subAgents,
      skills: ctx.skills,
      todos: ctx.todos,
      memory: ctx.memory,
      knowledge: ctx.knowledge,
      enableReuseSubAgentSession: false,
      systemPromptOverride: customAgent ? undefined : (ctx.systemPromptOverride ?? undefined),
      channel,
      planApprovalTimeoutMs: this.deps.planTimeoutMs ?? CHANNEL_PLAN_TIMEOUT_MS,
      memoryAgentEnabled: ctx.memoryAgentEnabled,
      memoryAgentInterval: ctx.memoryAgentInterval,
      composioApiKey: ctx.composioApiKey,
      connectors: ctx.connectors,
      mcpServers: ctx.mcpServers,
      contextLimit: ctx.contextLimit,
      summaryThreshold: ctx.summaryThreshold,
      contextManagementMethod: ctx.contextManagementMethod,
      slidingWindowTruncatePercent: ctx.slidingWindowTruncatePercent,
    };

    this.running.set(chat.id, { startedAt: Date.now(), agentName });
    const abortController = new AbortController();
    session.abortController = abortController;
    const turnTimer = setTimeout(() => abortController.abort(), CHANNEL_TURN_TIMEOUT_MS);
    if (typeof turnTimer.unref === "function") turnTimer.unref();

    let lastState: LoopState | null = null;
    try {
      // Up to two loops: the real turn, plus one guided retry when the model forgot
      // send_responses (its text would otherwise never reach the user). The nudge
      // becomes the second loop's user message inside the SAME session.
      const prompts = [userMessage, CHANNEL_SUMMARY_NUDGE];
      for (let loop = 0; loop < prompts.length; loop += 1) {
        const buffer = new SessionEventBuffer();
        session.eventBuffer = buffer;
        const state = this.createLoopState(chat, connection, sender, target);
        lastState = state;
        // Only the last loop may fall back to delivering the raw final answer: the
        // first loop must go through the guided send_responses retry instead.
        const watch = this.watchBuffer(buffer, state, loop === prompts.length - 1);
        const loopRequest: RunAgentRequest = { ...request, userMessage: prompts[loop]! };
        try {
          if (customAgent) {
            await this.deps.customAgentRunner.run(loopRequest, customAgent, session, buffer, abortController.signal);
          } else {
            await this.deps.agent.run(loopRequest, session, buffer, abortController.signal);
          }
        } catch (error) {
          buffer.setDone();
          state.failed = error instanceof Error ? error.message : String(error);
        }
        await watch;

        if (state.failed !== null || abortController.signal.aborted) break;
        if (state.sendResponsesUsed) break;
        // else: loop again with the nudge (loop === 1 is the last chance).
      }

      // Persist the transcript for the next message.
      db.channelMessages.replace(chat.id, session.messages);
      const title = chat.title || userMessage.trim().slice(0, 80);
      db.channelChats.touchChat(chat.id, chat.userLabel, title);

      // Report terminal failures back to the channel the request came from.
      if (abortController.signal.aborted) {
        await this.sendDirect(sender, target,
          "The task was stopped before completing (it ran too long). Send your message again to retry, or /@new-chat to start fresh.",
        );
      } else if (lastState?.failed) {
        await this.sendDirect(sender, target,
          `The task failed: ${lastState.failed}\nSend your message again to retry, or /@new-chat to start fresh.`,
        );
      }
    } catch (error) {
      try {
        await sender.sendMessage(
          target,
          `The task failed: ${error instanceof Error ? error.message : String(error)}\nSend your message again to retry, or /@new-chat to start fresh.`,
        );
      } catch {
        // The channel itself is unreachable — nothing more we can do.
      }
    } finally {
      clearTimeout(turnTimer);
      this.running.delete(chat.id);
      // A turn that ended with a stale (timed-out) plan review must not answer /@ok later.
      this.pendingPlans.delete(chat.id);
    }
  }

  // ---- Buffer watching --------------------------------------------------------

  /** Mutable per-loop observation state collected from the turn's event buffer. */
  private createLoopState(
    chat: ChannelChatRow,
    connection: ChannelConnection,
    sender: ChannelSender,
    target: ChannelTarget,
  ): LoopState {
    return {
      chatId: chat.id,
      connection,
      sender,
      target,
      sendResponsesUsed: false,
      finalText: "",
      failed: null,
    };
  }

  /**
   * Drain one turn loop's buffer, forwarding channel-relevant events:
   * plan reviews go to the channel (and arm /@ok / /@no), memory/knowledge/todo
   * mutations persist to the database (no browser is attached to sync them), and
   * created/deleted sub-agents + skills persist like the web app does.
   */
  private async watchBuffer(
    buffer: SessionEventBuffer,
    state: LoopState,
    allowFallback: boolean,
  ): Promise<void> {
    const prefix = commandPrefix(state.connection.kind, state.connection.botName);
    try {
      for await (const event of buffer.subscribe(-1)) {
        const data = event.data as Record<string, unknown>;
        switch (event.event) {
          case "tool_call":
            if (data.name === "send_responses") state.sendResponsesUsed = true;
            break;
          case "plan_review": {
            const toolCallId = typeof data.id === "string" ? data.id : "";
            const plan = typeof data.plan === "string" ? data.plan : "";
            if (toolCallId && plan) {
              this.pendingPlans.set(state.chatId, { toolCallId });
              await this.sendSafely(
                state,
                `The agent submitted a plan for your review:\n\n${plan}\n\nReply ${prefix}/@ok to approve or ${prefix}/@no to reject.`,
              );
            }
            break;
          }
          case "message_complete":
            if (typeof data.content === "string") state.finalText = data.content;
            break;
          case "memory_updated":
            if (Array.isArray(data.memoryFiles)) {
              try {
                this.deps.db.appState.set("memory", data.memoryFiles);
              } catch {
                // Persistence must never break the turn.
              }
            }
            break;
          case "knowledge_updated":
            if (Array.isArray(data.knowledgeFiles)) {
              try {
                this.deps.db.appState.set("knowledge", data.knowledgeFiles);
              } catch {
                // best effort
              }
            }
            break;
          case "todo_updated":
            if (Array.isArray(data.todos)) {
              try {
                this.deps.db.appState.set("todos", data.todos);
              } catch {
                // best effort
              }
            }
            break;
          case "tool_result":
            this.persistAgentAsset(data);
            break;
          case "context_usage":
            // Capture the latest main/custom/chat usage for this channel chat's
            // meter. Only the top-level agent scopes are relevant here (channel
            // turns run as Default or Custom Agent); sub/team usages are tracked
            // on the main chat session instead and ignored for channels.
            try {
              const scope = typeof data.agent === "string" ? data.agent.trim().toLowerCase() : "";
              if (scope === "main" || scope === "custom" || scope === "chat") {
                this.lastUsage.set(state.chatId, { ...data });
              }
            } catch {
              // Meter capture must never break the turn.
            }
            break;
          case "error":
            if (typeof data.message === "string" && data.message) {
              state.failed = data.message;
            }
            break;
          default:
            break;
        }
      }
    } catch {
      // The buffer ended abruptly — return whatever was collected.
    }

    // Safety net (last loop only): the loops ended and nothing reached the user, but the
    // model did produce a final answer — deliver it directly rather than staying silent.
    if (
      allowFallback &&
      state.failed === null &&
      !state.sendResponsesUsed &&
      state.finalText.trim().length > 0
    ) {
      await this.sendSafely(state, state.finalText.slice(0, 4000));
      state.sendResponsesUsed = true;
    }
  }

  private async sendSafely(state: LoopState, text: string): Promise<void> {
    try {
      await state.sender.sendMessage(state.target, text);
    } catch {
      // Delivery failures are reported to the model through tool results; fire-and-forget
      // notices must never break the turn.
    }
  }

  /** Best-effort direct send outside a watched loop (turn-level failure notices). */
  private async sendDirect(sender: ChannelSender, target: ChannelTarget, text: string): Promise<void> {
    try {
      await sender.sendMessage(target, text);
    } catch {
      // The channel itself is unreachable — nothing more we can do.
    }
  }

  /**
   * Mirror the web app's persistence of agent-created sub-agents/skills (see
   * streamDispatch.ts): created assets are upserted into the app-state documents,
   * deleted ones removed. Built-in defaults (id prefix "default-") are never touched.
   */
  private persistAgentAsset(data: Record<string, unknown>): void {
    try {
      if (data.name === "create_sub_agent" && data.ok === true) {
        const payload = (data.result as Record<string, unknown> | undefined)?.data as
          | Record<string, unknown>
          | undefined;
        const created = payload?.created_sub_agent as Record<string, unknown> | undefined;
        if (!created || typeof created.name !== "string") return;
        const raw = this.deps.db.appState.get("subAgents");
        const list: Array<Record<string, unknown>> = Array.isArray(raw)
          ? (raw as Array<Record<string, unknown>>)
          : [];
        const name = created.name.trim();
        const entry = {
          id: `sa_${randomId(8)}`,
          name,
          description: typeof created.description === "string" ? created.description : "",
          systemPrompt: typeof created.system_prompt === "string" ? created.system_prompt : "",
          tools: Array.isArray(created.tools)
            ? (created.tools as unknown[]).filter((t): t is string => typeof t === "string")
            : [],
          enabled: true,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        const index = list.findIndex(
          (item) =>
            typeof item.name === "string" &&
            (item.name as string).trim().toLowerCase() === name.toLowerCase() &&
            !(typeof item.id === "string" && (item.id as string).startsWith("default-")),
        );
        if (index === -1) list.unshift(entry);
        else list[index] = { ...list[index], ...entry, id: list[index]!.id };
        this.deps.db.appState.set("subAgents", list);
        return;
      }
      if (data.name === "delete_sub_agent" && data.ok === true) {
        const payload = (data.result as Record<string, unknown> | undefined)?.data as
          | Record<string, unknown>
          | undefined;
        const deleted = payload?.deleted_sub_agent;
        if (typeof deleted !== "string") return;
        const raw = this.deps.db.appState.get("subAgents");
        if (!Array.isArray(raw)) return;
        const key = deleted.trim().toLowerCase();
        this.deps.db.appState.set(
          "subAgents",
          (raw as Array<Record<string, unknown>>).filter(
            (item) =>
              !(typeof item.name === "string" &&
                (item.name as string).trim().toLowerCase() === key &&
                !(typeof item.id === "string" && (item.id as string).startsWith("default-"))),
          ),
        );
        return;
      }
      if (data.name === "create_skill" && data.ok === true) {
        const payload = (data.result as Record<string, unknown> | undefined)?.data as
          | Record<string, unknown>
          | undefined;
        const created = payload?.created_skill as Record<string, unknown> | undefined;
        if (!created || typeof created.name !== "string") return;
        const raw = this.deps.db.appState.get("skills");
        const list: Array<Record<string, unknown>> = Array.isArray(raw)
          ? (raw as Array<Record<string, unknown>>)
          : [];
        const name = created.name.trim();
        const skillFile =
          typeof created.skill_file === "string" && created.skill_file.trim()
            ? (created.skill_file as string).trim()
            : "SKILL.md";
        const files = Array.isArray(created.files)
          ? (created.files as Array<Record<string, unknown>>)
              .filter((f) => f && typeof f.path === "string" && (f.path as string).trim())
              .map((f) => ({
                path: (f.path as string).trim(),
                content: typeof f.content === "string" ? (f.content as string) : "",
              }))
          : [];
        const entryFile = files.find((f) => f.path.toLowerCase() === skillFile.toLowerCase());
        const entry: Record<string, unknown> = {
          id: `skill_${randomId(8)}`,
          name,
          description: typeof created.description === "string" ? created.description : "",
          skillFile,
          skillContent: entryFile?.content ?? "",
          files: files.filter((f) => f.path.toLowerCase() !== skillFile.toLowerCase()),
          enabled: true,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        const index = list.findIndex(
          (item) =>
            typeof item.name === "string" &&
            (item.name as string).trim().toLowerCase() === name.toLowerCase() &&
            !(typeof item.id === "string" && (item.id as string).startsWith("default-")),
        );
        if (index === -1) list.unshift(entry);
        else list[index] = { ...list[index], ...entry, id: list[index]!.id };
        this.deps.db.appState.set("skills", list);
        return;
      }
      if (data.name === "delete_skill" && data.ok === true) {
        const payload = (data.result as Record<string, unknown> | undefined)?.data as
          | Record<string, unknown>
          | undefined;
        const deleted = payload?.deleted_skill;
        if (typeof deleted !== "string") return;
        const raw = this.deps.db.appState.get("skills");
        if (!Array.isArray(raw)) return;
        const key = deleted.trim().toLowerCase();
        this.deps.db.appState.set(
          "skills",
          (raw as Array<Record<string, unknown>>).filter(
            (item) =>
              !(typeof item.name === "string" &&
                (item.name as string).trim().toLowerCase() === key &&
                !(typeof item.id === "string" && (item.id as string).startsWith("default-"))),
          ),
        );
      }
    } catch {
      // Persistence must never break the turn.
    }
  }

  private buildRunContext(): ReturnType<typeof resolveChannelRunContext> {
    return resolveChannelRunContext(this.deps.db, this.deps.config, this.deps.mainAgentPrompts);
  }
}

interface LoopState {
  chatId: string;
  connection: ChannelConnection;
  sender: ChannelSender;
  target: ChannelTarget;
  sendResponsesUsed: boolean;
  finalText: string;
  failed: string | null;
}

/** Short chat id for user-facing messages (first 8 chars). */
function shortId(chatId: string): string {
  return chatId.slice(0, 8);
}
