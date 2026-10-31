import { z } from "zod";
import { defineTool, type ToolContext, type ToolResult } from "./types.js";
import { requireSchedules } from "./scheduleRuntime.js";

const schema = z
  .object({
    schedule_id: z
      .string()
      .trim()
      .min(1, "A schedule id is required.")
      .describe("The ID of the schedule to delete."),
  })
  .strict();

type ScheduleDeleteArgs = z.infer<typeof schema>;

/**
 * schedule_delete — permanently delete a scheduled task and prevent future executions.
 */
export const scheduleDeleteTool = defineTool({
  name: "schedule_delete",
  description: "Permanently delete a scheduled task and prevent future executions.",
  schema,
  label: (args: ScheduleDeleteArgs) => {
    const id = typeof args.schedule_id === "string" ? args.schedule_id.trim() : "";
    return id ? `Delete schedule: ${id}` : "Delete schedule";
  },
  async execute(args: ScheduleDeleteArgs, ctx: ToolContext): Promise<ToolResult> {
    const unavailable = requireSchedules(ctx);
    if (unavailable) return unavailable;
    try {
      return ctx.schedules!.remove(args.schedule_id);
    } catch (error) {
      return {
        ok: false,
        error: {
          code: "schedule_delete_failed",
          message: error instanceof Error ? error.message : String(error),
        },
      };
    }
  },
});
