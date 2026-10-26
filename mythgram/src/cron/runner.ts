/**
 * ScheduleRunner — executes one schedule run through the EXISTING agent runtime.
 *
 * Execution path: `schedule → selected agent → existing runtime → prompt`.
 *   - Default Agent → the shared `AgentRunner` (same ReAct loop as chat turns).
 *   - Custom Agent  → the shared `CustomAgentRunner`, which parameterizes the
 *     SAME core runtime with the agent's own system prompt + selected tools.
 *
 * No separate agent implementation exists for scheduling: the request is built
 * exactly like a chat turn (`RunAgentRequest`), with provider credentials and
 * shared tooling (memory, knowledge, sub-agents, skills, todos, web keys)
 * resolved from the persisted app-state documents, so a scheduled run behaves
 * like a turn the user started themselves.
 *
 * Each run uses an ephemeral in-memory session + event buffer (never the live
 * chat store), so scheduled work can never interfere with — or be stopped by —
 * the user's open chats. The outcome (output text, status, timestamps) is
 * recorded in `schedule_runs` for the history/logs UI.
 */

import type { AppConfig } from "../config.js";
import type { ProviderRegistry } from "../agents/providers/registry.js";
import type { ToolRegistry } from "../agents/tools/registry.js";
import type { RunAgentRequest, AgentRunner } from "../agents/agent.js";
import type { CustomAgentRunner } from "../agents/customagent/index.js";
import type { CustomAgentManager } from "../agents/customagent/index.js";
import type { CustomAgentConfig } from "../agents/customagent/index.js";
import type { McpManager } from "../agents/mcp/index.js";
import type { ConnectorWire } from "../agents/connectors/index.js";
import type { McpServerSelection } from "../agents/mcp/index.js";
import type { PlanApprovalStore } from "../services/planApprovalStore.js";
import type { QuestionStore } from "../services/questionStore.js";
import type { ChatSession } from "../services/sessionStore.js";
import { SessionEventBuffer } from "../services/eventBuffer.js";
import { normalizeMemoryFiles } from "../agents/memory.js";
import { normalizeKnowledgeFiles } from "../agents/knowledge.js";
import { normalizeTodos } from "../agents/todos.js";
import { normalizeEffort } from "../agents/providers/reasoning.js";
import { catalogContextLimit, manualContextLimit } from "../agents/contextLimits.js";
import type {
  MemoryFile,
  KnowledgeFile,
  SkillDefinition,
  SubAgentDefinition,
  TodoItem,
} from "../agents/tools/types.js";
import type { MythgramDatabase } from "../database/index.js";
import type { MemoryAgentService } from "../agents/memoryagent/index.js";
import { createScheduleRunId } from "../database/index.js";
import type { ScheduleConfig } from "./types.js";
import type { ScheduleStore } from "./store.js";

/** Hard cap on one scheduled run (abort + fail past this point). */
export const SCHEDULE_RUN_TIMEOUT_MS = 30 * 60_000;

/** Max output characters stored per run (history must stay bounded). */
export const SCHEDULE_RUN_OUTPUT_MAX = 50_000;

export interface ScheduleRunnerDeps {
  providers: ProviderRegistry;
  tools: ToolRegistry;
  config: AppConfig;
  db: MythgramDatabase;
  store: ScheduleStore;
  /** The shared main-agent runtime (reused verbatim for Default-Agent runs). */
  agent: AgentRunner;
  /** The shared custom-agent runtime (reused verbatim for Custom-Agent runs). */
  customAgentRunner: CustomAgentRunner;
  customAgents: CustomAgentManager;
  planApprovals: PlanApprovalStore;
  askQuestions: QuestionStore;
  memoryAgent?: MemoryAgentService;
  mcpManager?: McpManager;
}

export interface ExecuteOptions {
  /** "auto" for due schedules, "manual" for user-triggered runs. */
  trigger: "auto" | "manual";
  /** Abort signal for shutdown; the run also has its own timeout. */
  signal?: AbortSignal;
  /**
   * Invoked synchronously with the new run id as soon as the run row is created — before
   * the agent execution starts. Lets the scheduler hand the run id back immediately while
   * the run continues in the background.
   */
  onStarted?: (runId: string) => void;
}

export interface ExecuteOutcome {
  runId: string;
  ok: boolean;
  output: string;
  error?: string;
}

/**
 * Provider credentials + shared tooling snapshot resolved from the persisted
 * app-state documents at execution time (the same documents the frontend
 * syncs), so background runs use the user's current settings.
 */
interface ResolvedRunContext {
  provider: string;
  model: string;
  apiKey: string;
  baseUrl?: string;
  customProvider?: unknown;
  temperature?: number;
  effort?: string;
  searchProvider: "duckduckgo" | "tavily" | "exa" | "serpapi";
  fetchProvider: "builtin" | "firecrawl";
  tavilyApiKey?: string;
  exaApiKey?: string;
  serpapiApiKey?: string;
  firecrawlApiKey?: string;
  composioApiKey?: string;
  connectors: ConnectorWire[];
  mcpServers?: McpServerSelection[];
  subAgents: SubAgentDefinition[];
  skills: SkillDefinition[];
  todos: TodoItem[];
  memory: MemoryFile[];
  knowledge: KnowledgeFile[];
  memoryAgentEnabled: boolean;
  memoryAgentInterval: number;
  /**
   * Effective context-window limit (tokens) for automatic summarization
   * handoff. Manual Settings entry when present (sync); the runner upgrades
   * a null to the cached provider catalog before execution. Null = disabled.
   */
  contextLimit: number | null;
  /** Utilization fraction (0..1) triggering summarization (server default). */
  summaryThreshold: number;
  /** Context-management method from Settings ("summarization" default). */
  contextManagementMethod?: string;
  /** Fraction freed per sliding-window trigger (default 0.3). */
  slidingWindowTruncatePercent?: number;
}

export class ScheduleRunner {
  constructor(private readonly deps: ScheduleRunnerDeps) {}

  /**
   * Latest captured `context_usage` per schedule (from the most recent finished run).
   * Powers the Schedules dashboard meter + raw-context view. In-memory only:
   * a restart clears it (raw schedule prompt stays available, usage shows as
   * unavailable until the next run) — same posture as channels.
   */
  private readonly lastUsage = new Map<string, Record<string, unknown>>();

  /** Latest captured context usage for a schedule, if any run has reported it. */
  lastContextUsage(scheduleId: string): Record<string, unknown> | null {
    return this.lastUsage.get(scheduleId) ?? null;
  }

  /**
   * Execute one run of `schedule` to completion and record the outcome.
   * Never throws — failures are recorded on the run row and the schedule.
   */
  async execute(schedule: ScheduleConfig, options: ExecuteOptions): Promise<ExecuteOutcome> {
    const { db } = this.deps;
    const runId = createScheduleRunId();
    const startedAt = Date.now();
    db.scheduleRuns.create(runId, schedule.id, options.trigger);
    // Hand the run id back synchronously so manual "run now" calls return immediately
    // while the execution continues in the background.
    options.onStarted?.(runId);

    // The per-schedule chat id keeps sub-agent sessions + memory-agent
    // attribution scoped to this schedule across runs (never a live chat).
    const chatId = `sched_${schedule.id}`;
    const buffer = new SessionEventBuffer();
    const abortController = new AbortController();
    const onParentAbort = (): void => abortController.abort();
    options.signal?.addEventListener("abort", onParentAbort, { once: true });
    const timeout = setTimeout(() => abortController.abort(), SCHEDULE_RUN_TIMEOUT_MS);
    if (typeof timeout.unref === "function") timeout.unref();

    const session: ChatSession = {
      chatId,
      messages: [],
      eventBuffer: buffer,
      abortController,
      running: true,
      createdAt: startedAt,
      updatedAt: startedAt,
    };

    // Collect the streamed outcome alongside execution (message_complete
    // carries the final answer; error events carry provider failures).
    const collector = collectOutcome(buffer, (usage) => {
      try {
        this.lastUsage.set(schedule.id, usage);
      } catch {
        // Meter capture must never break the run.
      }
    });
    let outcome: ExecuteOutcome;
    try {
      const ctx = this.resolveContext(schedule);
      if (!ctx.provider || !ctx.model) {
        throw new Error(
          "No provider/model is configured. Open Settings, add an API key, and pick a model first.",
        );
      }
      // Local providers need no key; everything else does.
      if (!ctx.apiKey && ctx.provider !== "local" && !ctx.customProvider) {
        throw new Error(
          `No API key is configured for provider "${ctx.provider}". Add one in Settings first.`,
        );
      }

      // Automatic summarization handoff needs the model's context window. The
      // manual Settings entry (if any) is already in ctx; otherwise resolve
      // the cached provider catalog once per run so a long scheduled task
      // compacts exactly like a web turn. Unknown stays null (handoff safely
      // disabled) and never fails the run.
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

      const request = this.buildRequest(schedule, ctx);
      if (schedule.agentType === "custom") {
        const agent = this.resolveCustomAgent(schedule);
        if (!agent) {
          throw new Error(
            "The Custom Agent selected for this schedule no longer exists. Edit the schedule and pick another agent.",
          );
        }
        await this.deps.customAgentRunner.run(request, agent, session, buffer, abortController.signal);
      } else {
        await this.deps.agent.run(request, session, buffer, abortController.signal);
      }

      const collected = await collector;
      outcome = {
        runId,
        ok: collected.ok,
        output: truncate(collected.output, SCHEDULE_RUN_OUTPUT_MAX),
        error: collected.error,
      };
      if (!outcome.ok && !outcome.error) outcome.error = "The agent finished without success.";
    } catch (error) {
      abortController.abort();
      buffer.setDone();
      const collected = await collector;
      const message = error instanceof Error ? error.message : String(error);
      outcome = {
        runId,
        ok: false,
        output: truncate(collected.output, SCHEDULE_RUN_OUTPUT_MAX),
        error: message,
      };
    } finally {
      clearTimeout(timeout);
      options.signal?.removeEventListener("abort", onParentAbort);
    }

    this.recordOutcome(schedule, runId, outcome);
    return outcome;
  }

  /** Resolve the Custom Agent for a run, or null when it no longer exists. */
  private resolveCustomAgent(schedule: ScheduleConfig): CustomAgentConfig | null {
    if (schedule.agentType !== "custom" || !schedule.customAgentId) return null;
    return this.deps.customAgents.get(schedule.customAgentId);
  }

  /**
   * Build the turn request exactly like a chat turn: provider/model/keys from
   * the resolved context, shared tooling from the persisted documents, and the
   * schedule prompt as the user message.
   */
  private buildRequest(schedule: ScheduleConfig, ctx: ResolvedRunContext): RunAgentRequest {
    return {
      chatId: `sched_${schedule.id}`,
      userMessage: schedule.prompt,
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
  }

  /**
   * Resolve provider credentials + shared tooling from the persisted app-state
   * documents. The schedule stores a provider/model snapshot (chosen in the
   * setup UI); secrets always come from the current Settings document so key
   * rotations apply to background runs without re-editing schedules.
   */
  private resolveContext(schedule: ScheduleConfig): ResolvedRunContext {
    const { db, config } = this.deps;
    const settings = asRecord(db.appState.get("settings"));
    const customProviders = db.appState.get("customProviders");

    // Provider/model: the schedule snapshot wins when set, else current Settings.
    const provider = schedule.provider || str(settings.provider) || "openrouter";
    const model = schedule.model || str(settings.model);

    const apiKeys = asRecord(settings.apiKeys);
    const customList: Array<Record<string, unknown>> = Array.isArray(customProviders)
      ? (customProviders as Array<Record<string, unknown>>)
      : [];
    const customEntry = customList.find((p) => str(p.id) === provider);

    let apiKey = str(apiKeys[provider]);
    let baseUrl: string | undefined = str(settings.baseUrl) || undefined;
    let customProvider: unknown;
    if (provider.startsWith("custom_") || customEntry) {
      const headers: Record<string, string> = {};
      const rawHeaders = customEntry ? customEntry.headers : undefined;
      if (Array.isArray(rawHeaders)) {
        for (const pair of rawHeaders) {
          const rec = pair as Record<string, unknown>;
          if (typeof rec.key === "string" && rec.key.trim()) headers[rec.key.trim()] = str(rec.value);
        }
      }
      customProvider = {
        id: provider,
        name: customEntry ? str(customEntry.name) : provider,
        model,
        baseUrl: customEntry ? str(customEntry.baseUrl) : "",
        apiKey: customEntry ? str(customEntry.apiKey) : "",
        headers,
      };
      const customKey = customEntry ? str(customEntry.apiKey) : "";
      if (customKey) apiKey = customKey;
      baseUrl = undefined;
    }

    const temperature = numOrUndefined(settings.temperature);
    const effort = normalizeEffort(settings.effort) ?? normalizeEffort("high");
    const searchProvider = normalizeSearchProvider(settings.searchProvider, config.searchProvider);
    const fetchProvider: "builtin" | "firecrawl" =
      settings.fetchProvider === "firecrawl" ? "firecrawl" : "builtin";

    // Shared tooling snapshots (normalized exactly like chat turns).
    const subAgents = normalizeSubAgentList(db.appState.get("subAgents"));
    const skills = normalizeSkillList(db.appState.get("skills"));
    const todos = normalizeTodos(db.appState.get("todos"));
    const memory = normalizeMemoryFiles(db.appState.get("memory"));
    const knowledge = normalizeKnowledgeFiles(db.appState.get("knowledge"));

    // Connectors: only ACTIVE stored connections travel (same rule as chat turns).
    const connectors: ConnectorWire[] = [];
    const storedConnectors = db.appState.get("connectors");
    if (Array.isArray(storedConnectors)) {
      for (const item of storedConnectors) {
        const rec = item as Record<string, unknown>;
        const connectorId = str(rec.connectorId ?? rec.connector_id).trim().toLowerCase();
        const connectedAccountId = str(rec.connectedAccountId ?? rec.connected_account_id).trim();
        if (connectorId && connectedAccountId && rec.status === "active") {
          connectors.push({ connectorId: connectorId as ConnectorWire["connectorId"], connectedAccountId });
        }
      }
    }
    const composioApiKey = str(settings.composioApiKey) || config.composioApiKey || undefined;

    const memoryAgentEnabled = settings.memoryAgentEnabled === "no" ? false : true;
    const memoryAgentInterval = clampInterval(settings.memoryAgentInterval);

    return {
      provider,
      model,
      apiKey,
      baseUrl,
      customProvider,
      temperature,
      effort,
      searchProvider,
      fetchProvider,
      tavilyApiKey: str(settings.tavilyApiKey) || config.tavilyApiKey || undefined,
      exaApiKey: str(settings.exaApiKey) || config.exaApiKey || undefined,
      serpapiApiKey: str(settings.serpapiApiKey) || config.serpapiApiKey || undefined,
      firecrawlApiKey: str(settings.firecrawlApiKey) || config.firecrawlApiKey || undefined,
      composioApiKey,
      connectors,
      mcpServers: undefined, // undefined = every enabled MCP server (same as chat turns)
      subAgents,
      skills,
      todos,
      memory,
      knowledge,
      memoryAgentEnabled,
      memoryAgentInterval,
      contextLimit: manualContextLimit(settings.manualContextLimits, provider, model),
      summaryThreshold: config.summaryThreshold ?? 0.9,
      contextManagementMethod: normalizeScheduleContextMethod(settings.contextManagementMethod),
      slidingWindowTruncatePercent: normalizeScheduleTruncatePercent(
        settings.slidingWindowTruncatePercent,
        config.slidingWindowTruncatePercent,
      ),
    };
  }

  /** Persist the run outcome + advance the schedule (counts, last/next, completion). */
  private recordOutcome(
    schedule: ScheduleConfig,
    runId: string,
    outcome: ExecuteOutcome,
  ): void {
    const { db, store } = this.deps;
    const finishedAt = Date.now();
    try {
      db.scheduleRuns.finish(runId, {
        status: outcome.ok ? "completed" : "failed",
        output: outcome.output,
        error: outcome.ok ? null : (outcome.error ?? "Unknown error"),
      });
    } catch {
      // best effort — the run already happened
    }
    try {
      db.scheduleRuns.prune(schedule.id, 200);
    } catch {
      // best effort
    }
    try {
      store.applyRunResult(schedule.id, {
        ok: outcome.ok,
        error: outcome.error ?? null,
        startedAt: finishedAt,
        finishedAt,
      });
    } catch {
      // best effort — history already recorded
    }
  }
}

/** Collect the final answer / terminal state from a run's event buffer. */
async function collectOutcome(
  buffer: SessionEventBuffer,
  onUsage?: (usage: Record<string, unknown>) => void,
): Promise<{ ok: boolean; output: string; error?: string }> {
  let output = "";
  let ok = true;
  let error: string | undefined;
  try {
    for await (const event of buffer.subscribe(-1)) {
      const data = event.data as Record<string, unknown>;
      if (event.event === "message_complete" && typeof data.content === "string") {
        output = data.content;
      } else if (event.event === "context_usage") {
        // Capture the latest top-level usage for the schedule meter. Sub/team
        // scopes are ignored here (schedule runs are single-agent turns).
        try {
          const scope = typeof data.agent === "string" ? data.agent.trim().toLowerCase() : "";
          if (scope === "main" || scope === "custom" || scope === "chat") {
            onUsage?.({ ...data });
          }
        } catch {
          // Meter capture must never break the run.
        }
      } else if (event.event === "error" && typeof data.message === "string") {
        ok = false;
        error = data.message;
      } else if (event.event === "done") {
        if (data.ok === false && !output) {
          ok = false;
          if (!error) {
            error = data.aborted === true
              ? "The run was aborted before completing."
              : "The agent finished without success.";
          }
        }
      }
    }
  } catch {
    // The buffer ended abruptly — return whatever was collected.
  }
  return { ok, output, error };
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n... [truncated ${text.length - max} chars]`;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function numOrUndefined(value: unknown): number | undefined {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(n)) return undefined;
  return Math.min(2, Math.max(0, n));
}

function clampInterval(value: unknown): number {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(n)) return 3;
  return Math.min(50, Math.max(1, Math.floor(n)));
}

function normalizeScheduleContextMethod(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const v = value.trim().toLowerCase();
  if (v === "sliding_window" || v === "sliding-window" || v === "window") return "sliding_window";
  if (v === "summarization" || v === "summarisation" || v === "auto" || v === "summary") {
    return "summarization";
  }
  return undefined;
}

function normalizeScheduleTruncatePercent(value: unknown, fallback?: number): number | undefined {
  const n =
    typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
  if (Number.isFinite(n) && n > 0) {
    const fraction = n > 1 ? n / 100 : n;
    if (Number.isFinite(fraction)) return Math.min(0.9, Math.max(0.05, fraction));
  }
  if (typeof fallback === "number" && Number.isFinite(fallback) && fallback > 0) return fallback;
  return undefined;
}

function normalizeSearchProvider(
  value: unknown,
  fallback: "duckduckgo" | "tavily" | "exa" | "serpapi",
): "duckduckgo" | "tavily" | "exa" | "serpapi" {
  const v = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (v === "tavily" || v === "exa" || v === "serpapi") return v;
  if (v === "duckduckgo") return v;
  return fallback;
}

function normalizeSubAgentList(raw: unknown): SubAgentDefinition[] {
  if (!Array.isArray(raw)) return [];
  const out: SubAgentDefinition[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const name = str(r.name).trim();
    if (!name) continue;
    const systemPrompt = str(r.system_prompt) || str(r.systemPrompt);
    const tools = Array.isArray(r.tools) ? r.tools.filter((t): t is string => typeof t === "string") : [];
    out.push({
      name,
      description: str(r.description),
      system_prompt: systemPrompt,
      tools,
      enabled: r.enabled !== false,
    });
  }
  return out;
}

function normalizeSkillList(raw: unknown): SkillDefinition[] {
  if (!Array.isArray(raw)) return [];
  const out: SkillDefinition[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const name = str(r.name).trim();
    if (!name) continue;
    const skillFile = str(r.skill_file) || str(r.skillFile) || "SKILL.md";
    const files: Array<{ path: string; content: string }> = [];
    if (Array.isArray(r.files)) {
      for (const f of r.files) {
        if (!f || typeof f !== "object") continue;
        const fr = f as Record<string, unknown>;
        const p = str(fr.path).trim();
        if (!p) continue;
        files.push({ path: p, content: str(fr.content) });
      }
    }
    out.push({
      name,
      description: str(r.description),
      skillFile,
      files,
      enabled: r.enabled !== false,
    });
  }
  return out;
}
