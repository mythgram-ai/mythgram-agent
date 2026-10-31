/**
 * The background memory agent ("memoryagent").
 *
 * A fully backend-side, autonomous agent that starts in a brand-new session every time the
 * main agent completes a turn. It receives the COMPLETE main-agent context (untruncated),
 * summarizes the session, and rewrites/updates the user's memory files — session-memory.md
 * (short-term session memory, 5000 chars), MEMORY.md (long-term memory), USER.md and SOUL.md
 * — using the full set of memory operation tools. Requests flow through a strict FIFO queue
 * (one run at a time), runs are unstoppable with no iteration limit, and every run's stream
 * and outcome is stored in the local SQLite database.
 */
export { MemoryAgentService } from "./service.js";
export { runMemoryAgent, type MemoryAgentRunOutcome } from "./runner.js";
export { buildMemoryAgentSystemPrompt } from "./systemprompt.js";
export { buildMemoryAgentUserMessage } from "./context.js";
export { MemoryAgentEventPersister } from "./eventPersister.js";
export {
  MEMORY_AGENT_NAME,
  MEMORY_AGENT_TOOLS,
  type MemoryAgentBuildRequest,
} from "./types.js";
