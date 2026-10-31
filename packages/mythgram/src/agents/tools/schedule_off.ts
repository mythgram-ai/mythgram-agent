import { z } from "zod";
import { defineTool, type ToolContext, type ToolResult } from "./types.js";
import { requireSchedules } from "./scheduleRuntime.js";

const schema = z
  .object({
    schedule_id: z
      .string()
      .trim()
      .min(1, "A schedule id is required.")
      .describe("The unique ID of the schedule to turn off."),
  })
  .strict();

type ScheduleOffArgs = z.infer<typeof schema>;

/**
 * schedule_off — turn off an active schedule. It is paused (not deleted) and can be turned
 * on again later with schedule_on.
 */
export const scheduleOffTool = defineTool({
  name: "schedule_off",
  description: "Turn off an active schedule. The schedule is paused and can be turned on again later.",
  schema,
  label: (args: ScheduleOffArgs) => {
    const id = typeof args.schedule_id === "string" ? args.schedule_id.trim() : "";
    return id ? `Turn off schedule: ${id}` : "Turn off schedule";
  },
  async execute(args: ScheduleOffArgs, ctx: ToolContext): Promise<ToolResult> {
    const unavailable = requireSchedules(ctx);
    if (unavailable) return unavailable;
    try {
      return ctx.schedules!.setEnabled(args.schedule_id, false);
    } catch (error) {
      return {
        ok: false,
        error: {
          code: "schedule_off_failed",
          message: error instanceof Error ? error.message : String(error),
        },
      };
    }
  },
});
