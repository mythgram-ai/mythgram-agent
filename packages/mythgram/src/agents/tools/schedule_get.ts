import { z } from "zod";
import { defineTool, type ToolContext, type ToolResult } from "./types.js";
import { requireSchedules } from "./scheduleRuntime.js";

const schema = z
  .object({
    schedule_id: z
      .string()
      .trim()
      .min(1, "A schedule id is required.")
      .describe("The ID of the schedule to inspect."),
  })
  .strict();

type ScheduleGetArgs = z.infer<typeof schema>;

/**
 * schedule_get — get the complete details of a specific scheduled task, including its
 * next run and full configuration.
 */
export const scheduleGetTool = defineTool({
  name: "schedule_get",
  description: "Get the complete details of a specific scheduled task.",
  schema,
  label: (args: ScheduleGetArgs) => {
    const id = typeof args.schedule_id === "string" ? args.schedule_id.trim() : "";
    return id ? `Get schedule: ${id}` : "Get schedule";
  },
  async execute(args: ScheduleGetArgs, ctx: ToolContext): Promise<ToolResult> {
    const unavailable = requireSchedules(ctx);
    if (unavailable) return unavailable;
    try {
      return ctx.schedules!.get(args.schedule_id);
    } catch (error) {
      return {
        ok: false,
        error: {
          code: "schedule_get_failed",
          message: error instanceof Error ? error.message : String(error),
        },
      };
    }
  },
});
