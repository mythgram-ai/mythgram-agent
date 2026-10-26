import type Database from "better-sqlite3";

export interface SubAgentRunRow {
  id: string;
  sessionId: string;
  turn: number;
  toolCallId: string;
  agent: string;
  task: string;
  background: boolean;
  status: "running" | "completed" | "failed" | "aborted";
  output: string;
  error: string | null;
  outputFile: string | null;
  startedAt: number;
  finishedAt: number | null;
}

/**
 * Read side for sub-agent run records (10-char session ids). Rows are written by the
 * write queue as `sub_agent_start` / `sub_agent_done` events flow through it.
 */
export class SubAgentRunsRepo {
  private readonly selectBySession: Database.Statement;
  private readonly selectOne: Database.Statement;

  constructor(db: Database.Database) {
    this.selectBySession = db.prepare(
      `SELECT * FROM sub_agent_runs WHERE session_id = ? ORDER BY started_at ASC`,
    );
    this.selectOne = db.prepare(`SELECT * FROM sub_agent_runs WHERE id = ?`);
  }

  listBySession(sessionId: string): SubAgentRunRow[] {
    return (this.selectBySession.all(sessionId) as RawRow[]).map(toRow);
  }

  get(id: string): SubAgentRunRow | undefined {
    const row = this.selectOne.get(id) as RawRow | undefined;
    return row ? toRow(row) : undefined;
  }
}

interface RawRow {
  id: string;
  session_id: string;
  turn: number;
  tool_call_id: string;
  agent: string;
  task: string;
  background: number;
  status: string;
  output: string;
  error: string | null;
  output_file: string | null;
  started_at: number;
  finished_at: number | null;
}

function toRow(row: RawRow): SubAgentRunRow {
  return {
    id: row.id,
    sessionId: row.session_id,
    turn: row.turn,
    toolCallId: row.tool_call_id,
    agent: row.agent,
    task: row.task,
    background: row.background === 1,
    status: (row.status as SubAgentRunRow["status"]) ?? "running",
    output: row.output,
    error: row.error,
    outputFile: row.output_file,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  };
}
