import { API_ROUTES, routeUrl } from "@/app/api/routes";
import { requestJson } from "@/lib/api";

/**
 * ACP (Agent Client Protocol) client + shared types. The ACP panel reads status
 * and the connection instructions from `GET /api/acp` and persists the single
 * configuration document through `PUT /api/acp/config`. The backend is the source
 * of truth; the standalone stdio bridge resolves each turn from it.
 */

export type AcpMode = "default" | "chat" | "custom" | "team" | "ceo";
export type AcpContextManagement = "inherit" | "summarization" | "sliding_window";
export type AcpMemoryAgent = "inherit" | "on" | "off";

export interface AcpConfig {
  enabled: boolean;
  mode: AcpMode;
  customAgentId: string;
  teamId: string;
  ceoId: string;
  provider: string;
  model: string;
  apiKey: string;
  baseUrl: string;
  temperature: number | null;
  effort: string;
  contextManagementMethod: AcpContextManagement;
  slidingWindowTruncatePercent: number | null;
  summaryThreshold: number | null;
  contextLimit: number | null;
  memoryAgent: AcpMemoryAgent;
  memoryAgentInterval: number | null;
}

export interface AcpNamed {
  id: string;
  name: string;
}

export interface AcpInfo {
  config: AcpConfig;
  llm: { provider: string; model: string; inherited: boolean; hasApiKey: boolean; ready: boolean };
  tts: { providerId: string; providerName: string } | null;
  workspace: string;
  customAgents: AcpNamed[];
  teams: AcpNamed[];
  ceos: AcpNamed[];
  selected: { mode: AcpMode; label: string };
  connection: {
    transport: string;
    protocolVersion: number;
    command: string;
    args: string[];
    backendUrl: string;
    agent: { name: string; title: string; version: string };
    entryPath: string;
  };
}

export const DEFAULT_ACP_CONFIG: AcpConfig = {
  enabled: true,
  mode: "default",
  customAgentId: "",
  teamId: "",
  ceoId: "",
  provider: "",
  model: "",
  apiKey: "",
  baseUrl: "",
  temperature: null,
  effort: "",
  contextManagementMethod: "inherit",
  slidingWindowTruncatePercent: null,
  summaryThreshold: null,
  contextLimit: null,
  memoryAgent: "inherit",
  memoryAgentInterval: null,
};

const MODES: AcpMode[] = ["default", "chat", "custom", "team", "ceo"];
const METHODS: AcpContextManagement[] = ["inherit", "summarization", "sliding_window"];
const MEMORY: AcpMemoryAgent[] = ["inherit", "on", "off"];

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function numOrNull(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
  return Number.isFinite(n) ? n : null;
}

/** Defensively normalize an ACP config document from an untrusted source. */
export function normalizeAcpConfig(raw: unknown): AcpConfig {
  const r = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const mode = MODES.includes(str(r.mode) as AcpMode) ? (str(r.mode) as AcpMode) : "default";
  const method = METHODS.includes(str(r.contextManagementMethod) as AcpContextManagement)
    ? (str(r.contextManagementMethod) as AcpContextManagement)
    : "inherit";
  const memory = MEMORY.includes(str(r.memoryAgent) as AcpMemoryAgent)
    ? (str(r.memoryAgent) as AcpMemoryAgent)
    : "inherit";
  return {
    enabled: r.enabled !== false,
    mode,
    customAgentId: str(r.customAgentId).trim(),
    teamId: str(r.teamId).trim(),
    ceoId: str(r.ceoId).trim(),
    provider: str(r.provider).trim(),
    model: str(r.model).trim(),
    apiKey: str(r.apiKey),
    baseUrl: str(r.baseUrl).trim(),
    temperature: numOrNull(r.temperature),
    effort: str(r.effort).trim(),
    contextManagementMethod: method,
    slidingWindowTruncatePercent: numOrNull(r.slidingWindowTruncatePercent),
    summaryThreshold: numOrNull(r.summaryThreshold),
    contextLimit: numOrNull(r.contextLimit),
    memoryAgent: memory,
    memoryAgentInterval: numOrNull(r.memoryAgentInterval),
  };
}

function normalizeNamed(raw: unknown): AcpNamed[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item): item is Record<string, unknown> => !!item && typeof item === "object")
    .map((item) => ({ id: str(item.id), name: str(item.name) || str(item.id) }))
    .filter((item) => item.id.length > 0);
}

/** Fetch the ACP status, configuration, and connection instructions. */
export async function fetchAcpInfo(signal?: AbortSignal): Promise<AcpInfo> {
  const data = await requestJson<Record<string, unknown>>(routeUrl(API_ROUTES.acpInfo), undefined, signal);
  const connection = (data.connection ?? {}) as Record<string, unknown>;
  const llm = (data.llm ?? {}) as Record<string, unknown>;
  const ttsRaw = data.tts as Record<string, unknown> | null | undefined;
  return {
    config: normalizeAcpConfig(data.config),
    llm: {
      provider: str(llm.provider),
      model: str(llm.model),
      inherited: llm.inherited === true,
      hasApiKey: llm.hasApiKey === true,
      ready: llm.ready === true,
    },
    tts: ttsRaw ? { providerId: str(ttsRaw.providerId), providerName: str(ttsRaw.providerName) } : null,
    workspace: str(data.workspace),
    customAgents: normalizeNamed(data.customAgents),
    teams: normalizeNamed(data.teams),
    ceos: normalizeNamed(data.ceos),
    selected: {
      mode: (["default", "chat", "custom", "team", "ceo"] as const).includes(
        str((data.selected as Record<string, unknown> | undefined)?.mode) as AcpMode,
      )
        ? (str((data.selected as Record<string, unknown> | undefined)?.mode) as AcpMode)
        : "default",
      label: str((data.selected as Record<string, unknown> | undefined)?.label) || "Default Agent",
    },
    connection: {
      transport: str(connection.transport) || "stdio",
      protocolVersion: typeof connection.protocolVersion === "number" ? connection.protocolVersion : 1,
      command: str(connection.command) || "npx",
      args: Array.isArray(connection.args) ? (connection.args as unknown[]).filter((a): a is string => typeof a === "string") : [],
      backendUrl: str(connection.backendUrl),
      agent: (connection.agent ?? {}) as AcpInfo["connection"]["agent"],
      entryPath: str(connection.entryPath),
    },
  };
}

/** Persist the ACP configuration document (backend normalizes + echoes it). */
export async function saveAcpConfig(config: AcpConfig): Promise<AcpConfig> {
  const data = await requestJson<{ config?: unknown }>(routeUrl(API_ROUTES.acpConfigUpdate), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ config }),
  });
  return normalizeAcpConfig(data.config ?? config);
}
