import type { Provider } from "../../providers/types.js";
import type { ToolRegistry, OpenAIToolSchema } from "../../tools/registry.js";
import type { StoredMessage } from "../../../services/sessionStore.js";
import type { ToolContext } from "../../tools/types.js";
import { runTeamAgentLoop } from "../agentLoop.js";
import { buildCeoSystemPrompt } from "./systemprompt.js";
import type { ConnectorRuntime } from "../../connectors/runtime.js";
import type { McpRuntime } from "../../mcp/runtime.js";
import type { AgentTeamDefinition, TeamAgentRunResult } from "../types.js";
import type { CeoAgentDefinition } from "./types.js";

/**
 * The CEO agent runtime. The CEO owns the conversation with the user: it plans at the organizational
 * level, assigns tasks to the teams' head/leaders, reviews their completion reports, and delivers the
 * final result. It is a real agent with the full tool surface plus the CEO-only tools
 * (assign_tasks_to_teams, list_teams). This wrapper builds the CEO's system prompt and runs one
 * streaming agentic loop; the CEO orchestrator drives when it runs. Reuses the exact same agent loop
 * (runTeamAgentLoop) as the head/member agents — the CEO layer is built ON the same multi-agent
 * runtime, not a fork of it.
 */
export interface RunCeoAgentArgs {
  ceo: CeoAgentDefinition;
  teams: AgentTeamDefinition[];
  workspaceRoot: string;
  /** The CEO's conversation (mutated in place across runs and turns). */
  messages: StoredMessage[];
  allowedTools: Set<string>;
  toolSchemas: OpenAIToolSchema[];
  toolCtx: ToolContext;
  /** The turn's connector runtime (connected Composio apps), if any. */
  connectors?: ConnectorRuntime;
  /** The turn's MCP runtime (connected MCP servers), if any. */
  mcp?: McpRuntime;
  /** Extra system-prompt tail (e.g. the connected-apps hint), if any. */
  systemSuffix?: string;
  send: (event: string, data: Record<string, unknown>) => void;
  signal?: AbortSignal;
  provider: Provider;
  tools: ToolRegistry;
  model: string;
  apiKey: string;
  baseUrl?: string;
  temperature?: number;
  effort?: string;
  /** Provider id snapshot for display (when known). */
  providerId?: string;
  contextLimit?: number | null;
  contextManagementMethod?: string;
  slidingWindowTruncatePercent?: number;
}

export async function runCeoAgent(args: RunCeoAgentArgs): Promise<TeamAgentRunResult> {
  const basePrompt = buildCeoSystemPrompt(args.ceo, args.teams, args.workspaceRoot);
  const systemPrompt =
    args.systemSuffix && args.systemSuffix.trim().length > 0
      ? `${basePrompt}\n\n${args.systemSuffix.trim()}`
      : basePrompt;
  return runTeamAgentLoop({
    provider: args.provider,
    tools: args.tools,
    model: args.model,
    apiKey: args.apiKey,
    baseUrl: args.baseUrl,
    temperature: args.temperature,
    effort: args.effort,
    systemPrompt,
    messages: args.messages,
    allowedTools: args.allowedTools,
    toolSchemas: args.toolSchemas,
    toolCtx: args.toolCtx,
    connectors: args.connectors,
    mcp: args.mcp,
    send: args.send,
    signal: args.signal,
    usageScope: "ceo",
    providerId: args.providerId,
    contextLimit: typeof args.contextLimit === "number" ? args.contextLimit : null,
    contextManagementMethod: args.contextManagementMethod,
    slidingWindowTruncatePercent: args.slidingWindowTruncatePercent,
  });
}
