import { z } from "zod";
import { defineTool, type ToolContext, type ToolResult } from "./types.js";

const taskSchema = z.object({
  team_leader: z
    .string()
    .min(1, "team_leader is required.")
    .describe("The name or ID of the Team Leader or Head responsible for the team."),
  prompt: z
    .string()
    .min(1, "prompt is required.")
    .describe("The prompt or instructions to assign to the team."),
});

const schema = z.object({
  tasks: z
    .array(taskSchema)
    .min(1, "Provide at least one task to assign to a team.")
    .describe("A list of prompts to assign to teams."),
});

/**
 * assign_tasks_to_teams — CEO ONLY. Lets the CEO agent assign task prompts to one or more team
 * head/leaders in a single call. Each task is delivered to the target team leader's EXISTING
 * conversation (via its mailbox) — no new session is created, so a leader the CEO re-activates keeps
 * all of its prior context. Independent teams can be assigned tasks simultaneously for parallel work;
 * the leaders then break the work down for their own members and report back to the CEO with
 * report_task_completion_to_ceo. Each prompt is automatically framed so the leader knows the task
 * comes from the CEO and must report completion back once its team is done.
 */
export const assignTasksToTeamsTool = defineTool({
  name: "assign_tasks_to_teams",
  description:
    "Assign tasks to multiple teams in a single operation. Each task is assigned to a specific " +
    "team leader or head responsible for that team. Provide a clear, complete, self-contained " +
    "prompt for each team containing the objective, relevant context, requirements, constraints, " +
    "and expected result. Select the most appropriate team(s) based on the work required — you can " +
    "assign independent tasks to multiple teams at once for parallel execution. Each team leader " +
    "breaks the task down for their members and reports completion back to you when finished. Always " +
    "use the exact team leader name/ID (use list_teams to discover the available teams and leaders).",
  schema,
  label: (args) => {
    const count = Array.isArray(args.tasks) ? args.tasks.length : 0;
    const names = Array.isArray(args.tasks)
      ? args.tasks.map((t) => t.team_leader).filter(Boolean).slice(0, 3).join(", ")
      : "";
    return `Assign to ${count} team${count === 1 ? "" : "s"}${names ? `: ${names}` : ""}`;
  },
  async execute(args, ctx: ToolContext): Promise<ToolResult> {
    const ceo = ctx.ceo;
    if (!ceo) {
      return {
        ok: false,
        error: {
          code: "not_ceo",
          message:
            "This tool is only available to the CEO agent of an active CEO multi-agent system.",
        },
      };
    }

    const result = ceo.assignTasks(
      args.tasks.map((t) => ({ team_leader: t.team_leader, prompt: t.prompt })),
    );

    if (!result.ok) {
      return {
        ok: false,
        error: result.error ?? { code: "delivery_failed", message: result.message },
      };
    }

    return {
      ok: true,
      data: {
        delivered: result.delivered,
        unknown: result.unknown,
        message:
          result.message +
          " Each team leader will break the task down for their members, get it done, and report " +
          "back to you with report_task_completion_to_ceo. You can keep coordinating other teams or " +
          "wait for their reports — continue.",
      },
    };
  },
});
