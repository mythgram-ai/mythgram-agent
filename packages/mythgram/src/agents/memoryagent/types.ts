import type { MemoryFile } from "../tools/types.js";
import type { StoredMessage } from "../../services/sessionStore.js";

/** The canonical name of the background memory agent. */
export const MEMORY_AGENT_NAME = "memoryagent";

/**
 * The only tools the memory agent is granted: the full set of memory operation tools.
 * It cannot touch files, the shell, the web, or sub-agents — its whole job is memory.
 */
export const MEMORY_AGENT_TOOLS: readonly string[] = [
  "memory_list",
  "memory_search",
  "memory_read",
  "memory_write",
  "memory_edit",
  "memory_delete",
];

/**
 * A memory-build request enqueued when the main agent finishes a turn. It carries the
 * COMPLETE main-agent context — the full untruncated transcript (user prompts, assistant
 * answers and reasoning, every tool call and result), the user's latest prompt, and the
 * final memory snapshot at turn end — plus the exact provider/model/credentials the user
 * selected for the main agent, so the memory agent runs on the same model provider.
 */
export interface MemoryAgentBuildRequest {
  /** The chat session whose completed turn triggered this memory build. */
  chatId: string;
  /** The user prompt that started the completed turn. */
  userMessage: string;
  /** Deep-copied FULL main-agent transcript at turn end — nothing truncated. */
  transcript: StoredMessage[];
  /** The memory files as they stood at the END of the main agent's turn. */
  memoryFiles: MemoryFile[];
  /** Whether the main agent's turn completed successfully. */
  turnOk: boolean;
  /** Whether the turn was aborted by the user. */
  aborted: boolean;
  // Provider selection — identical to what the user chose for the main agent.
  provider: string;
  model: string;
  apiKey: string;
  baseUrl?: string;
  customProvider?: unknown;
  temperature?: number;
  effort?: string;
}
