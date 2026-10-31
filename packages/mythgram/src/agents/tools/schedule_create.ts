import { z } from "zod";
import { defineTool, type ToolContext, type ToolResult } from "./types.js";
import { requireSchedules } from "./scheduleRuntime.js";

const schema = z
  .object({
    schedule_name: z
      .string()
      .trim()
      .min(1, "A schedule name is required.")
      .describe("A short human-readable name for the schedule."),
    task_prompt: z
      .string()
      .min(1, "A task prompt is required.")
      .describe("The task instructions that the agent will execute on each run."),
    cadence: z
      .enum(["one_time", "every_x", "daily", "weekly", "monthly", "custom_cron"])
      .describe("How often the task should run."),
    date: z
      .string()
      .trim()
      .optional()
      .describe("Execution date for one_time schedules. Use YYYY-MM-DD."),
    time: z
      .string()
      .trim()
      .optional()
      .describe("Execution time in HH:MM format."),
    interval: z
      .number()
      .int()
      .optional()
      .describe("The interval amount for every_x schedules."),
    interval_unit: z
      .enum(["minutes", "hours", "days"])
      .optional()
      .describe("The time unit for the every_x interval."),
    weekdays: z
      .array(z.enum(["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]))
      .optional()
      .describe("Weekdays on which a weekly schedule should run."),
    day_of_month: z
      .number()
      .int()
      .min(1)
      .max(31)
      .optional()
      .describe("Day of the month for monthly schedules."),
    cron_expression: z
      .string()
      .trim()
      .optional()
      .describe("A valid 5-field cron expression for custom_cron schedules."),
    timezone: z
      .string()
      .trim()
      .min(1, "A timezone is required.")
      .describe("IANA timezone used to interpret the schedule, such as Asia/Calcutta."),
    start_date: z
      .string()
      .trim()
      .optional()
      .describe("Optional date from which a recurring schedule becomes active. Use YYYY-MM-DD."),
    end_date: z
      .string()
      .trim()
      .optional()
      .describe("Optional date after which a recurring schedule stops. Use YYYY-MM-DD."),
  })
  .strict();

type ScheduleCreateArgs = z.infer<typeof schema>;

/**
 * schedule_create — create a background schedule that runs an agent task at the specified time
 * or recurrence. The schedule is activated by default and runs as the same agent that is active
 * in this turn (the Default Agent, or the active Custom Agent).
 */
export const scheduleCreateTool = defineTool({
  name: "schedule_create",
  description:
    "Create a background schedule that runs an agent task at the specified time or recurrence. " +
    "Choose a cadence and provide only the fields required for that cadence.",
  schema,
  label: (args: ScheduleCreateArgs) => {
    const name = typeof args.schedule_name === "string" ? args.schedule_name.trim() : "";
    return name ? `Create schedule: ${name}` : "Create schedule";
  },
  async execute(args: ScheduleCreateArgs, ctx: ToolContext): Promise<ToolResult> {
    const unavailable = requireSchedules(ctx);
    if (unavailable) return unavailable;
    try {
      return ctx.schedules!.create({
        scheduleName: args.schedule_name,
        taskPrompt: args.task_prompt,
        cadence: args.cadence,
        date: args.date,
        time: args.time,
        interval: args.interval,
        intervalUnit: args.interval_unit,
        weekdays: args.weekdays ? [...args.weekdays] : undefined,
        dayOfMonth: args.day_of_month,
        cronExpression: args.cron_expression,
        timezone: args.timezone,
        startDate: args.start_date,
        endDate: args.end_date,
      });
    } catch (error) {
      return {
        ok: false,
        error: {
          code: "schedule_create_failed",
          message: error instanceof Error ? error.message : String(error),
        },
      };
    }
  },
});
