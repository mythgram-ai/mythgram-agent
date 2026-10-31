import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import dotenv from "dotenv";

dotenv.config();

const currentDir = path.dirname(fileURLToPath(import.meta.url));

/** Root of the mythgram package (one level above src/). */
export const PROJECT_ROOT = path.resolve(currentDir, "..");

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

/** Ensure the workspace directory exists so file tools never hit permission/ENOENT errors. */
export function ensureWorkspace(): void {
  fs.mkdirSync(config.workspaceRoot, { recursive: true });
  // The ".mythgram" dir is initialized where the workspace is set (holds the SQLite
  // database, sub-agent outputs, skills materializations, uploads, ...).
  fs.mkdirSync(path.join(config.workspaceRoot, ".mythgram"), { recursive: true });
}

/**
 * Switch the active workspace at runtime (used by the custom workspace picker).
 * Creates the directory (and its ".mythgram" dir) when missing and points all
 * workspace-sandboxed file tools at the new root from now on.
 */
export function setWorkspaceRoot(next: string): string {
  const resolved = path.normalize(next);
  fs.mkdirSync(resolved, { recursive: true });
  fs.mkdirSync(path.join(resolved, ".mythgram"), { recursive: true });
  config.workspaceRoot = resolved;
  return resolved;
}
