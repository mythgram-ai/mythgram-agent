import type { PromptLibraryEntry, PromptLibraryManager } from "../prompt-library.js";
import type {
  PromptLibraryEntryInfo,
  PromptLibraryRuntime,
  PromptLibrarySaveInput,
  ToolContext,
  ToolResult,
} from "./tools/types.js";

/**
 * Build the PromptLibraryRuntime for a turn that may manage the user's prompt library.
 *
 * The runtime is a thin bridge over the SAME persistent PromptLibraryManager the backend API
 * (/api/prompt-library) and the frontend's app-state sync use, so the agent, the REST API, and the
 * UI always read and write one source of truth (the SQLite `promptLibrary` app_state document).
 *
 * Every mutation emits a `prompt_library_updated` SSE event carrying the COMPLETE normalized list,
 * exactly like the knowledge/memory tools: the frontend mirrors it into its store immediately, so a
 * prompt the agent saves (or deletes) shows up in the Prompt Library page and the "/" composer
 * shortcut without a reload — and the next browser sync can never overwrite it with a stale copy.
 */
export function createPromptLibraryRuntime(manager: PromptLibraryManager): PromptLibraryRuntime {
  return {
    list: () => opList(manager),
    save: (input, ctx) => opSave(manager, input, ctx),
    remove: (promptId, ctx) => opRemove(manager, promptId, ctx),
  };
}

/** The public (list) shape of one entry — id/title/description only; never the prompt text. */
function toEntryInfo(entry: PromptLibraryEntry): PromptLibraryEntryInfo {
  return { id: entry.id, title: entry.title, description: entry.description };
}

/** Uniform structured error for an unexpected failure inside a prompt-library operation. */
export function promptLibraryFailure(error: unknown): ToolResult {
  return {
    ok: false,
    error: {
      code: "prompt_library_operation_failed",
      message: `Prompt library operation failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    },
  };
}

/** list_available_prompts_in_prompt_library. */
function opList(manager: PromptLibraryManager): ToolResult {
  try {
    const prompts = manager.list().map(toEntryInfo);
    return {
      ok: true,
      data: {
        count: prompts.length,
        prompts,
        message:
          prompts.length === 0
            ? "The prompt library is empty. Use save_prompt_in_prompt_library to add a prompt."
            : "Use delete_prompt_from_prompt_library with an exact prompt_id to remove a prompt.",
      },
    };
  } catch (error) {
    return promptLibraryFailure(error);
  }
}

/** save_prompt_in_prompt_library. */
function opSave(
  manager: PromptLibraryManager,
  input: PromptLibrarySaveInput,
  ctx: ToolContext,
): ToolResult {
  const title = (input.title ?? "").trim();
  const description = (input.description ?? "").trim();
  const prompt = input.prompt ?? "";
  if (title.length === 0) {
    return {
      ok: false,
      error: {
        code: "prompt_title_required",
        message: "A non-empty title is required to save a prompt in the prompt library.",
      },
    };
  }
  if (prompt.trim().length === 0) {
    return {
      ok: false,
      error: {
        code: "prompt_content_required",
        message: "A non-empty prompt is required to save a prompt in the prompt library.",
      },
    };
  }

  try {
    // The manager mints the entry's 20-character id + timestamps and persists it to the SAME
    // app_state document the frontend syncs; the prompt text is stored exactly as provided.
    const saved = manager.create({ title, description, content: prompt });
    emitPromptLibraryUpdated(manager, ctx);
    return {
      ok: true,
      data: {
        saved: true,
        prompt: toEntryInfo(saved),
        count: manager.list().length,
        message: `Saved "${saved.title}" to the prompt library (prompt_id: ${saved.id}).`,
      },
    };
  } catch (error) {
    return promptLibraryFailure(error);
  }
}

/** delete_prompt_from_prompt_library. */
function opRemove(manager: PromptLibraryManager, rawPromptId: string, ctx: ToolContext): ToolResult {
  const promptId = (rawPromptId ?? "").trim();
  if (promptId.length === 0) {
    return {
      ok: false,
      error: {
        code: "prompt_id_required",
        message:
          "A prompt_id is required. Use list_available_prompts_in_prompt_library to find the " +
          "exact id of the prompt to delete.",
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
            `No prompt library entry with id "${promptId}" exists. Use ` +
            "list_available_prompts_in_prompt_library to find the exact id of the prompt to delete.",
          prompt_id: promptId,
          available_prompts: available,
        },
      };
    }
    emitPromptLibraryUpdated(manager, ctx);
    return {
      ok: true,
      data: {
        deleted: true,
        prompt_id: promptId,
        count: manager.list().length,
        message: `Deleted prompt ${promptId} from the prompt library.`,
      },
    };
  } catch (error) {
    return promptLibraryFailure(error);
  }
}

/**
 * Publish the prompt library's current full state onto the turn's event stream so the frontend can
 * mirror it into the store (and persist it) before the tool result is even rendered. Best-effort:
 * a failed emit must never fail the mutation that already succeeded.
 */
function emitPromptLibraryUpdated(manager: PromptLibraryManager, ctx: ToolContext): void {
  try {
    ctx.emit?.("prompt_library_updated", { prompts: manager.list() });
  } catch {
    // The mutation succeeded and is persisted; the frontend refetches on its next boot anyway.
  }
}
