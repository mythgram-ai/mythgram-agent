import type { CustomTaskMode } from "@/types";

/**
 * Task modes for the prompt box.
 *
 * - `default`: works normally (nothing appended).
 * - `plan`: the model plans the user's task first, then starts working. The
 *   plan prompt below is appended to the user's message; users can edit it on
 *   the Task Modes page.
 * - custom: user-created modes (name + appended prompt), each appended verbatim
 *   when active. Users can create as many as they want.
 *
 * Configs persist in the backend SQLite database via the shared app-state sync
 * (`taskModes` + `activeTaskModeId` + `planModePrompt`).
 */

/** Sentinel ids for the two built-in modes. */
export const DEFAULT_TASK_MODE_ID = "default";
export const PLAN_TASK_MODE_ID = "plan";

/**
 * Comprehensive default prompt for plan mode: asks the model to plan the task
 * first (goal, approach, concrete steps, files, risks, verification) and only
 * then start working through the plan step by step.
 */
export const DEFAULT_PLAN_MODE_PROMPT =
  "Before doing any work, first create a clear, step-by-step implementation plan for this task: " +
  "restate the goal and what done looks like, lay out the approach, list the concrete steps in order " +
  "(including which files you will read, change, or create), flag risks or unknowns, and say how you " +
  "will verify each step. Then start working through the plan from step one, verifying as you go.";

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** Defensive normalize of one stored/loaded task mode, or null when unusable. */
export function normalizeTaskMode(raw: unknown): CustomTaskMode | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = typeof r.id === "string" ? r.id : "";
  const name = str(r.name).trim();
  if (!id || !name) return null;
  return {
    id,
    name,
    prompt: str(r.prompt),
    createdAt: typeof r.createdAt === "number" ? r.createdAt : Date.now(),
    updatedAt: typeof r.updatedAt === "number" ? r.updatedAt : Date.now(),
  };
}

/** Normalize a persisted array of task modes, dropping malformed entries and duplicate ids. */
export function normalizeTaskModes(raw: unknown): CustomTaskMode[] {
  if (!Array.isArray(raw)) return [];
  const out: CustomTaskMode[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const mode = normalizeTaskMode(item);
    if (!mode || seen.has(mode.id)) continue;
    seen.add(mode.id);
    out.push(mode);
  }
  return out;
}

/** Normalize the stored plan-mode prompt (falls back to the built-in default). */
export function normalizePlanModePrompt(raw: unknown): string {
  const text = str(raw);
  return text.trim().length > 0 ? text : DEFAULT_PLAN_MODE_PROMPT;
}

/** A blank task-mode scaffold for the create form. */
export function blankTaskMode(): Omit<CustomTaskMode, "id" | "createdAt" | "updatedAt"> {
  return { name: "", prompt: "" };
}

/**
 * Resolve the prompt text to append for the active mode: null for default mode
 * (nothing appended), the plan prompt for plan mode, or the custom mode's
 * prompt when a custom mode is active. Returns null when the custom id is
 * unknown or its prompt is empty.
 */
export function taskModePromptFor(
  activeId: string | null,
  modes: CustomTaskMode[],
  planPrompt: string,
): string | null {
  if (!activeId || activeId === DEFAULT_TASK_MODE_ID) return null;
  if (activeId === PLAN_TASK_MODE_ID) {
    const text = planPrompt.trim();
    return text.length > 0 ? planPrompt : DEFAULT_PLAN_MODE_PROMPT;
  }
  const mode = modes.find((m) => m.id === activeId);
  const text = (mode?.prompt ?? "").trim();
  return text.length > 0 ? (mode as CustomTaskMode).prompt : null;
}
