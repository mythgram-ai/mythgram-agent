import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import dotenv from "dotenv";

dotenv.config();

const currentDir = path.dirname(fileURLToPath(import.meta.url));

/** Root of the mythgram package (one level above src/). */
export const PROJECT_ROOT = path.resolve(currentDir, "..");

/**
 * Name of the application data directory. It is created exactly once (at boot) inside
 * the initial workspace root (or at MYTHGRAM_DATA_DIR when that env var is set) and is
 * never created or moved again when the active workspace is switched.
 */
export const MYTHGRAM_DATA_DIR_NAME = ".mythgram";

function resolveWorkspaceRoot(): string {
  const configured = process.env.WORKSPACE_ROOT?.trim();
  if (configured) {
    // An explicit WORKSPACE_ROOT may be absolute or relative to where mythgram was started.
    return path.isAbsolute(configured)
      ? path.normalize(configured)
      : path.resolve(process.cwd(), configured);
  }
  // No pre-added workspace folder: the workspace is wherever mythgram is started/running.
  // e.g. running `npm run dev` in example/example/example makes that directory the workspace.
  return path.normalize(process.cwd());
}

export interface AppConfig {
  port: number;
  workspaceRoot: string;
  /**
   * Absolute path of the fixed application data directory (the ".mythgram" folder).
   * Resolved once at boot by {@link ensureWorkspace} from the initial workspace root
   * (or the MYTHGRAM_DATA_DIR env override) and never changed when the workspace is
   * switched, so the SQLite database, artifacts, skills, checkpoints, ... always live
   * in a single place. Undefined before boot and in isolated tests, where callers fall
   * back to `<workspaceRoot>/.mythgram` via {@link resolveDataRoot}.
   */
  dataRoot?: string;
  maxIterations: number;
  corsOrigins: string[] | "*";
  shellTimeoutMs: number;
  /** How long a submitted plan waits for human approval before the agent continues on its own. */
  planApprovalTimeoutMs: number;
  /** How long the user's questions wait for answers before the agent continues on its own. */
  questionTimeoutMs: number;
  /** Fallback web tool keys/provider, overridden per-request by the frontend settings. */
  searchProvider: "duckduckgo" | "tavily" | "exa" | "serpapi";
  /** Web fetch/scrape provider; builtin (free) is the default. */
  fetchProvider: "builtin" | "firecrawl";
  tavilyApiKey: string;
  exaApiKey: string;
  serpapiApiKey: string;
  firecrawlApiKey: string;
  /** Server fallback for the Composio API key (overridden by frontend Settings). */
  composioApiKey: string;
  /**
   * Server fallback TTS API keys, used when a provider has no key stored in the
   * TTS panel. Optional so existing test fixtures keep type-checking (matching
   * the `summaryThreshold` convention).
   */
  openrouterApiKey?: string;
  kittenmlApiKey?: string;
  /** Model-id substrings that are always treated as vision capable (read_image tool). */
  visionModelPatterns: string[];
  /** Model-id substrings that are always treated as text-only (read_image tool). */
  textOnlyModelPatterns: string[];
  /** Server default for the background memory agent on/off switch (frontend Settings overrides per turn). */
  memoryAgentEnabled: boolean;
  /** Server default for after how many completed user tasks the memory agent builds memory. */
  memoryAgentInterval: number;
  /**
   * Context-utilization fraction (0..1) that triggers automatic summarization
   * handoff. Default 0.9 (90%). Overridable via SUMMARY_THRESHOLD env.
   */
  summaryThreshold?: number;
  /**
   * Fraction of the context window freed per sliding-window truncation
   * (0.05..0.9). Default 0.3 (30%). Overridable via
   * SLIDING_WINDOW_TRUNCATE_PERCENT env; the frontend Settings value wins
   * per turn when present.
   */
  slidingWindowTruncatePercent?: number;
}

function parseCorsOrigins(raw: string | undefined): string[] | "*" {
  if (!raw || raw.trim() === "*" || raw.trim() === "") return "*";
  return raw
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
}

function parseSearchProvider(raw: string | undefined): "duckduckgo" | "tavily" | "exa" | "serpapi" {
  const value = raw?.trim().toLowerCase();
  if (value === "exa" || value === "serpapi" || value === "tavily") return value;
  // DuckDuckGo is the free, keyless default provider.
  return "duckduckgo";
}

function parseFetchProvider(raw: string | undefined): "builtin" | "firecrawl" {
  const value = raw?.trim().toLowerCase();
  if (value === "firecrawl") return "firecrawl";
  // The built-in scraper is free and keyless.
  return "builtin";
}

/** Parse a comma-separated list of model-id substrings from an env var. */
function parsePatterns(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

function parseMemoryAgentEnabled(raw: string | undefined): boolean {
  const value = (raw ?? "").trim().toLowerCase();
  if (value === "0" || value === "false" || value === "no" || value === "off") return false;
  return true;
}

function parseMemoryAgentInterval(raw: string | undefined): number {
  const n = Number(raw ?? 3);
  if (!Number.isFinite(n)) return 3;
  return Math.min(50, Math.max(1, Math.floor(n)));
}

function parseSummaryThreshold(raw: string | undefined): number {
  const n = raw !== undefined && raw.trim() !== "" ? Number(raw) : NaN;
  if (!Number.isFinite(n) || n <= 0 || n > 1) return 0.9;
  return n;
}

function parseSlidingWindowTruncatePercent(raw: string | undefined): number {
  const n = raw !== undefined && raw.trim() !== "" ? Number(raw) : NaN;
  const fraction = Number.isFinite(n) && n > 1 ? n / 100 : n;
  if (!Number.isFinite(fraction) || fraction <= 0) return 0.3;
  return Math.min(0.9, Math.max(0.05, fraction));
}

export const config: AppConfig = {
  port: Number(process.env.PORT ?? 8787),
  workspaceRoot: resolveWorkspaceRoot(),
  maxIterations: Number(process.env.MAX_ITERATIONS ?? 1000),
  corsOrigins: parseCorsOrigins(process.env.CORS_ORIGINS),
  shellTimeoutMs: Number(process.env.SHELL_TIMEOUT_MS ?? 180_000),
  planApprovalTimeoutMs: Number(process.env.PLAN_APPROVAL_TIMEOUT_MS ?? 60_000),
  questionTimeoutMs: Number(process.env.QUESTION_TIMEOUT_MS ?? 180_000),
  searchProvider: parseSearchProvider(process.env.SEARCH_PROVIDER),
  fetchProvider: parseFetchProvider(process.env.FETCH_PROVIDER),
  tavilyApiKey: process.env.TAVILY_API_KEY?.trim() ?? "",
  exaApiKey: process.env.EXA_API_KEY?.trim() ?? "",
  serpapiApiKey: process.env.SERPAPI_API_KEY?.trim() ?? "",
  firecrawlApiKey: process.env.FIRECRAWL_API_KEY?.trim() ?? "",
  composioApiKey: process.env.COMPOSIO_API_KEY?.trim() ?? "",
  openrouterApiKey: process.env.OPENROUTER_API_KEY?.trim() ?? "",
  kittenmlApiKey: process.env.KITTENML_API_KEY?.trim() ?? "",
  visionModelPatterns: parsePatterns(process.env.VISION_MODEL_PATTERNS),
  textOnlyModelPatterns: parsePatterns(process.env.TEXT_ONLY_MODEL_PATTERNS),
  memoryAgentEnabled: parseMemoryAgentEnabled(process.env.MEMORY_AGENT_ENABLED),
  memoryAgentInterval: parseMemoryAgentInterval(process.env.MEMORY_AGENT_INTERVAL),
  summaryThreshold: parseSummaryThreshold(
    process.env.SUMMARY_THRESHOLD ?? process.env.CONTEXT_SUMMARY_THRESHOLD,
  ),
  slidingWindowTruncatePercent: parseSlidingWindowTruncatePercent(
    process.env.SLIDING_WINDOW_TRUNCATE_PERCENT,
  ),
};

/**
 * Resolve the fixed ".mythgram" data directory at boot. Preference order:
 *   1. the MYTHGRAM_DATA_DIR env var (absolute, or relative to the process cwd); else
 *   2. `<workspaceRoot>/.mythgram` for the workspace the server started in.
 */
export function resolveDataRootOverride(workspaceRoot: string): string {
  const configured = process.env.MYTHGRAM_DATA_DIR?.trim();
  if (configured) {
    return path.isAbsolute(configured)
      ? path.normalize(configured)
      : path.resolve(process.cwd(), configured);
  }
  return path.join(workspaceRoot, MYTHGRAM_DATA_DIR_NAME);
}

/**
 * The fixed application data directory (the ".mythgram" folder). After boot this is the
 * single directory created by {@link ensureWorkspace}; it is NOT affected by workspace
 * switches. Before boot (and in isolated tests that never call ensureWorkspace) it falls
 * back to `<workspaceRoot>/.mythgram` so each caller keeps its own local data dir.
 */
export function resolveDataRoot(workspaceRoot: string): string {
  return config.dataRoot ?? path.join(workspaceRoot, MYTHGRAM_DATA_DIR_NAME);
}

/** Ensure the workspace directory exists so file tools never hit permission/ENOENT errors. */
export function ensureWorkspace(): void {
  fs.mkdirSync(config.workspaceRoot, { recursive: true });
  // The ".mythgram" data dir is created ONCE here (at boot) and holds the SQLite database,
  // sub-agent outputs, skills materializations, artifacts, checkpoints, uploads, ... It is
  // intentionally NOT tied to the active workspace: switching the workspace never creates
  // or moves it (see setWorkspaceRoot). Idempotent: a later call keeps the first data root.
  if (!config.dataRoot) {
    config.dataRoot = resolveDataRootOverride(config.workspaceRoot);
  }
  fs.mkdirSync(config.dataRoot, { recursive: true });
}

/**
 * Switch the active workspace at runtime (used by the custom workspace picker).
 * Creates the directory when missing and points all workspace-sandboxed file tools at the
 * new root from now on. The fixed ".mythgram" data directory is deliberately left untouched:
 * the app keeps using the single data dir created at boot, and no ".mythgram" folder is
 * created inside the newly selected workspace.
 */
export function setWorkspaceRoot(next: string): string {
  const resolved = path.normalize(next);
  fs.mkdirSync(resolved, { recursive: true });
  config.workspaceRoot = resolved;
  return resolved;
}
