import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { SubAgentDefinition } from "../tools/types.js";
import { SUB_AGENT_RESTRICTED_TOOLS } from "../tools/subAgentRestrictedTools.js";

/**
 * Root directory holding the built-in default sub-agent data files. Each `.md` file in this
 * folder is one pre-added sub-agent: its YAML frontmatter block (top, delimited by `---`) holds
 * the `name` and `description`, and the remaining body is the sub-agent's system prompt.
 */
export const DEFAULT_SUB_AGENTS_ROOT = path.dirname(fileURLToPath(import.meta.url));

/**
 * Tools a pre-added sub-agent is never granted — the single canonical restricted set
 * (SUB_AGENT_RESTRICTED_TOOLS). Everything else registered in the tool registry (file, shell, web,
 * knowledge, memory, and skill discovery tools) is granted.
 */
export const DEFAULT_SUB_AGENT_DISALLOWED_TOOLS: readonly string[] = SUB_AGENT_RESTRICTED_TOOLS;

/**
 * Every tool name currently registered in the agent's tool registry (the same set the main agent
 * sees). Kept in sync with createToolRegistry in ../tools/index.js — 65 tools total.
 */
const ALL_AGENT_TOOLS: readonly string[] = [
  "file_read",
  "file_write",
  "file_list",
  "grep",
  "astgrep",
  "glob",
  "str_replace",
  "apply_multiple_edits",
  "apply_patch",
  "shall_tool",
  "shell_view",
  "bash_write_to_process",
  "web_search",
  "image_search",
  "fatch_web_urls",
  "read_image",
  "scan_qr_code",
  "call_sub_agent",
  "call_multiple_sub_agents",
  "list_sub_agents",
  "list_skills",
  "skill_initialize",
  "submit_plan",
  "ask_question_to_user",
  "create_sub_agent",
  "create_skill",
  "TodoWrite",
  "read_todos",
  "memory_list",
  "memory_search",
  "memory_read",
  "memory_write",
  "memory_edit",
  "memory_delete",
  "knowledge_list",
  "knowledge_search",
  "knowledge_read",
  "knowledge_create",
  "knowledge_edit",
  "knowledge_delete",
  "embed_url",
  "attach_files",
  "wait",
  "create_checkpoint",
  "list_checkpoints",
  "delete_checkpoint",
  "restore_checkpoint",
  "delete_sub_agent",
  "list_sub_agent_sessions",
  "reuse_same_sub_agent_session",
  "delete_skill",
  "schedule_create",
  "schedule_list",
  "schedule_update",
  "schedule_on",
  "schedule_off",
  "schedule_run_now",
  "schedule_delete",
  "schedule_get",
  "connect_remote_mcp",
  "connect_local_mcp_server",
  "list_available_mcp_servers",
  "delete_mcp_server",
  "on_off_mcp_server",
  "get_mcp_server_status",
];

/**
 * The canonical allowed-tool set granted to every pre-added default sub-agent: all registered
 * tools except the restricted sub-agent tools above (45 tools). This is the same effective set the
 * sub-agent runner (../subagents.js SUB_AGENT_EXCLUDED_TOOLS) enforces at runtime.
 */
export const DEFAULT_SUB_AGENT_TOOLS: readonly string[] = ALL_AGENT_TOOLS.filter(
  (name) => !DEFAULT_SUB_AGENT_DISALLOWED_TOOLS.includes(name),
);

/** Fields we read from the YAML frontmatter block at the top of a sub-agent data file. */
interface SubAgentFrontmatter {
  name?: string;
  description?: string;
}

/**
 * Load the built-in, pre-installed default sub-agents shipped with the agent. Each `.md` file in
 * this folder becomes one sub-agent: frontmatter `name` / `description` plus a body of system
 * prompt, granted the canonical DEFAULT_SUB_AGENT_TOOLS. The read is fast and the result is
 * process-stable, so callers should cache the returned promise rather than call this repeatedly.
 */
export async function loadDefaultSubAgents(): Promise<SubAgentDefinition[]> {
  const entries = await fs.readdir(DEFAULT_SUB_AGENTS_ROOT, { withFileTypes: true });
  const fileNames = entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".md"))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));

  const subAgents: SubAgentDefinition[] = [];
  for (const fileName of fileNames) {
    const raw = await fs.readFile(path.join(DEFAULT_SUB_AGENTS_ROOT, fileName), "utf8");
    const stripped = raw.replace(/^\uFEFF/, "");
    const meta = parseFrontmatter(stripped);
    const name = (meta.name ?? "").trim();

    // A default sub-agent must declare a usable name; otherwise skip the file (defensive — the
    // shipped data always sets one, but a hand-edited file must not crash the loader).
    if (!name) continue;

    subAgents.push({
      name,
      description: (meta.description ?? "").trim(),
      system_prompt: stripFrontmatter(stripped).trim(),
      tools: [...DEFAULT_SUB_AGENT_TOOLS],
      enabled: true,
    });
  }

  return subAgents;
}

let cachedDefaults: Promise<SubAgentDefinition[]> | undefined;

/**
 * Memoized accessor for the built-in default sub-agents. The source folder is static for the life
 * of the process, so we load it once and reuse the result for every turn.
 */
export function resolveDefaultSubAgents(): Promise<SubAgentDefinition[]> {
  if (!cachedDefaults) {
    cachedDefaults = loadDefaultSubAgents().catch((error) => {
      // Do not cache a failed load — a transient read error should not shadow the defaults for the
      // rest of the process. Fall back to an empty default set and retry next time.
      cachedDefaults = undefined;
      console.error(
        `[sub-agents] failed to load default sub-agents: ${error instanceof Error ? error.message : String(error)}`,
      );
      return [] as SubAgentDefinition[];
    });
  }
  return cachedDefaults;
}

/**
 * Merge the pre-installed default sub-agents with the user's own sub-agents so the defaults are
 * always available unless the user replaces one (matched by case-insensitive name) with their own
 * version — which may disable it by setting enabled:false.
 */
export function mergeDefaultSubAgents(
  defaults: SubAgentDefinition[],
  userSubAgents: SubAgentDefinition[],
): SubAgentDefinition[] {
  const merged = new Map<string, SubAgentDefinition>();
  for (const subAgent of defaults) {
    merged.set(subAgent.name.trim().toLowerCase(), subAgent);
  }
  for (const subAgent of userSubAgents) {
    const key = subAgent.name.trim().toLowerCase();
    if (key.length > 0) merged.set(key, subAgent);
  }
  return Array.from(merged.values());
}

/**
 * Parse the YAML frontmatter block delimited by `---` at the top of a file, extracting the `name`
 * and `description` keys. Unknown keys are ignored so data files can carry extras.
 */
function parseFrontmatter(content: string): SubAgentFrontmatter {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(content);
  if (!match) return {};

  const meta: SubAgentFrontmatter = {};
  for (const line of match[1]!.split(/\r?\n/)) {
    const separator = line.indexOf(":");
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim().toLowerCase();
    const value = line
      .slice(separator + 1)
      .trim()
      .replace(/^["']|["']$/g, "")
      .trim();
    if (key === "name") meta.name = value;
    else if (key === "description") meta.description = value;
  }
  return meta;
}

/** Remove the frontmatter block from a file's content, returning the remaining body. */
function stripFrontmatter(content: string): string {
  const match = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(content);
  return match ? content.slice(match[0].length) : content;
}