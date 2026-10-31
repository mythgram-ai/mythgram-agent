import type { ToolRegistry, OpenAIToolSchema } from "../tools/registry.js";
import { buildSystemPrompt } from "../systemprompt.js";
import { CHANNEL_ONLY_TOOLS } from "../tools/sendResponses.js";
import {
  isCustomAgentExcludedTool,
  type CustomAgentConfig,
} from "./configuration.js";

/** One tool entry advertised to the frontend for Custom Agent creation. */
export interface CustomAgentToolInfo {
  name: string;
  description: string;
}

/**
 * The catalog of tools a Custom Agent may be granted: every registered tool EXCEPT the multi-agent
 * collaboration tools (a Custom Agent is a top-level Main Agent, never a team member). This mirrors
 * the Main Agent's own tool surface — sub-agent, memory, skills, knowledge, and every other tool are
 * all selectable. MCP tools (native `mcp_*` names from connected servers) are selectable too and
 * are preserved verbatim by the runner. The frontend fetches this so the creation UI always
 * reflects the live registry.
 */
export function listCustomAgentTools(tools: ToolRegistry): CustomAgentToolInfo[] {
  const channelOnly = new Set<string>(CHANNEL_ONLY_TOOLS);
  return tools.schemas
    .filter((schema) => !isCustomAgentExcludedTool(schema.function.name))
    // Channel-only tools (send_responses) are never selectable: channel turns append them
    // automatically, and they refuse to run outside a channel anyway.
    .filter((schema) => !channelOnly.has(schema.function.name))
    .map((schema) => ({ name: schema.function.name, description: schema.function.description }));
}

/** The outcome of resolving a Custom Agent's selected tools against the live registry. */
export interface ResolvedCustomAgentTools {
  /** The OpenAI tool schemas for the resolved tools (latest definitions from the registry). */
  schemas: OpenAIToolSchema[];
  /** Tool names that resolved successfully (existing, non-excluded), in registry order. */
  allowed: string[];
  /** Selected names that no longer exist in the registry (were removed) — ignored, reported here. */
  missing: string[];
  /** Selected names that are not permitted for a Custom Agent (multi-agent tools) — ignored. */
  excluded: string[];
}

/**
 * Resolve a Custom Agent's selected tool identifiers against the CURRENT tool registry.
 *
 * Safety/validation (spec §10):
 *  - Each selected tool is validated to still exist; removed tools are dropped and reported in
 *    `missing` rather than causing a failure.
 *  - Excluded (multi-agent) tools are never resolved, reported in `excluded`.
 *  - The returned schemas come straight from the registry, so the agent always uses the LATEST tool
 *    definitions and schemas — nothing stale is stored on the config.
 *
 * When `selectedTools` is empty the agent gets NO tool schemas (an explicit, valid choice: a
 * tool-less conversational agent). Callers that want "all tools" should pass the full catalog.
 */
export function resolveCustomAgentTools(
  tools: ToolRegistry,
  selectedTools: readonly string[],
): ResolvedCustomAgentTools {
  const allowed: string[] = [];
  const missing: string[] = [];
  const excluded: string[] = [];
  const seen = new Set<string>();

  for (const raw of selectedTools) {
    const name = typeof raw === "string" ? raw.trim() : "";
    if (!name || seen.has(name)) continue;
    seen.add(name);
    if (isCustomAgentExcludedTool(name)) {
      excluded.push(name);
      continue;
    }
    if (!tools.has(name)) {
      missing.push(name);
      continue;
    }
    allowed.push(name);
  }

  return { schemas: tools.schemasFor(allowed), allowed, missing, excluded };
}

/**
 * Resolve the system prompt a Custom Agent runs with. The user's edited prompt is used VERBATIM when
 * present (it was pre-filled from the Main Agent's prompt and then customized). As a safety fallback —
 * e.g. a corrupted/blank stored prompt — the built Main Agent prompt is used so the agent still has
 * its full base capabilities and never runs promptless.
 */
export function resolveCustomAgentSystemPrompt(
  config: Pick<CustomAgentConfig, "systemPrompt">,
  workspaceRoot: string,
): string {
  const custom = (config.systemPrompt ?? "").trim();
  if (custom.length > 0) return custom;
  return buildSystemPrompt(workspaceRoot, {});
}
