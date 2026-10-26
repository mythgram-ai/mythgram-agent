import type Database from "better-sqlite3";

/**
 * Database schema.
 *
 * Design notes for "never gets slower as the database grows":
 * - Every read path is a point lookup or an indexed range scan — there is not a single
 *   full-table scan anywhere in the repositories.
 * - `stream_events` is a WITHOUT ROWID table clustered on (session_id, turn, event_id):
 *   appends land at the end of a session's cluster and replay reads are one contiguous
 *   range scan, regardless of how many other sessions/tokens exist.
 * - Token/reasoning deltas are coalesced by the write queue before insertion, so a
 *   100k tokens/second stream produces a handful of rows per flush, not 100k rows.
 * - Schema version is tracked in `user_version` for forward migrations.
 */

const SCHEMA_VERSION = 1;

const DDL = `
CREATE TABLE IF NOT EXISTS sessions (
  id            TEXT PRIMARY KEY,            -- 20-char alphanumeric chat session id
  title         TEXT NOT NULL DEFAULT '',
  running       INTEGER NOT NULL DEFAULT 0,
  turn_count    INTEGER NOT NULL DEFAULT 0,  -- number of agent turns executed
  last_event_id INTEGER NOT NULL DEFAULT -1, -- last stream event id of the latest turn
  message_count INTEGER NOT NULL DEFAULT 0,  -- maintained by the write queue (no COUNT scans)
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_updated ON sessions (updated_at DESC);

-- Provider-format transcript (OpenAI wire shape), authoritative model context per session.
CREATE TABLE IF NOT EXISTS messages (
  session_id TEXT NOT NULL,
  seq        INTEGER NOT NULL,
  role       TEXT NOT NULL,
  data       TEXT NOT NULL,                  -- full StoredMessage JSON
  created_at INTEGER NOT NULL,
  PRIMARY KEY (session_id, seq)
) WITHOUT ROWID;

-- Full stream event log: every SSE event of the main agent AND all sub-agents
-- (tokens, reasoning, tool calls, tool results, statuses...). Consecutive token /
-- reasoning deltas are coalesced into single rows by the write queue.
CREATE TABLE IF NOT EXISTS stream_events (
  session_id     TEXT NOT NULL,
  turn           INTEGER NOT NULL,
  event_id       INTEGER NOT NULL,           -- LAST event id covered by this row
  first_event_id INTEGER NOT NULL,           -- FIRST event id covered (== event_id unless coalesced)
  event          TEXT NOT NULL,
  data           TEXT NOT NULL,
  created_at     INTEGER NOT NULL,
  PRIMARY KEY (session_id, turn, event_id)
) WITHOUT ROWID;

-- One row per sub-agent invocation; 10-char alphanumeric run/session id.
CREATE TABLE IF NOT EXISTS sub_agent_runs (
  id           TEXT PRIMARY KEY,             -- 10-char sub-agent session id
  session_id   TEXT NOT NULL,
  turn         INTEGER NOT NULL DEFAULT 0,
  tool_call_id TEXT NOT NULL DEFAULT '',
  agent        TEXT NOT NULL DEFAULT '',
  task         TEXT NOT NULL DEFAULT '',
  background   INTEGER NOT NULL DEFAULT 0,
  status       TEXT NOT NULL DEFAULT 'running', -- running | completed | failed | aborted
  output       TEXT NOT NULL DEFAULT '',
  error        TEXT,
  output_file  TEXT,
  started_at   INTEGER NOT NULL,
  finished_at  INTEGER
);

CREATE INDEX IF NOT EXISTS idx_sub_agent_runs_session ON sub_agent_runs (session_id, started_at);

-- Structured record of every tool call + result (main agent and sub-agents).
CREATE TABLE IF NOT EXISTS tool_calls (
  session_id       TEXT NOT NULL,
  tool_call_id     TEXT NOT NULL,
  sub_agent_run_id TEXT,                     -- NULL for main-agent tool calls
  name             TEXT NOT NULL DEFAULT '',
  label            TEXT,
  args             TEXT,
  ok               INTEGER,                  -- NULL until the result arrives
  result           TEXT,
  created_at       INTEGER NOT NULL,
  finished_at      INTEGER,
  PRIMARY KEY (session_id, tool_call_id)
) WITHOUT ROWID;

-- UI-shaped conversation snapshots (what the frontend renders), one JSON doc per session.
CREATE TABLE IF NOT EXISTS session_snapshots (
  session_id TEXT PRIMARY KEY,
  data       TEXT NOT NULL,
  updated_at INTEGER NOT NULL
) WITHOUT ROWID;

-- Application state documents: settings (incl. API keys), custom sub-agent definitions,
-- skill files, memory files, knowledge files, todos, custom providers, UI selections...
CREATE TABLE IF NOT EXISTS app_state (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at INTEGER NOT NULL
) WITHOUT ROWID;

-- One row per background memory-agent run. A run is enqueued every time the main agent
-- finishes a turn; the queue executes runs strictly one at a time, each in a brand-new
-- session (sessions are never reused).
CREATE TABLE IF NOT EXISTS memory_agent_runs (
  id              TEXT PRIMARY KEY,           -- 10-char memory-agent run/session id
  chat_session_id TEXT NOT NULL,              -- chat session whose turn triggered this run
  status          TEXT NOT NULL DEFAULT 'queued', -- queued | running | completed | failed
  provider        TEXT NOT NULL DEFAULT '',
  model           TEXT NOT NULL DEFAULT '',
  summary         TEXT NOT NULL DEFAULT '',   -- the agent's final message
  error           TEXT,
  updated_files   TEXT NOT NULL DEFAULT '[]', -- JSON array of memory paths written/edited/deleted
  last_event_id   INTEGER NOT NULL DEFAULT -1,
  queued_at       INTEGER NOT NULL,
  started_at      INTEGER,
  finished_at     INTEGER
);

CREATE INDEX IF NOT EXISTS idx_memory_agent_runs_queued ON memory_agent_runs (queued_at DESC);

-- Full stream event log of every memory-agent run (tokens, reasoning, tool calls,
-- tool results, memory updates...). Consecutive token/reasoning deltas are coalesced
-- into single rows by the memory-agent event persister.
CREATE TABLE IF NOT EXISTS memory_agent_events (
  run_id         TEXT NOT NULL,
  event_id       INTEGER NOT NULL,            -- LAST event id covered by this row
  first_event_id INTEGER NOT NULL,            -- FIRST event id covered (== event_id unless coalesced)
  event          TEXT NOT NULL,
  data           TEXT NOT NULL,
  created_at     INTEGER NOT NULL,
  PRIMARY KEY (run_id, event_id)
) WITHOUT ROWID;

-- Scheduled / cron tasks. Owned and executed entirely by the backend scheduler
-- (src/cron/): the frontend only manages them through the schedules API, so they
-- keep running with no browser open. One row per schedule; execution attempts
-- live in schedule_runs.
CREATE TABLE IF NOT EXISTS schedules (
  id              TEXT PRIMARY KEY,            -- 16-char alphanumeric schedule id
  name            TEXT NOT NULL DEFAULT '',
  prompt          TEXT NOT NULL DEFAULT '',    -- task prompt executed by the agent
  agent_type      TEXT NOT NULL DEFAULT 'default', -- 'default' | 'custom'
  custom_agent_id TEXT,                         -- Custom Agent id when agent_type = 'custom'
  provider        TEXT NOT NULL DEFAULT '',
  model           TEXT NOT NULL DEFAULT '',
  kind            TEXT NOT NULL DEFAULT 'once', -- once | interval | daily | weekly | monthly | cron
  cron            TEXT NOT NULL DEFAULT '',    -- custom 5-field cron expression (kind = 'cron')
  interval_minutes INTEGER,                    -- every-X cadence (kind = interval)
  time            TEXT,                        -- HH:MM wall time in timezone (daily/weekly/monthly)
  weekdays        TEXT NOT NULL DEFAULT '[]',  -- JSON array of 0-6 (Sun-Sat, kind = 'weekly')
  day_of_month    INTEGER,                     -- 1-31 (kind = 'monthly')
  run_at          INTEGER,                     -- one-time UTC epoch ms (kind = 'once')
  start_at        INTEGER,                     -- optional window start (UTC epoch ms)
  end_at          INTEGER,                     -- optional window end (UTC epoch ms)
  timezone        TEXT NOT NULL DEFAULT 'UTC', -- IANA timezone for wall-time math
  enabled         INTEGER NOT NULL DEFAULT 1,
  running         INTEGER NOT NULL DEFAULT 0,  -- 1 while an execution is in flight
  last_run_at     INTEGER,
  next_run_at     INTEGER,
  last_status     TEXT,                        -- completed | failed (of the latest finished run)
  last_error      TEXT,
  run_count       INTEGER NOT NULL DEFAULT 0,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_schedules_next ON schedules (enabled, next_run_at);

-- One row per schedule execution (automatic or manual). Stores the outcome the
-- Schedule page renders as execution history/logs.
CREATE TABLE IF NOT EXISTS schedule_runs (
  id          TEXT PRIMARY KEY,                -- 12-char alphanumeric run id
  schedule_id TEXT NOT NULL,
  trigger     TEXT NOT NULL DEFAULT 'auto',    -- auto | manual
  status      TEXT NOT NULL DEFAULT 'running', -- running | completed | failed
  output      TEXT NOT NULL DEFAULT '',        -- final agent answer (capped)
  error       TEXT,
  started_at  INTEGER NOT NULL,
  finished_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_schedule_runs_schedule ON schedule_runs (schedule_id, started_at DESC);

-- Messaging-channel chats. One row per external user per channel connection: the
-- persistent agent conversation behind a Telegram / Discord / Slack DM or mention
-- thread. The provider-format transcript lives in channel_messages.
CREATE TABLE IF NOT EXISTS channel_chats (
  id          TEXT PRIMARY KEY,                -- 20-char alphanumeric chat id
  channel_id  TEXT NOT NULL,                   -- channel connection id
  user_key    TEXT NOT NULL,                   -- stable external user key (tg:<id>, dc:<id>, sl:<team>:<user>)
  user_label  TEXT NOT NULL DEFAULT '',        -- human-readable user label
  agent_id    TEXT,                            -- Custom Agent id, or NULL for the built-in Default Agent
  title       TEXT NOT NULL DEFAULT '',
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_channel_chats_channel ON channel_chats (channel_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_channel_chats_user ON channel_chats (channel_id, user_key);

-- Provider-format transcript (OpenAI wire shape) per channel chat, mirroring messages.
CREATE TABLE IF NOT EXISTS channel_messages (
  chat_id    TEXT NOT NULL,
  seq        INTEGER NOT NULL,
  role       TEXT NOT NULL,
  data       TEXT NOT NULL,                  -- full StoredMessage JSON
  created_at INTEGER NOT NULL,
  PRIMARY KEY (chat_id, seq)
) WITHOUT ROWID;
`;

/** Create all tables/indexes (idempotent) and stamp the schema version. */
export function applySchema(db: Database.Database): void {
  const current = Number(db.pragma("user_version", { simple: true }));
  db.exec(DDL);

  // Additive migrations for databases created by earlier schema revisions.
  ensureColumn(db, "sessions", "message_count", "INTEGER NOT NULL DEFAULT 0");

  if (current < SCHEMA_VERSION) {
    db.pragma(`user_version = ${SCHEMA_VERSION}`);
  }
}

/** Add a column to an existing table when it is missing (idempotent, additive-only). */
function ensureColumn(
  db: Database.Database,
  table: string,
  column: string,
  definition: string,
): void {
  const columns = db.pragma(`table_info(${table})`) as Array<{ name: string }>;
  if (!columns.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}
