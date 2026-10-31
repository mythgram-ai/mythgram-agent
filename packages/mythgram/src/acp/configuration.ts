import type { AppStateRepo } from "../database/repositories/appStateRepo.js";
import {
  DEFAULT_ACP_CONFIG,
  type AcpConfig,
  type AcpContextManagement,
  type AcpMemoryAgent,
  type AcpMode,
} from "./types.js";

/**
 * ACP configuration persistence. The document lives in the SQLite `app_state`
 * repository under the `acp` key, alongside every other synced workspace slice.
 */

const MODES: readonly AcpMode[] = ["default", "chat", "custom", "team", "ceo"];
const CONTEXT_METHODS: readonly AcpContextManagement[] = ["inherit", "summarization", "sliding_window"];
const MEMORY_AGENTS: readonly AcpMemoryAgent[] = ["inherit", "on", "off"];

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function numOrNull(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
  return Number.isFinite(n) ? n : null;
}

function bool(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  if (value === 1 || value === "yes" || value === "on" || value === "true") return true;
  if (value === 0 || value === "no" || value === "off" || value === "false") return false;
  return fallback;
}

function clampFraction(value: number | null): number | null {
  if (value === null) return null;
  const fraction = value > 1 ? value / 100 : value;
  if (!Number.isFinite(fraction) || fraction <= 0) return null;
  return Math.min(0.9, Math.max(0.05, fraction));
}

function clampThreshold(value: number | null): number | null {
  if (value === null || value <= 0 || value > 1) return null;
  return value;
}

function clampTemperature(value: number | null): number | null {
  if (value === null) return null;
  return Math.min(2, Math.max(0, value));
}

function clampInterval(value: number | null): number | null {
  if (value === null) return null;
  return Math.min(50, Math.max(1, Math.floor(value)));
}

function clampContextLimit(value: number | null): number | null {
  if (value === null || value <= 0) return null;
  return Math.floor(value);
}

/** Defensively coerce an untrusted config document into a fully-populated AcpConfig. */
export function normalizeAcpConfig(raw: unknown): AcpConfig {
  const r = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const mode = MODES.includes(str(r.mode) as AcpMode) ? (str(r.mode) as AcpMode) : DEFAULT_ACP_CONFIG.mode;
  const method = CONTEXT_METHODS.includes(str(r.contextManagementMethod) as AcpContextManagement)
    ? (str(r.contextManagementMethod) as AcpContextManagement)
    : DEFAULT_ACP_CONFIG.contextManagementMethod;
  const memory = MEMORY_AGENTS.includes(str(r.memoryAgent) as AcpMemoryAgent)
    ? (str(r.memoryAgent) as AcpMemoryAgent)
    : DEFAULT_ACP_CONFIG.memoryAgent;
  return {
    enabled: bool(r.enabled, DEFAULT_ACP_CONFIG.enabled),
    mode,
    customAgentId: str(r.customAgentId).trim(),
    teamId: str(r.teamId).trim(),
    ceoId: str(r.ceoId).trim(),
    provider: str(r.provider).trim(),
    model: str(r.model).trim(),
    apiKey: str(r.apiKey),
    baseUrl: str(r.baseUrl).trim(),
    temperature: clampTemperature(numOrNull(r.temperature)),
    effort: str(r.effort).trim(),
    contextManagementMethod: method,
    slidingWindowTruncatePercent: clampFraction(numOrNull(r.slidingWindowTruncatePercent)),
    summaryThreshold: clampThreshold(numOrNull(r.summaryThreshold)),
    contextLimit: clampContextLimit(numOrNull(r.contextLimit)),
    memoryAgent: memory,
    memoryAgentInterval: clampInterval(numOrNull(r.memoryAgentInterval)),
  };
}

/** Reads/writes the single persisted `acp` configuration document. */
export class AcpConfigManager {
  constructor(private readonly appState: AppStateRepo) {}

  get(): AcpConfig {
    return normalizeAcpConfig(this.appState.get("acp"));
  }

  save(raw: unknown): AcpConfig {
    const next = normalizeAcpConfig(raw);
    this.appState.set("acp", next);
    return next;
  }
}
