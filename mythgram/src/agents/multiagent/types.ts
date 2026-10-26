import type { StoredMessage } from "../../services/sessionStore.js";
import type { ConnectorWire } from "../connectors/index.js";
import type { McpServerSelection } from "../mcp/index.js";
import type {
  KnowledgeFile,
  MemoryFile,
  SkillDefinition,
  SubAgentDefinition,
  TeamAgentRole,
  TeamAgentStatus,
  TodoItem,
} from "../tools/types.js";

/**
 * One member of a multi-agent team, as defined by the user in the frontend and sent to the backend
 * with each turn. The member's `name` doubles as its unique agent id used for delegation/messaging.
 */
export interface TeamMemberDefinition {
  /** Unique agent id / name (e.g. "Niko"). */
  name: string;
  /** Short description of the member's specialization (shown by list_agent_team_members). */
  description: string;
  /** The system prompt that specialises this member. */
  system_prompt: string;
}

/**
 * A full agent-team definition: one head/leader plus N specialist members. Authored in the frontend,
 * stored in SQLite (app_state `agentTeams`), and sent with each turn when the team is active.
 */
export interface AgentTeamDefinition {
  /** Stable team id. */
  id: string;
  /** Human-readable team name (e.g. "saas build"). */
  name: string;
  /** The head/leader's agent id / name (e.g. "Elio"). */
  leader_name: string;
  /** The head/leader's system prompt. */
  leader_system_prompt: string;
  /** The specialist members. */
  members: TeamMemberDefinition[];
}

/**
 * A turn request for a multi-agent team. Mirrors the single-agent RunAgentRequest's provider +
 * tooling fields, plus the resolved team and the send_message_to_team gate.
 */
export interface RunTeamRequest {
  chatId: string;
  userMessage: string;
  /** The active team definition for this turn. */
  team: AgentTeamDefinition;
  /** Whether the sensitive send_message_to_team tool is enabled (user Settings). */
  sendMessageToTeamEnabled: boolean;

  provider: string;
  model: string;
  apiKey: string;
  baseUrl?: string;
  customProvider?: unknown;
  temperature?: number;
  effort?: string;

  // Web tool keys/provider (forwarded to the agents' web tools).
  tavilyApiKey?: string;
  exaApiKey?: string;
  serpapiApiKey?: string;
  searchProvider?: "duckduckgo" | "tavily" | "exa" | "serpapi";
  fetchProvider?: "builtin" | "firecrawl";
  firecrawlApiKey?: string;

  // Shared team tooling — every agent shares one memory/knowledge/skill/sub-agent surface.
  subAgents?: SubAgentDefinition[];
  skills?: SkillDefinition[];
  todos?: TodoItem[];
  memory?: MemoryFile[];
  knowledge?: KnowledgeFile[];
  /** Composio API key for this turn (from frontend Settings). */
  composioApiKey?: string;
  /** The turn's authenticated app connectors (each contributes its full tool catalog). */
  connectors?: ConnectorWire[];
  /**
   * The turn's MCP servers, by server id. Only enabled servers are loaded;
   * each contributes its FULL tool catalog (minus user-disabled tools).
   * Undefined/empty = every enabled server. Secrets stay server-side.
   */
  mcpServers?: McpServerSelection[];
  /**
   * Effective context-window limit (tokens) for the selected model. Used with
   * provider-reported prompt_tokens for automatic sub-agent summarization
   * handoff. Absent = handoff disabled (safe).
   */
  contextLimit?: number | null;
  /**
   * Utilization fraction (0..1) that triggers sub-agent summarization.
   * Defaults to the server summaryThreshold (90%).
   */
  summaryThreshold?: number;
  /** Context-management method ("summarization" default, or "sliding_window"). */
  contextManagementMethod?: string;
  /** Fraction freed per sliding-window trigger (default 0.3). */
  slidingWindowTruncatePercent?: number;
}

/**
 * How a mailbox message was produced — shapes the framing the recipient agent sees. `system` is an
 * automatic, orchestrator-generated nudge (e.g. reminding a member to report back to the leader); it
 * is not sent by any agent and does not count against the inter-agent message budget.
 */
export type TeamMessageKind = "user" | "delegate" | "message" | "to_leader" | "system";

/** A single message sitting in an agent's mailbox, waiting to be delivered when it is free. */
export interface MailboxMessage {
  /** Sender agent id ("__user__" for the human's turn-starting message). */
  from: string;
  /** The message text. */
  message: string;
  kind: TeamMessageKind;
}

/** The persistent per-agent context inside a team session (survives across turns of one chat). */
export interface TeamAgentContext {
  id: string;
  role: TeamAgentRole;
  description: string;
  systemPrompt: string;
  /** The agent's full conversation, preserved across turns and re-delegations. */
  messages: StoredMessage[];
}

/** Result of one team agent's completed LLM loop run. */
export interface TeamAgentRunResult {
  ok: boolean;
  aborted: boolean;
  output: string;
  error?: string;
}

/** The sender id used for the human's turn-starting message. */
export const USER_SENDER_ID = "__user__";

/** The sender id used for automatic, orchestrator-generated system messages (e.g. leader-report nudges). */
export const SYSTEM_SENDER_ID = "__system__";

// ---- SSE event names emitted by a team run (all stamped onto the shared turn buffer) ----------

/** Emitted once at run start with the full team roster so the UI can pre-render every agent. */
export const EV_TEAM_START = "team_start";
/** An agent began (or resumed) a run; carries the trigger reason. */
export const EV_AGENT_START = "team_agent_start";
/** Streamed reasoning delta for one agent. */
export const EV_AGENT_REASONING = "team_agent_reasoning";
/** Streamed answer-token delta for one agent. */
export const EV_AGENT_TOKEN = "team_agent_token";
/** A tool call an agent made. */
export const EV_AGENT_TOOL_CALL = "team_agent_tool_call";
/** The result of a tool call an agent made. */
export const EV_AGENT_TOOL_RESULT = "team_agent_tool_result";
/** An agent finished one LLM loop (a single reply/segment). */
export const EV_AGENT_SEGMENT = "team_agent_segment";
/** An agent went idle after draining all of its queued work. */
export const EV_AGENT_DONE = "team_agent_done";
/** A message was delivered from one agent to another (for the monitoring panel + inline log). */
export const EV_TEAM_MESSAGE = "team_message";
/** An agent's status/queue-depth changed (for the monitoring panel). */
export const EV_TEAM_STATUS = "team_status";

/** Public status snapshot for the monitor. */
export interface TeamAgentStatusSnapshot {
  agent_id: string;
  role: TeamAgentRole;
  status: TeamAgentStatus;
  queued_messages: number;
}
