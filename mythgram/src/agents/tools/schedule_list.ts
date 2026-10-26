import { z } from "zod";
import { defineTool, type ToolContext, type ToolResult } from "./types.js";
import { requireSchedules } from "./scheduleRuntime.js";

const schema = z
  .object({
    status: z
      .enum(["active", "paused", "all"])
      .optional()
      .describe(
        "Filter schedules by status. Use active for enabled schedules, paused for paused schedules, or all for both.",
      ),
  })
  .strict();

type ScheduleListArgs = z.infer<typeof schema>;

/**
 * schedule_list — list scheduled tasks filtered by their current status. Returns each
 * schedule's id (needed by the other schedule tools) plus its name, status, cadence,
 * and next run.
 */
export const scheduleListTool = defineTool({
  name: "schedule_list",
  description: "List scheduled tasks filtered by their current status.",
  schema,
  label: () => "List schedules",
  async execute(args: ScheduleListArgs, ctx: ToolContext): Promise<ToolResult> {
    const unavailable = requireSchedules(ctx);
    if (unavailable) return unavailable;
    try {
      return ctx.schedules!.list(args.status ?? "all");
    } catch (error) {
      return {
        ok: false,
        error: {
          code: "schedule_list_failed",
          message: error instanceof Error ? error.message : String(error),
        },
      };
    }
  },
});
