import fs from "node:fs/promises";
import type { MainAgentPromptManager } from "./mainagentprompt/index.js";
import { isCustomSystemPromptId } from "../database/ids.js";
import { safeResolve } from "../utils/paths.js";
import type {
  CustomSystemPromptEntryInfo,
  CustomSystemPromptSaveInput,
  CustomSystemPromptsRuntime,
  ToolContext,
  ToolResult,
} from "./tools/types.js";
import type { MainAgentPromptConfig } from "./mainagentprompt/index.js";

/**
 * Build the CustomSystemPromptsRuntime for a turn that may manage the user's
 * custom system prompts.
 *
 * The runtime is a thin bridge over the SAME persistent MainAgentPromptManager the
 * Custom system prompts panel reads (the SQLite `mainAgentPrompts` app_state document
 * the frontend syncs to), so a prompt the agent saves (or deletes) shows up in the
 * panel immediately — and the next browser sync can never overwrite it with a stale copy.
 *
 * Every mutation emits a `main_agent_prompts_updated` SSE event carrying the COMPLETE
 * normalized list, exactly like the prompt-library tools: the frontend mirrors it into
 * its store immediately, so the panel converges without a reload.
 */
export function createCustomSystemPromptsRuntime(
  manager: MainAgentPromptManager,
): CustomSystemPromptsRuntime {
  return {
    list: () => opList(manager),
    save: (input, ctx) => opSave(manager, input, ctx),
    remove: (promptId, ctx) => opRemove(manager, promptId, ctx),
  };
}

/** The public (list) shape of one entry — name/description/id only; never the prompt text. */
function toEntryInfo(entry: MainAgentPromptConfig): CustomSystemPromptEntryInfo {
  return { id: entry.id, name: entry.name, description: entry.description };
}

/** Uniform structured error for an unexpected failure inside an operation. */
export function customSystemPromptsFailure(error: unknown): ToolResult {
  return {
    ok: false,
    error: {
      code: "custom_system_prompt_operation_failed",
      message: `Custom system prompt operation failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    },
  };
}

/** list_available_custom_system_prompt. */
function opList(manager: MainAgentPromptManager): ToolResult {
  try {
    const prompts = manager.list().map(toEntryInfo);
    return {
      ok: true,
      data: {
        count: prompts.length,
        prompts,
        message:
          prompts.length === 0
            ? "No custom system prompts are saved yet. Use save_custom_system_prompt to save one from a file."
            : "Use delete_custom_system_prompt with an exact 20-digit id to remove a prompt.",
      },
    };
  } catch (error) {
    return customSystemPromptsFailure(error);
  }
}

/** Max file bytes accepted for a system-prompt source file (guards memory on huge files). */
const MAX_PROMPT_FILE_BYTES = 5 * 1024 * 1024;

/** save_custom_system_prompt — read a workspace file and store its contents as a prompt. */
async function opSave(
  manager: MainAgentPromptManager,
  input: CustomSystemPromptSaveInput,
  ctx: ToolContext,
): Promise<ToolResult> {
  const name = (input.name ?? "").trim();
  const description = (input.description ?? "").trim();
  const filePath = (input.filePath ?? "").trim();

  if (!name) {
    return {
      ok: false,
      error: {
        code: "prompt_name_required",
        message: "A non-empty name is required to save a custom system prompt.",
      },
    };
  }
  if (!description) {
    return {
      ok: false,
      error: {
        code: "prompt_description_required",
        message: "A non-empty description is required to save a custom system prompt.",
      },
    };
  }
  if (!filePath) {
    return {
      ok: false,
      error: {
        code: "prompt_file_path_required",
        message:
          "A non-empty file_path is required. First create the file with file_write, then pass its absolute path here.",
      },
    };
  }

  // Duplicate guard (case-insensitive exact): the panel treats the name as the
  // human identity of a prompt, so two prompts sharing a name would be ambiguous.
  try {
    const clash = manager.list().find((p) => p.name.trim().toLowerCase() === name.toLowerCase());
    if (clash) {
      return {
        ok: false,
        error: {
          code: "prompt_name_exists",
          message:
            `A custom system prompt named "${clash.name}" already exists. Use a different name, ` +
            "or delete the existing prompt first with delete_custom_system_prompt.",
          name: clash.name,
        },
      };
    }
  } catch (error) {
    return customSystemPromptsFailure(error);
  }

  let absolute: string;
  try {
    absolute = safeResolve(ctx.workspaceRoot, filePath);
  } catch (error) {
    return {
      ok: false,
      error: {
        code: "invalid_prompt_file_path",
        message: error instanceof Error ? error.message : String(error),
        file_path: filePath,
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
          `The system prompt file "${filePath}" does not exist. Create it first with file_write, then call save_custom_system_prompt with its path.`,
        file_path: filePath,
      },
    };
  }
  if (!stat.isFile()) {
    return {
      ok: false,
      error: {
        code: "prompt_file_not_a_file",
        message: `The system prompt path "${filePath}" is not a regular file.`,
        file_path: filePath,
      },
    };
  }
  if (stat.size > MAX_PROMPT_FILE_BYTES) {
    return {
      ok: false,
      error: {
        code: "prompt_file_too_large",
        message: `The system prompt file "${filePath}" is too large (${stat.size} bytes, max ${MAX_PROMPT_FILE_BYTES} bytes).`,
        file_path: filePath,
      },
    };
  }
  if (stat.size === 0) {
    return {
      ok: false,
      error: {
        code: "empty_system_prompt",
        message: `The system prompt file "${filePath}" is empty. Write the complete system prompt into it first, then call save_custom_system_prompt.`,
        file_path: filePath,
      },
    };
  }

  let content: string;
  try {
    content = await fs.readFile(absolute, "utf8");
  } catch (error) {
    return {
      ok: false,
      error: {
        code: "prompt_file_read_failed",
        message: `Failed to read the system prompt file "${filePath}": ${
          error instanceof Error ? error.message : String(error)
        }`,
        file_path: filePath,
      },
    };
  }
  if (!content.trim()) {
    return {
      ok: false,
      error: {
        code: "empty_system_prompt",
        message: `The system prompt file "${filePath}" is empty. Write the complete system prompt into it first, then call save_custom_system_prompt.`,
        file_path: filePath,
      },
    };
  }

  try {
    const saved = manager.create({ name, description, content });
    emitMainAgentPromptsUpdated(manager, ctx);
    return {
      ok: true,
      data: {
        saved: true,
        prompt: toEntryInfo(saved),
        count: manager.list().length,
        message: `Saved "${saved.name}" as a custom system prompt (id: ${saved.id}). It is now visible in the Custom system prompts panel.`,
      },
    };
  } catch (error) {
    return customSystemPromptsFailure(error);
  }
}

/** delete_custom_system_prompt — delete by exact 20-digit id. */
function opRemove(
  manager: MainAgentPromptManager,
  rawPromptId: string,
  ctx: ToolContext,
): ToolResult {
  const promptId = (rawPromptId ?? "").trim();
  if (!promptId) {
    return {
      ok: false,
      error: {
        code: "prompt_id_required",
        message:
          "An id is required. Use list_available_custom_system_prompt to find the exact 20-digit id of the prompt to delete.",
      },
    };
  }
  if (!isCustomSystemPromptId(promptId)) {
    return {
      ok: false,
      error: {
        code: "prompt_id_invalid",
        message: `The id "${promptId}" is not a valid 20-digit custom system prompt id. Use list_available_custom_system_prompt to find the exact id.`,
        prompt_id: promptId,
      },
    };
  }

  try {
    const removed = manager.delete(promptId);
    if (!removed) {
      const available = manager.list().map(toEntryInfo);
      return {
        ok: false,
        error: {
          code: "prompt_not_found",
          message:
            `No custom system prompt with id "${promptId}" exists. Use ` +
            "list_available_custom_system_prompt to find the exact id of the prompt to delete. Do not invent or modify ids.",
          prompt_id: promptId,
          available_prompts: available,
        },
      };
    }
    emitMainAgentPromptsUpdated(manager, ctx);
    return {
      ok: true,
      data: {
        deleted: true,
        prompt_id: promptId,
        count: manager.list().length,
        message: `Deleted custom system prompt ${promptId}.`,
      },
    };
  } catch (error) {
    return customSystemPromptsFailure(error);
  }
}

/**
 * Publish the current full prompt list onto the turn's event stream so the frontend's
 * Custom system prompts panel mirrors it immediately (before the tool result is even
 * rendered). Best-effort: a failed emit must never fail the mutation that already succeeded.
 */
function emitMainAgentPromptsUpdated(
  manager: MainAgentPromptManager,
  ctx: ToolContext,
): void {
  try {
    ctx.emit?.("main_agent_prompts_updated", { prompts: manager.list() });
  } catch {
    // The mutation succeeded and is persisted; the frontend refetches on its next boot anyway.
  }
}
