import fs from "node:fs/promises";
import path from "node:path";
import type { CustomAgentManager } from "./customagent/index.js";
import { isCustomAgentExcludedTool } from "./customagent/index.js";
import { CHANNEL_ONLY_TOOLS } from "./tools/sendResponses.js";
import { safeResolve } from "../utils/paths.js";
import type {
  CustomAgentCreateInput,
  CustomAgentInfo,
  CustomAgentsRuntime,
  ToolContext,
  ToolResult,
} from "./tools/types.js";

/**
 * Build the CustomAgentsRuntime for a turn that may manage custom agents.
 *
 * The runtime is a thin bridge over the SAME persistent CustomAgentManager the backend API
 * (/api/custom-agents) and the frontend's app-state sync use, so the agent, the REST API, and
 * the UI always read and write one source of truth (the SQLite `customAgents` app_state
 * document).
 *
 * Every mutation emits a `custom_agents_updated` SSE event carrying the COMPLETE normalized
 * list, exactly like the prompt-library tools: the frontend mirrors it into its store
 * immediately, so an agent created (or deleted) by another agent shows up everywhere without
 * a reload — and the next browser sync can never overwrite it with a stale copy.
 */
export function createCustomAgentsRuntime(
  manager: CustomAgentManager,
): CustomAgentsRuntime {
  return {
    list: () => opList(manager),
    create: (input, ctx) => opCreate(manager, input, ctx),
    removeByName: (name, ctx) => opRemoveByName(manager, name, ctx),
  };
}

/** Public list shape — exact name + short description only; never the system prompt or tools. */
function toInfo(entry: { id: string; name: string; description: string }): CustomAgentInfo {
  return { id: entry.id, name: entry.name, description: entry.description };
}

/** Uniform structured error for an unexpected failure inside a custom-agent operation. */
export function customAgentsFailure(error: unknown): ToolResult {
  return {
    ok: false,
    error: {
      code: "custom_agent_operation_failed",
      message: `Custom agent operation failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    },
  };
}

/** list_available_agents. */
function opList(manager: CustomAgentManager): ToolResult {
  try {
    const agents = manager.list().map(toInfo);
    return {
      ok: true,
      data: {
        count: agents.length,
        available_agents: agents.map((a) => ({
          name: a.name,
          description: a.description,
          short_description: a.description,
        })),
        message:
          agents.length === 0
            ? "No custom agents are available. Use create_agent to create one."
            : "Use the exact agent name with delete_agent to remove an agent.",
      },
    };
  } catch (error) {
    return customAgentsFailure(error);
  }
}

/**
 * create_agent — create a custom agent from a workspace Markdown prompt file.
 *
 * The file is resolved workspace-sandboxed (safeResolve), must exist, must be a regular
 * `.md` file, and must contain non-empty text. Its FULL contents become the new agent's
 * system prompt verbatim. The new agent is granted every currently-registered tool the
 * requesting context knows about, minus the custom-agent-excluded (multi-agent) and
 * channel-only tools — mirroring how create_sub_agent grants tools.
 */
async function opCreate(
  manager: CustomAgentManager,
  input: CustomAgentCreateInput,
  ctx: ToolContext,
): Promise<ToolResult> {
  const name = (input.name ?? "").trim();
  const shortDescription = (input.shortDescription ?? "").trim();
  const systemPromptFile = (input.systemPromptFile ?? "").trim();

  if (!name) {
    return {
      ok: false,
      error: {
        code: "agent_name_required",
        message: "A non-empty custom agent name is required.",
      },
    };
  }
  if (!shortDescription) {
    return {
      ok: false,
      error: {
        code: "agent_description_required",
        message: "A non-empty short description is required to create a custom agent.",
      },
    };
  }
  if (!systemPromptFile) {
    return {
      ok: false,
      error: {
        code: "system_prompt_file_required",
        message:
          "A workspace-relative Markdown file path is required (system_prompt_file), " +
          "for example: workspace/prompt/prompt.md. Create the prompt file first, then call create_agent.",
      },
    };
  }

  // Duplicate guard (case-insensitive exact): custom agents are addressed by exact name
  // for deletion, so two agents sharing a name would make deletion ambiguous.
  try {
    const existing = manager
      .list()
      .find((a) => a.name.trim().toLowerCase() === name.toLowerCase());
    if (existing) {
      return {
        ok: false,
        error: {
          code: "agent_already_exists",
          message:
            `A custom agent named "${existing.name}" already exists. Use a different name, ` +
            "or delete the existing agent first with delete_agent.",
          name: existing.name,
        },
      };
    }
  } catch (error) {
    return customAgentsFailure(error);
  }

  // Resolve + read the prompt file workspace-sandboxed.
  let absolute: string;
  try {
    absolute = safeResolve(ctx.workspaceRoot, systemPromptFile);
  } catch (error) {
    return {
      ok: false,
      error: {
        code: "invalid_prompt_file_path",
        message: error instanceof Error ? error.message : String(error),
        system_prompt_file: systemPromptFile,
      },
    };
  }

  const ext = path.extname(absolute).toLowerCase();
  if (ext !== ".md") {
    return {
      ok: false,
      error: {
        code: "invalid_prompt_file_type",
        message:
          `The system prompt file must be a Markdown (.md) file, got "${systemPromptFile}". ` +
          "Create the prompt as a Markdown file first, then call create_agent with its path.",
        system_prompt_file: systemPromptFile,
      },
    };
  }

  let stat: Awaited<ReturnType<typeof fs.stat>>;
  try {
    stat = await fs.stat(absolute);
  } catch {
    return {
      ok: false,
      error: {
        code: "prompt_file_not_found",
        message:
          `The system prompt file "${systemPromptFile}" does not exist. Create it first ` +
          "with file_write (or apply_patch), then call create_agent with its path.",
        system_prompt_file: systemPromptFile,
      },
    };
  }
  if (!stat.isFile()) {
    return {
      ok: false,
      error: {
        code: "prompt_file_not_a_file",
        message: `The system prompt path "${systemPromptFile}" is not a regular file.`,
        system_prompt_file: systemPromptFile,
      },
    };
  }

  let systemPrompt: string;
  try {
    systemPrompt = await fs.readFile(absolute, "utf8");
  } catch (error) {
    return {
      ok: false,
      error: {
        code: "prompt_file_read_failed",
        message: `Failed to read the system prompt file "${systemPromptFile}": ${
          error instanceof Error ? error.message : String(error)
        }`,
        system_prompt_file: systemPromptFile,
      },
    };
  }
  if (!systemPrompt.trim()) {
    return {
      ok: false,
      error: {
        code: "empty_system_prompt",
        message:
          `The system prompt file "${systemPromptFile}" is empty. Write the agent's system ` +
          "prompt into it first, then call create_agent.",
        system_prompt_file: systemPromptFile,
      },
    };
  }

  // Default tool allow-list: every tool the requesting turn knows about, minus the tools
  // a custom agent may never use (multi-agent collaboration) and the channel-only tools
  // (which are appended automatically on channel turns, never selectable).
  const channelOnly = new Set<string>(CHANNEL_ONLY_TOOLS);
  const seen = new Set<string>();
  const selectedTools: string[] = [];
  const available = Array.isArray(input.availableToolNames)
    ? input.availableToolNames
    : [];
  for (const raw of available) {
    if (typeof raw !== "string") continue;
    const toolName = raw.trim();
    if (!toolName || seen.has(toolName)) continue;
    if (isCustomAgentExcludedTool(toolName)) continue;
    if (channelOnly.has(toolName)) continue;
    seen.add(toolName);
    selectedTools.push(toolName);
  }

  try {
    const created = manager.create({
      name,
      description: shortDescription,
      systemPrompt,
      selectedTools,
    });
    emitCustomAgentsUpdated(manager, ctx);
    return {
      ok: true,
      data: {
        created: true,
        agent: {
          name: created.name,
          description: created.description,
          short_description: created.description,
        },
        granted_tools: selectedTools.length,
        message:
          `Created custom agent "${created.name}". It is now available via ` +
          "list_available_agents and can be removed with delete_agent.",
      },
    };
  } catch (error) {
    return customAgentsFailure(error);
  }
}

/** delete_agent — delete a custom agent by its exact name. */
function opRemoveByName(
  manager: CustomAgentManager,
  rawName: string,
  ctx: ToolContext,
): ToolResult {
  const requested = (rawName ?? "").trim();
  if (!requested) {
    return {
      ok: false,
      error: {
        code: "agent_name_required",
        message:
          "The exact custom agent name is required. Use list_available_agents to find " +
          "the exact name of the agent to delete.",
      },
    };
  }

  try {
    const all = manager.list();
    const match = all.find(
      (a) => a.name.trim().toLowerCase() === requested.toLowerCase(),
    );
    if (!match) {
      const names = all.map((a) => a.name).filter((n) => n.trim().length > 0);
      return {
        ok: false,
        error: {
          code: "agent_not_found",
          message:
            `No custom agent named "${requested}" exists. Use list_available_agents to ` +
            "find the exact name of the agent to delete." +
            (names.length > 0 ? ` Available agents: ${names.join(", ")}.` : " No custom agents exist."),
          name: requested,
          available_agents: names,
        },
      };
    }

    const removed = manager.delete(match.id);
    if (!removed) {
      return {
        ok: false,
        error: {
          code: "agent_delete_failed",
          message: `Could not delete custom agent "${match.name}".`,
          name: match.name,
        },
      };
    }
    emitCustomAgentsUpdated(manager, ctx);
    return {
      ok: true,
      data: {
        deleted: true,
        name: match.name,
        message: `Deleted custom agent "${match.name}". It is no longer available via list_available_agents.`,
      },
    };
  } catch (error) {
    return customAgentsFailure(error);
  }
}

/**
 * Publish the custom-agent list's current full state onto the turn's event stream so the
 * frontend can mirror it into the store (and persist it) before the tool result is even
 * rendered. Best-effort: a failed emit must never fail the mutation that already succeeded.
 */
function emitCustomAgentsUpdated(
  manager: CustomAgentManager,
  ctx: ToolContext,
): void {
  try {
    ctx.emit?.("custom_agents_updated", { agents: manager.list() });
  } catch {
    // The mutation succeeded and is persisted; the frontend refetches on its next boot anyway.
  }
}

/** True when a tool name must never be granted to a newly created custom agent. */
export function isExcludedForNewCustomAgent(toolName: string): boolean {
  return isCustomAgentExcludedTool(toolName);
}
