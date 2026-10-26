import { z } from "zod";
import { defineTool, type ToolContext, type ToolResult } from "./types.js";
import { requireSchedules } from "./scheduleRuntime.js";

const schema = z
  .object({
    schedule_id: z
      .string()
      .trim()
      .min(1, "A schedule id is required.")
      .describe("The ID of the schedule to execute now."),
  })
  .strict();

type ScheduleRunNowArgs = z.infer<typeof schema>;

/**
 * schedule_run_now — immediately start executing a scheduled task without waiting for its next
 * scheduled time. Fire-and-forget: returns right away with the run id while the run continues
 * in the background — never wait for it to finish; check the schedule's execution history
 * later for the outcome.
 */
export const scheduleRunNowTool = defineTool({
  name: "schedule_run_now",
  description:
    "Immediately start executing a scheduled task without waiting for its next scheduled time. " +
    "Returns right away while the run continues in the background — do not wait for it to finish.",
  schema,
  label: (args: ScheduleRunNowArgs) => {
    const id = typeof args.schedule_id === "string" ? args.schedule_id.trim() : "";
    return id ? `Run schedule now: ${id}` : "Run schedule now";
  },
  async execute(args: ScheduleRunNowArgs, ctx: ToolContext): Promise<ToolResult> {
    const unavailable = requireSchedules(ctx);
    if (unavailable) return unavailable;
    try {
      return await ctx.schedules!.runNow(args.schedule_id);
    } catch (error) {
      return {
        ok: false,
        error: {
          code: "schedule_run_now_failed",
          message: error instanceof Error ? error.message : String(error),
        },
      };
    }
  },
});
