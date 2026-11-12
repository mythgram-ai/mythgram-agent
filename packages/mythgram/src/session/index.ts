/**
 * Multi-session system — public surface.
 *
 * Mythgram runs an arbitrary number of chat sessions concurrently. Each session
 * owns an independent provider transcript, SSE event buffer, and abort controller,
 * so the user can launch a second task without interrupting the first.
 *
 * {@link SessionManager} is the run registry layered over {@link SessionStore};
 * {@link LiveRun} / {@link RunningSessionInfo} describe an active turn.
 */
export * from "./types.js";
export { SessionManager } from "./manager.js";
