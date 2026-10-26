import { API_ROUTES, routeUrl } from "@/app/api/routes";
import { requestJson } from "@/lib/api";

/**
 * Catalog of tools a sub-agent can be granted. The authoritative list is fetched at runtime from
 * the mythgram backend (`GET /api/tools`), which returns every registered tool minus the 14
 * restricted sub-agent tools — so the popup always mirrors the backend and never needs a
 * hand-maintained list in code. The constant below is only a bundled FALLBACK used if that fetch
 * fails (offline / backend not ready). Keep it roughly in sync, but the backend is the source of
 * truth.
 */
export interface SubAgentToolMeta {
  name: string;
  label: string;
  description: string;
}

/** Raw tool entry as returned by the backend `/api/tools` endpoint. */
interface BackendToolInfo {
  name: string;
  description: string;
}

/**
 * Clean a raw backend tool description for compact display: a few tool descriptions embed a full
 * JSON schema or long "Usage:" block. Keep just the leading human sentence(s) — cut at the first
 * embedded JSON object or the "Usage"/"Usage notes" heading — and collapse whitespace.
 */
export function cleanToolDescription(raw: string): string {
  let text = (raw ?? "").trim();
  const jsonAt = text.search(/\n\s*\{/);
  if (jsonAt !== -1) text = text.slice(0, jsonAt);
  const usageAt = text.search(/\n\s*Usage(?:\s+notes)?:/i);
  if (usageAt !== -1) text = text.slice(0, usageAt);
  return text.replace(/\s+/g, " ").trim();
}

/**
 * Turn a snake_case / lowercase tool name into a readable Title Case label
 * (e.g. "knowledge_read" -> "Knowledge Read", "fatch_web_urls" -> "Fatch Web Urls").
 */
export function humanizeToolName(name: string): string {
  return name
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .map((word) => (word.length > 0 ? word[0]!.toUpperCase() + word.slice(1) : word))
    .join(" ");
}

/**
 * The bundled fallback list of the 45 tools a sub-agent may be granted (all registered tools minus
 * the restricted sub-agent tools). Used only when the backend `/api/tools` fetch fails.
 */
export const SUB_AGENT_TOOLS: readonly SubAgentToolMeta[] = [
  { name: "file_read", label: "Read file", description: "Read a file from the local filesystem (absolute path); use offset/limit for large files." },
  { name: "file_write", label: "Write file", description: "Create a new file or fully overwrite an existing one." },
  { name: "file_list", label: "List files", description: "List files and directories inside a workspace directory." },
  { name: "grep", label: "Search file contents", description: "Fast regex search over file contents (ripgrep style, up to 50 matches with file, line, content)." },
  { name: "astgrep", label: "AST code search", description: "Structural code search with AST patterns and $UPPERCASE wildcards (up to 50 matches with file, line, matched code, captures)." },
  { name: "glob", label: "Glob files", description: "Find files and directories matching a glob pattern (up to 100 matches)." },
  { name: "str_replace", label: "Edit file", description: "Exact string replacement inside an existing file." },
  { name: "apply_multiple_edits", label: "Apply multiple edits", description: "Apply several exact edits to one file in a single validated call." },
  { name: "apply_patch", label: "Apply patch", description: "Edit files by applying a structured multi-file patch (add/update/delete/rename) in one validated call." },
  { name: "shall_tool", label: "Terminal", description: "Run a shell command from the workspace directory." },
  { name: "shell_view", label: "View shell output", description: "View the live buffered output of a background shell session." },
  { name: "bash_write_to_process", label: "Write to process", description: "Write to the stdin of a running background shell process (prompts, REPLs, dev servers)." },
  { name: "web_search", label: "Web search", description: "Search the web for up-to-date information." },
  { name: "image_search", label: "Image search", description: "Search the web for images and return direct image URLs and source URLs." },
  { name: "fatch_web_urls", label: "Fetch URL", description: "Fetch and extract clean content from web URLs." },
  { name: "read_image", label: "Read image", description: "Read an image (workspace path or hosted URL) and visually analyze it. Requires a vision model." },
  { name: "scan_qr_code", label: "Scan QR code", description: "Scan and decode QR codes from an image file. Provide the path to the image containing the QR code." },
  { name: "list_skills", label: "List skills", description: "List the available skills (name, description, and file tree of each skill folder)." },
  { name: "skill_initialize", label: "Initialize skill", description: "Materialize one or more skills onto disk so their files can be read." },
  { name: "create_skill", label: "Create skill", description: "Package a folder into a reusable skill and save it for later use." },
  { name: "memory_list", label: "List memory", description: "Discover memory files with their sizes and limits." },
  { name: "memory_search", label: "Search memory", description: "Find which memory files contain a query, returning each matching line number and its content." },
  { name: "memory_read", label: "Read memory", description: "Load a memory file's contents by exact path." },
  { name: "memory_write", label: "Write memory", description: "Create or fully replace a memory file." },
  { name: "memory_edit", label: "Edit memory", description: "Exact old→new replacement inside a memory file." },
  { name: "memory_delete", label: "Delete memory", description: "Delete a non-pre-added memory file." },
  { name: "knowledge_list", label: "List knowledge", description: "List the user's knowledge base files." },
  { name: "knowledge_search", label: "Search knowledge", description: "Find which knowledge files contain a query, returning each matching line number and its content." },
  { name: "knowledge_read", label: "Read knowledge", description: "Load a knowledge file's contents by exact path." },
  { name: "knowledge_create", label: "Create knowledge", description: "Create a new knowledge file." },
  { name: "knowledge_edit", label: "Edit knowledge", description: "Exact old→new replacement inside a knowledge file." },
  { name: "knowledge_delete", label: "Delete knowledge", description: "Delete a knowledge file." },
  { name: "wait", label: "Wait", description: "Pause for a set number of seconds (1–180) before continuing." },
  { name: "create_checkpoint", label: "Create checkpoint", description: "Save a backup ZIP of the current workspace so it can be restored later." },
  { name: "list_checkpoints", label: "List checkpoints", description: "List every available checkpoint with its name and description." },
  { name: "delete_checkpoint", label: "Delete checkpoint", description: "Delete a checkpoint and its related data by its exact name." },
  { name: "restore_checkpoint", label: "Restore checkpoint", description: "Restore the workspace to a previously saved checkpoint (a safety backup is created first)." },
  { name: "schedule_create", label: "Create schedule", description: "Create a background schedule that runs an agent task at a time or recurrence." },
  { name: "schedule_list", label: "List schedules", description: "List scheduled tasks filtered by their current status." },
  { name: "schedule_update", label: "Update schedule", description: "Update the task prompt of a schedule without affecting its next run." },
  { name: "schedule_on", label: "Turn on schedule", description: "Turn on a paused schedule so it runs as scheduled." },
  { name: "schedule_off", label: "Turn off schedule", description: "Turn off an active schedule (paused, can be turned on again)." },
  { name: "schedule_run_now", label: "Run schedule now", description: "Immediately execute a scheduled task without waiting." },
  { name: "schedule_delete", label: "Delete schedule", description: "Permanently delete a scheduled task." },
  { name: "schedule_get", label: "Get schedule", description: "Get the complete details of a scheduled task." },
] as const;

/**
 * Fetch the sub-agent-grantable tools from the backend. Returns the tools with a derived,
 * human-friendly label per tool. Throws on failure so the caller can fall back to SUB_AGENT_TOOLS.
 */
export async function fetchSubAgentTools(signal?: AbortSignal): Promise<SubAgentToolMeta[]> {
  const data = await requestJson<{ tools?: BackendToolInfo[] }>(
    routeUrl(API_ROUTES.toolsList),
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
