import type Database from "better-sqlite3";

/**
 * Persistence for ACP client connections and their application-owned sessions.
 *
 * A connection is an external ACP-compatible agent process (Claude Agent, Codex,
 * Gemini CLI, ...). Its `id` is our 20-digit numeric id. A session's `id` is also
 * ours; the connected agent's own `sessionId` is kept private in
 * `agent_session_id` only so the backend can route requests. The browser never
 * sees that value.
 *
 * Session events are an append-only, ordered event log (user prompts + ACP
 * `session/update` notifications) so the chat can be replayed after a reload.
 * Writes replace the whole log for one session inside a transaction, keeping
 * crash/restart behavior simple and deterministic.
 */

export interface AcpClientRow {
  id: string;
  name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  cwd: string;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface AcpSessionRow {
  id: string;
  clientId: string;
  /** Private: the connected agent's own session id (never sent to the browser). */
  agentSessionId: string;
  title: string;
  status: string;
  meta: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

export interface AcpStoredEvent {
  seq: number;
  event: string;
  data: unknown;
  createdAt: number;
}

interface RawClientRow {
  id: string;
  name: string;
  command: string;
  args: string;
  env: string;
  cwd: string;
  enabled: number;
  created_at: number;
  updated_at: number;
}

interface RawSessionRow {
  id: string;
  client_id: string;
  agent_session_id: string;
  title: string;
  status: string;
  meta: string;
  created_at: number;
  updated_at: number;
}

interface RawEventRow {
  seq: number;
  event: string;
  data: string;
  created_at: number;
}

/** Keep the per-session event log bounded; the UI only needs recent history. */
const MAX_EVENTS_PER_SESSION = 4000;

function parseJson(value: string, fallback: unknown): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return fallback;
  }
}

function parseArgs(value: string): string[] {
  const parsed = parseJson(value, []);
  return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
}

function parseEnv(value: string): Record<string, string> {
  const parsed = parseJson(value, {});
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  const out: Record<string, string> = {};
  for (const [key, val] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof val === "string") out[key] = val;
  }
  return out;
}

function parseMeta(value: string): Record<string, unknown> {
  const parsed = parseJson(value, {});
  return parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : {};
}

function toClient(row: RawClientRow): AcpClientRow {
  return {
    id: row.id,
    name: row.name,
    command: row.command,
    args: parseArgs(row.args),
    env: parseEnv(row.env),
    cwd: row.cwd,
    enabled: row.enabled === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toSession(row: RawSessionRow): AcpSessionRow {
  return {
    id: row.id,
    clientId: row.client_id,
    agentSessionId: row.agent_session_id,
    title: row.title,
    status: row.status,
    meta: parseMeta(row.meta),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class AcpClientRepo {
  private readonly selectClients: Database.Statement;
  private readonly selectClient: Database.Statement;
  private readonly upsertClient: Database.Statement;
  private readonly deleteClientRow: Database.Statement;

  private readonly selectSessions: Database.Statement;
  private readonly selectSession: Database.Statement;
  private readonly upsertSession: Database.Statement;
  private readonly deleteSessionRow: Database.Statement;
  private readonly deleteEventsForSession: Database.Statement;
  private readonly deleteSessionsForClient: Database.Statement;
  private readonly deleteEventsForClient: Database.Statement;

  private readonly selectEvents: Database.Statement;
  private readonly insertEvent: Database.Statement;

  constructor(private readonly db: Database.Database) {
    this.selectClients = db.prepare(`SELECT * FROM acp_clients ORDER BY created_at ASC`);
    this.selectClient = db.prepare(`SELECT * FROM acp_clients WHERE id = ?`);
    this.upsertClient = db.prepare(
      `INSERT INTO acp_clients (id, name, command, args, env, cwd, enabled, created_at, updated_at)
       VALUES (@id, @name, @command, @args, @env, @cwd, @enabled, @createdAt, @updatedAt)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name, command = excluded.command, args = excluded.args,
         env = excluded.env, cwd = excluded.cwd, enabled = excluded.enabled,
         updated_at = excluded.updated_at`,
    );
    this.deleteClientRow = db.prepare(`DELETE FROM acp_clients WHERE id = ?`);

    this.selectSessions = db.prepare(
      `SELECT * FROM acp_client_sessions WHERE client_id = ? ORDER BY updated_at DESC`,
    );
    this.selectSession = db.prepare(`SELECT * FROM acp_client_sessions WHERE id = ?`);
    this.upsertSession = db.prepare(
      `INSERT INTO acp_client_sessions (id, client_id, agent_session_id, title, status, meta, created_at, updated_at)
       VALUES (@id, @clientId, @agentSessionId, @title, @status, @meta, @createdAt, @updatedAt)
       ON CONFLICT(id) DO UPDATE SET
         agent_session_id = excluded.agent_session_id, title = excluded.title,
         status = excluded.status, meta = excluded.meta, updated_at = excluded.updated_at`,
    );
    this.deleteSessionRow = db.prepare(`DELETE FROM acp_client_sessions WHERE id = ?`);
    this.deleteEventsForSession = db.prepare(`DELETE FROM acp_client_events WHERE session_id = ?`);
    this.deleteSessionsForClient = db.prepare(`DELETE FROM acp_client_sessions WHERE client_id = ?`);
    this.deleteEventsForClient = db.prepare(
      `DELETE FROM acp_client_events WHERE session_id IN (SELECT id FROM acp_client_sessions WHERE client_id = ?)`,
    );

    this.selectEvents = db.prepare(
      `SELECT seq, event, data, created_at FROM acp_client_events WHERE session_id = ? ORDER BY seq ASC`,
    );
    this.insertEvent = db.prepare(
      `INSERT INTO acp_client_events (session_id, seq, event, data, created_at) VALUES (?, ?, ?, ?, ?)`,
    );
  }

  listClients(): AcpClientRow[] {
    return (this.selectClients.all() as RawClientRow[]).map(toClient);
  }

  getClient(id: string): AcpClientRow | undefined {
    const row = this.selectClient.get(id) as RawClientRow | undefined;
    return row ? toClient(row) : undefined;
  }

  saveClient(row: AcpClientRow): void {
    this.upsertClient.run({
      id: row.id,
      name: row.name,
      command: row.command,
      args: JSON.stringify(row.args),
      env: JSON.stringify(row.env),
      cwd: row.cwd,
      enabled: row.enabled ? 1 : 0,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    });
  }

  /** Delete a connection plus every session and event it owns (one transaction). */
  deleteClient(id: string): void {
    const tx = this.db.transaction(() => {
      this.deleteEventsForClient.run(id);
      this.deleteSessionsForClient.run(id);
      this.deleteClientRow.run(id);
    });
    tx();
  }

  listSessions(clientId: string): AcpSessionRow[] {
    return (this.selectSessions.all(clientId) as RawSessionRow[]).map(toSession);
  }

  getSession(id: string): AcpSessionRow | undefined {
    const row = this.selectSession.get(id) as RawSessionRow | undefined;
    return row ? toSession(row) : undefined;
  }

  saveSession(row: AcpSessionRow): void {
    this.upsertSession.run({
      id: row.id,
      clientId: row.clientId,
      agentSessionId: row.agentSessionId,
      title: row.title,
      status: row.status,
      meta: JSON.stringify(row.meta ?? {}),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    });
  }

  deleteSession(id: string): void {
    const tx = this.db.transaction(() => {
      this.deleteEventsForSession.run(id);
      this.deleteSessionRow.run(id);
    });
    tx();
  }

  listEvents(sessionId: string): AcpStoredEvent[] {
    const rows = this.selectEvents.all(sessionId) as RawEventRow[];
    const out: AcpStoredEvent[] = [];
    for (const row of rows) {
      out.push({
        seq: row.seq,
        event: row.event,
        data: parseJson(row.data, null),
        createdAt: row.created_at,
      });
    }
    return out;
  }

  /** Replace one session's event log, keeping the most recent bounded window. */
  replaceEvents(
    sessionId: string,
    events: Array<{ event: string; data: unknown; createdAt?: number }>,
  ): void {
    const bounded = events.slice(-MAX_EVENTS_PER_SESSION);
    const now = Date.now();
    const tx = this.db.transaction(() => {
      this.deleteEventsForSession.run(sessionId);
      for (let seq = 0; seq < bounded.length; seq += 1) {
        const entry = bounded[seq]!;
        let json: string;
        try {
          json = JSON.stringify(entry.data ?? null);
        } catch {
          json = "null";
        }
        this.insertEvent.run(sessionId, seq, entry.event, json, entry.createdAt ?? now);
      }
    });
    tx();
  }
}