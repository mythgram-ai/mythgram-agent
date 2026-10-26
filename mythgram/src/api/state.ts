import { Router, type Request, type Response } from "express";
import {
  type MythgramDatabase,
  isAppStateKey,
  isSafeSessionId,
  createChatSessionId,
} from "../database/index.js";
import type { AppConfig } from "../config.js";
import type { SessionStore, StoredMessage } from "../services/sessionStore.js";
import { buildSystemPrompt } from "../agents/systemprompt.js";
import { buildChatSystemPrompt } from "../agents/chat.js";
import { subAgentSessionStore } from "../agents/subAgentSessionStore.js";
import type { MainAgentPromptManager } from "../agents/mainagentprompt/index.js";
import type { CustomAgentManager } from "../agents/customagent/index.js";
import type { MultiAgentRunner } from "../agents/multiagent/index.js";
import type { CeoAgentRunner } from "../agents/multiagent/ceo/index.js";

/**
 * State + session APIs backing the frontend's persistence. The browser keeps NOTHING
 * in localStorage anymore — on boot it hydrates from `GET /api/state`, and every
 * settings/skills/memory/knowledge/sub-agent/todo change is written back here into
 * the SQLite database. Conversation snapshots (the UI-shaped chat history) live in
 * `PUT/GET /api/sessions/:id`.
 */

export function buildStateRouter(db: MythgramDatabase): Router {
  const router = Router();

  /** Everything the frontend needs to boot, in one round trip. */
  router.get("/", (_req: Request, res: Response) => {
    res.json({
      ok: true,
      sqlite_version: db.version,
      state: db.appState.getAll(),
      // One indexed read — messageCount is maintained by the write queue, so boot
      // cost stays flat no matter how large the message/event tables grow.
      sessions: db.sessions.list().map((s) => ({
        id: s.id,
        title: s.title,
        running: s.running,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
        messageCount: s.messageCount,
      })),
    });
  });

  /** Persist one application-state document (settings, skills, memory, ...). */
  const putState = (req: Request, res: Response): void => {
    const key = String(req.params.key);
    if (!isAppStateKey(key)) {
      res.status(400).json({ error: `Unknown state key "${key}".` });
      return;
    }
    const body = (req.body ?? {}) as { value?: unknown };
    db.appState.set(key, body.value ?? null);
    res.json({ ok: true });
  };
  router.put("/:key", putState);
  // POST alias so navigator.sendBeacon (POST-only) can flush state on page close.
  router.post("/:key", putState);

  return router;
}

export function buildSessionsRouter(
  db: MythgramDatabase,
  deps?: {
    store?: SessionStore;
    config?: AppConfig;
    mainAgentPrompts?: MainAgentPromptManager;
    customAgents?: CustomAgentManager;
    multiAgent?: MultiAgentRunner;
    ceoAgent?: CeoAgentRunner;
  },
): Router {
  const router = Router();

  /** Create a new session with a server-generated 20-character id. */
  router.post("/", (req: Request, res: Response) => {
    const body = (req.body ?? {}) as { title?: unknown };
    const title = typeof body.title === "string" ? body.title.slice(0, 200) : "";
    const session = db.sessions.create(title);
    res.json({ ok: true, id: session.id, session });
  });

  router.get("/", (_req: Request, res: Response) => {
    res.json({ ok: true, sessions: db.sessions.list() });
  });

  /**
   * Raw context for one session + agent scope: the resolved system prompt plus the
   * provider-format transcript (untruncated) that the agent's next request is built
   * from. Served unformatted so the UI can display it raw.
   *
   * Query: `?agent=main|custom|chat|sub_agent|team|ceo` (default `main`).
   *   - main/custom/chat: the shared chat transcript (live in-memory preferred,
   *     else persisted SQLite) + the scope's system prompt.
   *   - sub_agent: requires `sub_session_id` — the runned sub-agent session's
   *     preserved transcript + system prompt (404 when unknown).
   *   - team: requires `team_agent` (leader/member name) — that agent's persistent
   *     team context (404 when the chat has no team session for it).
   *   - ceo: requires `ceo_agent` (CEO/leader/member name) — that agent's persistent
   *     CEO-system context (404 when unknown).
   *
   * Only runned agents have stored contexts — a sub/team/CEO agent that never ran
   * returns 404 so the UI hides it (per the context-popup requirement).
   * Never throws for transcript reads.
   */
  router.get("/:id/context", (req: Request, res: Response) => {
    const id = String(req.params.id);
    if (!isSafeSessionId(id)) {
      res.status(400).json({ error: "Invalid session id." });
      return;
    }
    const rawAgent = Array.isArray(req.query.agent) ? req.query.agent[0] : req.query.agent;
    const agent = typeof rawAgent === "string" && rawAgent.trim().length > 0 ? rawAgent.trim().toLowerCase() : "main";
    const SUPPORTED = new Set(["main", "custom", "chat", "sub_agent", "team", "ceo"]);
    if (!SUPPORTED.has(agent)) {
      res.status(400).json({ error: `Unknown agent scope "${agent}". Expected one of: main, custom, chat, sub_agent, team, ceo.` });
      return;
    }

    // ---- Sub-agent raw context (runned sessions only) ----
    if (agent === "sub_agent") {
      const rawSub = Array.isArray(req.query.sub_session_id) ? req.query.sub_session_id[0] : req.query.sub_session_id;
      const subSessionId = typeof rawSub === "string" ? rawSub.trim() : "";
      if (!subSessionId) {
        res.status(400).json({ error: "A sub_session_id query parameter is required for agent=sub_agent." });
        return;
      }
      const record = subAgentSessionStore.get(id, subSessionId);
      if (!record) {
        res.status(404).json({ error: "Sub-agent session not found (it may never have run in this chat)." });
        return;
      }
      res.json({
        ok: true,
        agent: "sub_agent",
        sessionId: id,
        subSessionId: record.sessionId,
        subAgent: record.agent,
        systemPrompt: record.systemPrompt,
        systemPromptSource: "builtin",
        messages: record.messages.map((m) => ({ ...m })),
        source: "live",
        messageCount: record.messages.length,
        usage: latestScopedContextUsage(db, id, "sub_agent", record.sessionId),
        fetchedAt: Date.now(),
      });
      return;
    }

    // ---- Team agent raw context (runned team agents only) ----
    if (agent === "team") {
      const rawTeam = Array.isArray(req.query.team_agent) ? req.query.team_agent[0] : req.query.team_agent;
      const teamAgent = typeof rawTeam === "string" ? rawTeam.trim() : "";
      if (!teamAgent) {
        res.status(400).json({ error: "A team_agent query parameter is required for agent=team." });
        return;
      }
      const ctx = deps?.multiAgent?.agentContext(id, teamAgent) ?? null;
      if (!ctx) {
        res.status(404).json({ error: "Team agent context not found (it may never have run in this chat)." });
        return;
      }
      res.json({
        ok: true,
        agent: "team",
        sessionId: id,
        teamAgent,
        systemPrompt: ctx.systemPrompt,
        systemPromptSource: "builtin",
        messages: ctx.messages,
        source: "live",
        messageCount: ctx.messages.length,
        usage: latestScopedContextUsage(db, id, "team", teamAgent),
        fetchedAt: Date.now(),
      });
      return;
    }

    // ---- CEO-system agent raw context (runned CEO/leaders/members only) ----
    if (agent === "ceo") {
      const rawCeo = Array.isArray(req.query.ceo_agent) ? req.query.ceo_agent[0] : req.query.ceo_agent;
      const ceoAgent = typeof rawCeo === "string" ? rawCeo.trim() : "";
      if (!ceoAgent) {
        res.status(400).json({ error: "A ceo_agent query parameter is required for agent=ceo." });
        return;
      }
      const ctx = deps?.ceoAgent?.agentContext(id, ceoAgent) ?? null;
      if (!ctx) {
        res.status(404).json({ error: "CEO agent context not found (it may never have run in this chat)." });
        return;
      }
      res.json({
        ok: true,
        agent: "ceo",
        sessionId: id,
        ceoAgent,
        role: ctx.role,
        systemPrompt: ctx.systemPrompt,
        systemPromptSource: "builtin",
        messages: ctx.messages,
        source: "live",
        messageCount: ctx.messages.length,
        usage: latestScopedContextUsage(db, id, "ceo", ceoAgent),
        fetchedAt: Date.now(),
      });
      return;
    }

    const liveMessages = (() => {
      try {
        const live = deps?.store?.get(id)?.messages;
        return Array.isArray(live) ? live : [];
      } catch {
        return [];
      }
    })();
    const persistedExists = (() => {
      try {
        return Boolean(db.sessions.get(id));
      } catch {
        return false;
      }
    })();
    if (!persistedExists && liveMessages.length === 0) {
      res.status(404).json({ error: "Session not found." });
      return;
    }

    let messages: StoredMessage[];
    let source: "live" | "persisted" | "empty";
    if (liveMessages.length > 0) {
      messages = liveMessages.map((m) => ({ ...m }));
      source = "live";
    } else {
      let persisted: StoredMessage[] = [];
      try {
        persisted = db.messages.list(id);
      } catch {
        persisted = [];
      }
      messages = persisted;
      source = persisted.length > 0 ? "persisted" : "empty";
    }

    // ---- Custom agent raw context (same transcript, custom system prompt) ----
    if (agent === "custom") {
      const rawCustomId = Array.isArray(req.query.custom_agent_id) ? req.query.custom_agent_id[0] : req.query.custom_agent_id;
      const customId = typeof rawCustomId === "string" ? rawCustomId.trim() : "";
      let systemPrompt: string | null = null;
      let systemPromptSource: "custom" | "builtin" = "builtin";
      try {
        const custom = customId ? deps?.customAgents?.get(customId) ?? null : null;
        if (custom && custom.systemPrompt.trim().length > 0) {
          systemPrompt = custom.systemPrompt;
          systemPromptSource = "custom";
        } else {
          // Fall back to the first stored custom agent with a prompt, else builtin.
          const first = deps?.customAgents?.list().find((c) => c.systemPrompt.trim().length > 0) ?? null;
          if (first) {
            systemPrompt = first.systemPrompt;
            systemPromptSource = "custom";
          } else {
            systemPrompt = buildSystemPrompt(deps?.config?.workspaceRoot ?? "", {});
          }
        }
      } catch {
        systemPrompt = null;
      }
      res.json({
        ok: true,
        agent: "custom",
        sessionId: id,
        systemPrompt,
        systemPromptSource,
        messages,
        source,
        messageCount: messages.length,
        usage: latestScopedContextUsage(db, id, "custom"),
        fetchedAt: Date.now(),
      });
      return;
    }

    // ---- Chat-mode raw context (same transcript, chat system prompt) ----
    if (agent === "chat") {
      let systemPrompt: string | null = null;
      try {
        systemPrompt = buildChatSystemPrompt();
      } catch {
        systemPrompt = null;
      }
      res.json({
        ok: true,
        agent: "chat",
        sessionId: id,
        systemPrompt,
        systemPromptSource: "builtin",
        messages,
        source,
        messageCount: messages.length,
        usage: latestScopedContextUsage(db, id, "chat"),
        fetchedAt: Date.now(),
      });
      return;
    }

    let systemPrompt: string | null = null;
    let systemPromptSource: "custom" | "builtin" = "builtin";
    try {
      const active = deps?.mainAgentPrompts?.getActivePromptText() ?? null;
      if (typeof active === "string" && active.trim().length > 0) {
        systemPrompt = active;
        systemPromptSource = "custom";
      } else {
        systemPrompt = buildSystemPrompt(deps?.config?.workspaceRoot ?? "", {});
      }
    } catch {
      systemPrompt = null;
    }

    res.json({
      ok: true,
      agent: "main",
      sessionId: id,
      systemPrompt,
      systemPromptSource,
      messages,
      source,
      messageCount: messages.length,
      usage: latestMainContextUsage(db, id),
      fetchedAt: Date.now(),
    });
  });

  /** Full session detail: metadata, UI snapshot, and the provider-format transcript. */
  router.get("/:id", (req: Request, res: Response) => {
    const id = String(req.params.id);
    if (!isSafeSessionId(id)) {
      res.status(400).json({ error: "Invalid session id." });
      return;
    }
    const session = db.sessions.get(id);
    if (!session) {
      res.status(404).json({ error: "Session not found." });
      return;
    }
    res.json({
      ok: true,
      session,
      snapshot: db.snapshots.get(id),
      transcript: db.messages.list(id),
      subAgentRuns: db.subAgentRuns.listBySession(id),
      // Latest main-agent context usage from the persisted stream-event log, so the
      // context meter survives refresh/reopen without a live stream. Null when the
      // session never logged main-agent usage (silent provider, old history, or a
      // thread that only ran other agents). Additive field — existing clients ignore it.
      contextUsage: latestMainContextUsage(db, id),
      // All agent scopes' latest usages (main/custom/chat + per sub-agent/team/CEO
      // agent), so the context popup can show every runned agent after a reload
      // without replaying the event log. Additive — old clients ignore it.
      contextUsages: latestAllContextUsages(db, id),
    });
  });

  /** Upsert a session: title rename and/or the UI conversation snapshot. */
  const putSession = (req: Request, res: Response): void => {
    const id = String(req.params.id);
    if (!isSafeSessionId(id)) {
      res.status(400).json({ error: "Invalid session id." });
      return;
    }
    const body = (req.body ?? {}) as { title?: unknown; snapshot?: unknown };
    db.sessions.ensure(id);
    if (typeof body.title === "string") {
      db.sessions.rename(id, body.title.slice(0, 200));
    }
    if (body.snapshot !== undefined) {
      db.snapshots.set(id, body.snapshot);
    }
    res.json({ ok: true });
  };
  router.put("/:id", putSession);
  // POST alias so navigator.sendBeacon (POST-only) can flush snapshots on page close.
  router.post("/:id", putSession);

  router.delete("/:id", (req: Request, res: Response) => {
    const id = String(req.params.id);
    if (!isSafeSessionId(id)) {
      res.status(400).json({ error: "Invalid session id." });
      return;
    }
    db.sessions.delete(id);
    res.json({ ok: true });
  });

  /**
   * Fork a session: full 100% copy of the source session's stored chat data
   * (transcript, events, tool calls, UI snapshot) into a new session.
   * Body: { title?: string, new_id?: string }. When new_id is a valid unused
   * session id it is used verbatim so the frontend and backend stay in sync;
   * otherwise a server-generated 20-char id is used. Global settings/memory/
   * skills/teams are shared by design, so the fork automatically inherits them.
   */
  router.post("/:id/fork", (req: Request, res: Response) => {
    const id = String(req.params.id);
    if (!isSafeSessionId(id)) {
      res.status(400).json({ error: "Invalid session id." });
      return;
    }
    const body = (req.body ?? {}) as { title?: unknown; new_id?: unknown; newId?: unknown };
    const title = typeof body.title === "string" ? body.title.slice(0, 200) : undefined;
    const rawNewId = typeof body.new_id === "string" ? body.new_id : typeof body.newId === "string" ? body.newId : undefined;
    const forked = db.forkSession(id, { title, newId: rawNewId });
    if (!forked) {
      res.status(404).json({ error: "Session not found." });
      return;
    }
    res.json({ ok: true, id: forked.id, session: forked });
  });

  return router;
}

/** Re-exported so callers can mint ids without touching the database module directly. */
export { createChatSessionId };

/**
 * Newest main-agent `context_usage` log entry for a session, sanitized for the meter.
 * Picks the newest logged row tagged `agent: "main"` (other scopes are served via
 * latestAllContextUsages — never as main-agent usage). Returns null when there is
 * nothing usable, so the UI shows "unavailable" rather than a fabricated number.
 * Never throws: persistence reads must not break session loading.
 */
function latestMainContextUsage(
  db: MythgramDatabase,
  sessionId: string,
): Record<string, unknown> | null {
  return latestScopedContextUsage(db, sessionId, "main");
}

/**
 * Newest `context_usage` entry for one scope (+ optional agent identity).
 * Scopes: main | custom | chat | sub_agent (needs subSessionId) |
 * team (needs agent id) | ceo (needs agent id). Returns a sanitized payload
 * with the scope tag + identity echoed back, or null when nothing usable.
 * Never throws.
 */
function latestScopedContextUsage(
  db: MythgramDatabase,
  sessionId: string,
  scope: string,
  identity?: string,
): Record<string, unknown> | null {
  try {
    const rows = db.events.latestContextUsage(sessionId, 100);
    const want = scope.trim().toLowerCase();
    const wantId = (identity ?? "").trim().toLowerCase();
    for (const row of rows) {
      const data = row.data ?? {};
      const rowScope = typeof data.agent === "string" ? data.agent.trim().toLowerCase() : "";
      if (rowScope !== want) continue;
      // Identity match for per-agent scopes (sub_session_id / agent_id).
      if (want === "sub_agent" && wantId) {
        const rowSub = typeof data.sub_session_id === "string" ? data.sub_session_id.trim().toLowerCase() : "";
        if (rowSub !== wantId) continue;
      }
      if ((want === "team" || want === "ceo") && wantId) {
        const rowAgent = typeof data.agent_id === "string" ? data.agent_id.trim().toLowerCase() : "";
        if (rowAgent !== wantId) continue;
      }
      const prompt_tokens = cleanCount(data.prompt_tokens);
      if (prompt_tokens === undefined) continue;
      const out: Record<string, unknown> = { agent: want, prompt_tokens };
      const completion_tokens = cleanCount(data.completion_tokens);
      if (completion_tokens !== undefined) out.completion_tokens = completion_tokens;
      const total_tokens = cleanCount(data.total_tokens);
      if (total_tokens !== undefined) out.total_tokens = total_tokens;
      if (typeof data.provider === "string" && data.provider.trim().length > 0) {
        out.provider = data.provider.trim().slice(0, 120);
      }
      if (typeof data.model === "string" && data.model.trim().length > 0) {
        out.model = data.model.trim().slice(0, 200);
      }
      const iteration = cleanCount(data.iteration);
      if (iteration !== undefined) out.iteration = iteration;
      // Echo identity so the UI can key per-agent entries without re-reading the log.
      if (want === "sub_agent") {
        const subId = typeof data.sub_session_id === "string" ? data.sub_session_id : "";
        if (subId) out.sub_session_id = subId;
        if (typeof data.sub_agent === "string" && data.sub_agent) out.sub_agent = data.sub_agent;
      }
      if (want === "team" || want === "ceo") {
        if (typeof data.agent_id === "string" && data.agent_id) out.agent_id = data.agent_id;
        if (typeof data.role === "string" && data.role) out.role = data.role;
      }
      return out;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * All scopes' latest usages for a session, grouped for the context popup:
 * `{ main, custom, chat, sub_agents: {subSessionId: usage}, team: {agentId: usage},
 * ceo: {agentId: usage} }`. Only scopes with usable data appear (runned agents
 * only — never-run agents are absent so the UI hides them). Never throws.
 */
function latestAllContextUsages(
  db: MythgramDatabase,
  sessionId: string,
): {
  main: Record<string, unknown> | null;
  custom: Record<string, unknown> | null;
  chat: Record<string, unknown> | null;
  sub_agents: Record<string, Record<string, unknown>>;
  team: Record<string, Record<string, unknown>>;
  ceo: Record<string, Record<string, unknown>>;
} {
  const empty = {
    main: null as Record<string, unknown> | null,
    custom: null as Record<string, unknown> | null,
    chat: null as Record<string, unknown> | null,
    sub_agents: {} as Record<string, Record<string, unknown>>,
    team: {} as Record<string, Record<string, unknown>>,
    ceo: {} as Record<string, Record<string, unknown>>,
  };
  try {
    const rows = db.events.latestContextUsage(sessionId, 100);
    const seenSub = new Set<string>();
    const seenTeam = new Set<string>();
    const seenCeo = new Set<string>();
    // Rows are newest-first: first usable row per scope/identity wins.
    for (const row of rows) {
      const data = row.data ?? {};
      const scope = typeof data.agent === "string" ? data.agent.trim().toLowerCase() : "";
      const prompt_tokens = cleanCount(data.prompt_tokens);
      if (prompt_tokens === undefined) continue;
      const base: Record<string, unknown> = { agent: scope, prompt_tokens };
      const completion_tokens = cleanCount(data.completion_tokens);
      if (completion_tokens !== undefined) base.completion_tokens = completion_tokens;
      const total_tokens = cleanCount(data.total_tokens);
      if (total_tokens !== undefined) base.total_tokens = total_tokens;
      if (typeof data.provider === "string" && data.provider.trim().length > 0) {
        base.provider = data.provider.trim().slice(0, 120);
      }
      if (typeof data.model === "string" && data.model.trim().length > 0) {
        base.model = data.model.trim().slice(0, 200);
      }
      const iteration = cleanCount(data.iteration);
      if (iteration !== undefined) base.iteration = iteration;

      if (scope === "main" && !empty.main) {
        empty.main = base;
      } else if (scope === "custom" && !empty.custom) {
        empty.custom = base;
      } else if (scope === "chat" && !empty.chat) {
        empty.chat = base;
      } else if (scope === "sub_agent") {
        const subId = typeof data.sub_session_id === "string" ? data.sub_session_id.trim() : "";
        if (subId && !seenSub.has(subId.toLowerCase())) {
          seenSub.add(subId.toLowerCase());
          empty.sub_agents[subId] = {
            ...base,
            sub_session_id: subId,
            ...(typeof data.sub_agent === "string" && data.sub_agent ? { sub_agent: data.sub_agent } : {}),
          };
        }
      } else if (scope === "team") {
        const agentId = typeof data.agent_id === "string" ? data.agent_id.trim() : "";
        if (agentId && !seenTeam.has(agentId.toLowerCase())) {
          seenTeam.add(agentId.toLowerCase());
          empty.team[agentId] = {
            ...base,
            agent_id: agentId,
            ...(typeof data.role === "string" && data.role ? { role: data.role } : {}),
          };
        }
      } else if (scope === "ceo") {
        const agentId = typeof data.agent_id === "string" ? data.agent_id.trim() : "";
        if (agentId && !seenCeo.has(agentId.toLowerCase())) {
          seenCeo.add(agentId.toLowerCase());
          empty.ceo[agentId] = {
            ...base,
            agent_id: agentId,
            ...(typeof data.role === "string" && data.role ? { role: data.role } : {}),
          };
        }
      }
    }
    return empty;
  } catch {
    return empty;
  }
}

/** A finite, non-negative token count (zero is legitimate; NaN/negative is not). */
function cleanCount(value: unknown): number | undefined {
  const n =
    typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : undefined;
}
