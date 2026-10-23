/**
 * API routes — the single source of truth for every `/api/*` endpoint the frontend
 * calls. In the browser these same-origin routes are served by Vite's dev/preview
 * proxy, which forwards them to the gptloop backend (see `vite.config.ts`).
 *
 * This mirrors the Next.js App Router `src/app/api/<route>/route.ts` layout that
 * `frontend-2` used, expressed as a typed registry for the Vite/React app.
 */

export type HttpMethod = "GET" | "POST" | "PUT" | "DELETE";

export interface ApiRoute {
  /** Logical name used by the client (e.g. `chat.stream`). */
  name: string;
  method: HttpMethod;
  /** Path template, e.g. `/api/chat/abort/:chatId`. `:name` segments become params. */
  path: string;
  /** Description of the backend endpoint this route proxies to. */
  description: string;
}

export const API_ROUTES = {
  providersList: {
    name: "providers.list",
    method: "GET",
    path: "/api/providers",
    description: "List the configured LLM providers.",
  },
  providersModels: {
    name: "providers.models",
    method: "POST",
    path: "/api/providers/models",
    description: "Fetch the models available for a provider given its API key.",
  },
  toolsList: {
    name: "tools.list",
    method: "GET",
    path: "/api/tools",
    description: "List the tools a sub-agent can be granted (restricted sub-agent tools excluded).",
  },
  customAgentToolsList: {
    name: "tools.customAgent",
    method: "GET",
    path: "/api/tools/custom-agent",
    description: "List the tools a Custom Agent can be granted (all main-agent tools minus multi-agent tools).",
  },
  systemPrompt: {
    name: "systemPrompt.get",
    method: "GET",
    path: "/api/system-prompt",
    description: "Fetch the built Main Agent system prompt (used to pre-fill a Custom Agent's prompt).",
  },
  customAgentsList: {
    name: "customAgents.list",
    method: "GET",
    path: "/api/custom-agents",
    description: "List the persisted Custom Agents (top-level, user-created Main Agents).",
  },
  userProfilesList: {
    name: "profiles.list",
    method: "GET",
    path: "/api/profiles",
    description: "List the user profiles (account identities) with the active selection.",
  },
  userProfilesCreate: {
    name: "profiles.create",
    method: "POST",
    path: "/api/profiles",
    description: "Create a new user profile (username, description, logo avatar).",
  },
  userProfilesActive: {
    name: "profiles.active",
    method: "PUT",
    path: "/api/profiles/active",
    description: "Get or set the active user profile.",
  },
  promptLibraryList: {
    name: "promptLibrary.list",
    method: "GET",
    path: "/api/prompt-library",
    description: "List the user-saved reusable prompts (prompt library).",
  },
  promptLibraryCreate: {
    name: "promptLibrary.create",
    method: "POST",
    path: "/api/prompt-library",
    description: "Save a new reusable prompt into the prompt library.",
  },
  promptLibraryGet: {
    name: "promptLibrary.get",
    method: "GET",
    path: "/api/prompt-library/:id",
    description: "Load one saved prompt from the prompt library.",
  },
  promptLibraryUpdate: {
    name: "promptLibrary.update",
    method: "PUT",
    path: "/api/prompt-library/:id",
    description: "Update a saved prompt in the prompt library.",
  },
  promptLibraryDelete: {
    name: "promptLibrary.delete",
    method: "DELETE",
    path: "/api/prompt-library/:id",
    description: "Delete a saved prompt from the prompt library.",
  },
  chatStream: {
    name: "chat.stream",
    method: "POST",
    path: "/api/chat/stream",
    description: "Start a turn (or reconnect to an in-flight turn) and stream SSE.",
  },
  chatAbort: {
    name: "chat.abort",
    method: "POST",
    path: "/api/chat/abort/:chatId",
    description: "Cancel the running turn for a chat session.",
  },
  chatPlanDecision: {
    name: "chat.plan.decision",
    method: "POST",
    path: "/api/chat/plan/:chatId/:toolCallId",
    description: "Submit the user's decision (approve / cancel / edited) for a submitted plan.",
  },
  chatQuestionAnswer: {
    name: "chat.question.answer",
    method: "POST",
    path: "/api/chat/question/:chatId/:toolCallId",
    description: "Submit the user's answers to the ask_question_to_user tool.",
  },
  filesTree: {
    name: "files.tree",
    method: "GET",
    path: "/api/files/tree",
    description: "Read the workspace file tree (bounded) for the explorer.",
  },
  filesRead: {
    name: "files.read",
    method: "GET",
    path: "/api/files/read",
    description: "Read a single workspace file's contents.",
  },
  filesPreview: {
    name: "files.preview",
    method: "GET",
    path: "/api/files/preview",
    description: "Stream a workspace file inline for browser preview.",
  },
  filesDownload: {
    name: "files.download",
    method: "GET",
    path: "/api/files/download",
    description: "Download a workspace file as an attachment.",
  },
  filesUpload: {
    name: "files.upload",
    method: "POST",
    path: "/api/files/upload",
    description: "Upload prompt attachments (any type, 300 MB per file) into workspace uploads/.",
  },
  scrapeUrl: {
    name: "scrape.url",
    method: "POST",
    path: "/api/scrape",
    description: "Fetch a URL's content via the built-in scraper for the URL→knowledge flow.",
  },
  stateGet: {
    name: "state.get",
    method: "GET",
    path: "/api/state",
    description: "Load the full application state (settings, skills, memory, sessions…) from SQLite.",
  },
  stateSet: {
    name: "state.set",
    method: "POST",
    path: "/api/state/:key",
    description: "Persist one application-state document into the backend SQLite database.",
  },
  sessionGet: {
    name: "session.get",
    method: "GET",
    path: "/api/sessions/:id",
    description: "Load one session's snapshot + transcript from the backend SQLite database.",
  },
  sessionSave: {
    name: "session.save",
    method: "POST",
    path: "/api/sessions/:id",
    description: "Upsert a session (title and/or UI conversation snapshot) into SQLite.",
  },
  sessionDelete: {
    name: "session.delete",
    method: "DELETE",
    path: "/api/sessions/:id",
    description: "Delete a session and all of its stored data from SQLite.",
  },
  sessionFork: {
    name: "session.fork",
    method: "POST",
    path: "/api/sessions/:id/fork",
    description: "Fork a session into a full 100% copy (transcript, events, snapshot) under a new id.",
  },
  sessionContext: {
    name: "session.context",
    method: "GET",
    path: "/api/sessions/:id/context",
    description:
      "Load one session's Main Agent raw context (resolved system prompt + provider-format transcript). Main agent only; other agents return 400.",
  },
  memoryAgentRuns: {
    name: "memoryAgent.runs",
    method: "GET",
    path: "/api/memory-agent/runs",
    description: "List background memory-agent sessions (queued/running/completed/failed) + counts.",
  },
  memoryAgentRunGet: {
    name: "memoryAgent.run.get",
    method: "GET",
    path: "/api/memory-agent/runs/:id",
    description: "Load one memory-agent run's metadata from the backend SQLite database.",
  },
  memoryAgentRunStream: {
    name: "memoryAgent.run.stream",
    method: "POST",
    path: "/api/memory-agent/runs/:id/stream",
    description: "Attach to a memory-agent run's SSE stream (live) or replay a finished run.",
  },
  workspaceGet: {
    name: "workspace.get",
    method: "GET",
    path: "/api/workspace",
    description: "Read the agent's current workspace root (absolute path).",
  },
  workspaceSet: {
    name: "workspace.set",
    method: "POST",
    path: "/api/workspace",
    description: "Switch the agent's workspace root (absolute or relative to the current workspace).",
  },
  workspaceMkdir: {
    name: "workspace.mkdir",
    method: "POST",
    path: "/api/workspace/mkdir",
    description: "Create a folder (nested a/b/c supported) inside the current workspace.",
  },
  connectorsOverview: {
    name: "connectors.overview",
    method: "GET",
    path: "/api/connectors",
    description: "List the available app connectors (GitHub, Slack, …) with connection status.",
  },
  connectorsConnect: {
    name: "connectors.connect",
    method: "POST",
    path: "/api/connectors/connect",
    description: "Start connecting a connector — returns the OAuth redirect URL to visit.",
  },
  connectorsStatus: {
    name: "connectors.status",
    method: "GET",
    path: "/api/connectors/status/:connectedAccountId",
    description: "Poll one connected account and persist its latest status.",
  },
  connectorsRefresh: {
    name: "connectors.refresh",
    method: "POST",
    path: "/api/connectors/refresh",
    description: "Re-poll every stored connector connection.",
  },
  connectorsDisconnect: {
    name: "connectors.disconnect",
    method: "DELETE",
    path: "/api/connectors/:connectorId",
    description: "Disconnect a connector (remote best-effort + local removal).",
  },
  connectorsTools: {
    name: "connectors.tools",
    method: "GET",
    path: "/api/connectors/tools",
    description: "List every tool of every active connector (uncapped catalog).",
  },
  connectorsValidate: {
    name: "connectors.validate",
    method: "POST",
    path: "/api/connectors/validate",
    description: "Validate a Composio API key.",
  },
  mcpList: {
    name: "mcp.list",
    method: "GET",
    path: "/api/mcp",
    description: "List the MCP servers (remote + local) with connection status.",
  },
  mcpCreate: {
    name: "mcp.create",
    method: "POST",
    path: "/api/mcp",
    description: "Create an MCP server (remote URL or pasted local JSON).",
  },
  mcpValidate: {
    name: "mcp.validate",
    method: "POST",
    path: "/api/mcp/validate",
    description: "Test an unsaved MCP server payload (connect + list tools, no persistence).",
  },
  mcpTools: {
    name: "mcp.tools",
    method: "GET",
    path: "/api/mcp/tools",
    description: "List every tool of every connected MCP server (for the agent editors).",
  },
  mcpOAuthDiscover: {
    name: "mcp.oauth.discover",
    method: "POST",
    path: "/api/mcp/oauth/discover",
    description: "Discover a remote MCP server's OAuth configuration.",
  },
  mcpOAuthExchange: {
    name: "mcp.oauth.exchange",
    method: "POST",
    path: "/api/mcp/oauth/exchange",
    description: "Complete a frontend-mode OAuth flow (exchange code captured by the app).",
  },
  mcpOAuthStart: {
    name: "mcp.oauth.start",
    method: "POST",
    path: "/api/mcp/oauth/start",
    description: "Start the browser OAuth flow for an MCP server — returns the auth URL.",
  },
  mcpOAuthDisconnect: {
    name: "mcp.oauth.disconnect",
    method: "POST",
    path: "/api/mcp/:id/oauth/disconnect",
    description: "Forget an MCP server's OAuth tokens (disconnect authorization).",
  },
  mcpGet: {
    name: "mcp.get",
    method: "GET",
    path: "/api/mcp/:id",
    description: "Load one MCP server.",
  },
  mcpUpdate: {
    name: "mcp.update",
    method: "PUT",
    path: "/api/mcp/:id",
    description: "Update an MCP server (secrets are write-only).",
  },
  mcpDelete: {
    name: "mcp.delete",
    method: "DELETE",
    path: "/api/mcp/:id",
    description: "Delete an MCP server.",
  },
  mcpTest: {
    name: "mcp.test",
    method: "POST",
    path: "/api/mcp/:id/test",
    description: "Connect to an MCP server and list its tools (test/connect).",
  },
  mcpServerTools: {
    name: "mcp.server.tools",
    method: "GET",
    path: "/api/mcp/:id/tools",
    description: "Live tool catalog of one MCP server.",
  },
  schedulesList: {
    name: "schedules.list",
    method: "GET",
    path: "/api/schedules",
    description: "List every schedule with its display status (Active/Paused/Running/Completed/Failed).",
  },
  schedulesCreate: {
    name: "schedules.create",
    method: "POST",
    path: "/api/schedules",
    description: "Create a schedule (validated server-side, next run computed on save).",
  },
  schedulesPreview: {
    name: "schedules.preview",
    method: "POST",
    path: "/api/schedules/preview",
    description: "Preview the next fire times of a draft schedule payload (nothing persisted).",
  },
  schedulesTimezones: {
    name: "schedules.timezones",
    method: "GET",
    path: "/api/schedules/timezones",
    description: "List the IANA timezones supported for schedule wall-clock math.",
  },
  schedulesGet: {
    name: "schedules.get",
    method: "GET",
    path: "/api/schedules/:id",
    description: "Load one schedule with its display status.",
  },
  schedulesUpdate: {
    name: "schedules.update",
    method: "PUT",
    path: "/api/schedules/:id",
    description: "Update a schedule (partial payload, next run recomputed).",
  },
  schedulesDelete: {
    name: "schedules.delete",
    method: "DELETE",
    path: "/api/schedules/:id",
    description: "Delete a schedule and its execution history.",
  },
  schedulesDuplicate: {
    name: "schedules.duplicate",
    method: "POST",
    path: "/api/schedules/:id/duplicate",
    description: "Duplicate a schedule under a new id (starts paused).",
  },
  schedulesRun: {
    name: "schedules.run",
    method: "POST",
    path: "/api/schedules/:id/run",
    description: "Run a scheduled task manually right now.",
  },
  schedulesRuns: {
    name: "schedules.runs",
    method: "GET",
    path: "/api/schedules/:id/runs",
    description: "List a schedule's execution history (most recent first).",
  },
  schedulesRunGet: {
    name: "schedules.run.get",
    method: "GET",
    path: "/api/schedules/:id/runs/:runId",
    description: "Load one execution's logs (output, status, timestamps).",
  },
  schedulesContext: {
    name: "schedules.context",
    method: "GET",
    path: "/api/schedules/:id/context",
    description: "Load one schedule's raw context (task prompt + system prompt + latest usage).",
  },
  channelsList: {
    name: "channels.list",
    method: "GET",
    path: "/api/channels",
    description: "List the messaging-channel connections (public, no tokens).",
  },
  channelsCreate: {
    name: "channels.create",
    method: "POST",
    path: "/api/channels",
    description: "Create a channel connection (validates the token, then starts it).",
  },
  channelsGet: {
    name: "channels.get",
    method: "GET",
    path: "/api/channels/:id",
    description: "Load one channel connection.",
  },
  channelsUpdate: {
    name: "channels.update",
    method: "PUT",
    path: "/api/channels/:id",
    description: "Rename, replace the token, or enable/disable a channel.",
  },
  channelsDelete: {
    name: "channels.delete",
    method: "DELETE",
    path: "/api/channels/:id",
    description: "Delete a channel and its chats + transcripts.",
  },
  channelsSetAgent: {
    name: "channels.setAgent",
    method: "PUT",
    path: "/api/channels/:id/agent",
    description: "Set the agent serving new chats on a channel.",
  },
  channelsChats: {
    name: "channels.chats",
    method: "GET",
    path: "/api/channels/:id/chats",
    description: "List the per-user chats of a channel.",
  },
  channelsChatMessages: {
    name: "channels.chat.messages",
    method: "GET",
    path: "/api/channels/:id/chats/:chatId/messages",
    description: "Load one channel chat's transcript.",
  },
  channelsChatContext: {
    name: "channels.chat.context",
    method: "GET",
    path: "/api/channels/:id/chats/:chatId/context",
    description: "Load one channel chat's raw context (transcript + system prompt + latest usage).",
  },
  channelsChatAgent: {
    name: "channels.chat.agent",
    method: "PUT",
    path: "/api/channels/:id/chats/:chatId/agent",
    description: "Switch the agent serving one channel chat.",
  },
  channelsNewChat: {
    name: "channels.newChat",
    method: "POST",
    path: "/api/channels/:id/chats/:userKey/new-chat",
    description: "Start a fresh chat for an external user.",
  },
  ttsProviders: {
    name: "tts.providers",
    method: "GET",
    path: "/api/tts/providers",
    description: "List configured TTS providers + the static catalog with setup instructions.",
  },
  ttsProviderCreate: {
    name: "tts.provider.create",
    method: "POST",
    path: "/api/tts/providers",
    description: "Create a custom TTS provider or upsert a built-in one.",
  },
  ttsProviderUpdate: {
    name: "tts.provider.update",
    method: "PUT",
    path: "/api/tts/providers/:id",
    description: "Update a TTS provider (write-only API key, base URL, model, voice).",
  },
  ttsProviderDelete: {
    name: "tts.provider.delete",
    method: "DELETE",
    path: "/api/tts/providers/:id",
    description: "Delete a custom TTS provider.",
  },
  ttsProviderModels: {
    name: "tts.provider.models",
    method: "GET",
    path: "/api/tts/providers/:id/models",
    description: "Fetch the TTS models available for a provider (live from the provider).",
  },
  ttsProviderVoices: {
    name: "tts.provider.voices",
    method: "GET",
    path: "/api/tts/providers/:id/voices",
    description: "Fetch the voices for a provider/model (live from the provider).",
  },
  ttsSpeech: {
    name: "tts.speech",
    method: "POST",
    path: "/api/tts/speech",
    description: "Synthesize text into speech (returns base64 audio).",
  },
  promptAgentStream: {
    name: "promptAgent.stream",
    method: "POST",
    path: "/api/prompt-agent/stream",
    description: "Start a prompt-agent turn (create/enhance) and stream SSE.",
  },
  promptAgentAbort: {
    name: "promptAgent.abort",
    method: "POST",
    path: "/api/prompt-agent/abort/:chatId",
    description: "Cancel the running prompt-agent turn for a session.",
  },
  summariesHistory: {
    name: "summaries.history",
    method: "GET",
    path: "/api/summaries/history/:chatId",
    description: "List past automatic context-summarization runs in a session.",
  },
  customSummariesHistory: {
    name: "summaries.customHistory",
    method: "GET",
    path: "/api/summaries/custom-history/:chatId",
    description: "List past custom-agent context-summarization runs in a session.",
  },
  subAgentSummariesHistory: {
    name: "summaries.subAgentHistory",
    method: "GET",
    path: "/api/summaries/sub-agent-history/:chatId",
    description: "List past sub-agent context-summarization runs in a session.",
  },
} as const satisfies Record<string, ApiRoute>;

export type ApiRouteName = keyof typeof API_ROUTES;

/** Fill `:param` segments of a route path and append an optional query string. */
export function routeUrl(
  route: ApiRoute,
  options?: { params?: Record<string, string>; query?: Record<string, string | number | undefined> },
): string {
  let path: string = route.path;
  for (const [key, value] of Object.entries(options?.params ?? {})) {
    path = path.replaceAll(`:${key}`, encodeURIComponent(value));
  }

  const query = options?.query;
  if (query) {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== "") {
        search.set(key, String(value));
      }
    }
    const qs = search.toString();
    if (qs) path += `?${qs}`;
  }
  return path;
}
