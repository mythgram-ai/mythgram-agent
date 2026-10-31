import { z } from "zod";
import { defineTool, type ToolContext, type ToolResult } from "./types.js";
import { requireSchedules } from "./scheduleRuntime.js";

const schema = z
  .object({
    schedule_id: z
      .string()
      .trim()
      .min(1, "A schedule id is required.")
      .describe("The unique ID of the schedule to update."),
    prompt: z
      .string()
      .min(1, "A prompt is required.")
      .describe("The new task prompt that the agent should execute when the schedule runs."),
  })
  .strict();

type ScheduleUpdateArgs = z.infer<typeof schema>;

/**
 * schedule_update — update the task prompt of an existing schedule. Only the prompt changes:
 * the schedule timing, cadence, timezone, and other settings are preserved, so the next run
 * is unaffected.
 */
export const scheduleUpdateTool = defineTool({
  name: "schedule_update",
  description:
    "Update the task prompt of an existing schedule. The schedule timing, cadence, timezone, " +
    "and other settings cannot be changed, only user can update them.",
  schema,
  label: (args: ScheduleUpdateArgs) => {
    const id = typeof args.schedule_id === "string" ? args.schedule_id.trim() : "";
    return id ? `Update schedule: ${id}` : "Update schedule";
  },
  async execute(args: ScheduleUpdateArgs, ctx: ToolContext): Promise<ToolResult> {
    const unavailable = requireSchedules(ctx);
    if (unavailable) return unavailable;
    try {
      return ctx.schedules!.updatePrompt(args.schedule_id, args.prompt);
    } catch (error) {
      return {
        ok: false,
        error: {
          code: "schedule_update_failed",
          message: error instanceof Error ? error.message : String(error),
        },
      };
    }
  },
});
