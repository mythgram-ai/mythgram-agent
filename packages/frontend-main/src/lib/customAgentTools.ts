import { API_ROUTES, routeUrl } from "@/app/api/routes";
import { requestJson } from "@/lib/api";
import { cleanToolDescription, humanizeToolName, type SubAgentToolMeta } from "@/lib/subAgentTools";

/**
 * Tools a Custom Agent can be granted. The authoritative list is fetched at runtime from the mythgram
 * backend (`GET /api/tools/custom-agent`), which returns every registered tool the Main Agent has
 * MINUS the multi-agent/team tools — so a Custom Agent, being a top-level Main Agent, gets the full
 * main-agent tool surface (sub-agent, memory, skills, knowledge, and more). The popup fetches this on
 * open (automatic) and via a Refresh button (manual), so it always mirrors the live tool registry.
 *
 * A Custom Agent tool entry is shaped exactly like a sub-agent tool entry (name/label/description).
 */
export type CustomAgentToolMeta = SubAgentToolMeta;

/** Raw tool entry as returned by the backend. */
interface BackendToolInfo {
  name: string;
  description: string;
}

/**
 * Fetch the Custom-Agent-grantable tools from the backend, with a derived human-friendly label per
 * tool. Throws on failure so callers can surface an error and keep the previous list.
 */
export async function fetchCustomAgentTools(signal?: AbortSignal): Promise<CustomAgentToolMeta[]> {
  const data = await requestJson<{ tools?: BackendToolInfo[] }>(
    routeUrl(API_ROUTES.customAgentToolsList),
    undefined,
    signal,
  );
  const tools = Array.isArray(data.tools) ? data.tools : [];
  return tools
    .filter((t) => t && typeof t.name === "string" && t.name.length > 0)
    .map((t) => ({
      name: t.name,
      label: humanizeToolName(t.name),
      description: cleanToolDescription(typeof t.description === "string" ? t.description : ""),
    }));
}

/**
 * Fetch the built Main Agent system prompt from the backend. Used to PRE-FILL a Custom Agent's
 * system-prompt field when the creation UI opens, so the Custom Agent starts with the same base
 * capabilities and instructions as the Main Agent. Throws on failure.
 */
export async function fetchMainAgentSystemPrompt(signal?: AbortSignal): Promise<string> {
  const data = await requestJson<{ system_prompt?: string }>(
    routeUrl(API_ROUTES.systemPrompt),
    undefined,
    signal,
  );
  return typeof data.system_prompt === "string" ? data.system_prompt : "";
}
