import { z } from "zod";
import { defineTool, type ToolContext, type ToolResult } from "./types.js";
import { requireSchedules } from "./scheduleRuntime.js";

const schema = z
  .object({
    schedule_id: z
      .string()
      .trim()
      .min(1, "A schedule id is required.")
      .describe("The unique ID of the schedule to turn on."),
  })
  .strict();

type ScheduleOnArgs = z.infer<typeof schema>;

/**
 * schedule_on — turn on a paused schedule so it runs again according to its existing timing.
 */
export const scheduleOnTool = defineTool({
  name: "schedule_on",
  description: "Turn on a paused schedule so it can run according to its existing schedule.",
  schema,
  label: (args: ScheduleOnArgs) => {
    const id = typeof args.schedule_id === "string" ? args.schedule_id.trim() : "";
    return id ? `Turn on schedule: ${id}` : "Turn on schedule";
  },
  async execute(args: ScheduleOnArgs, ctx: ToolContext): Promise<ToolResult> {
    const unavailable = requireSchedules(ctx);
    if (unavailable) return unavailable;
    try {
      return ctx.schedules!.setEnabled(args.schedule_id, true);
    } catch (error) {
      return {
        ok: false,
        error: {
          code: "schedule_on_failed",
          message: error instanceof Error ? error.message : String(error),
        },
      };
    }
  },
});
