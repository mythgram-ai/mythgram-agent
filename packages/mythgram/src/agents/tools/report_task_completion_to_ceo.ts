import { z } from "zod";
import { defineTool, type ToolContext, type ToolResult } from "./types.js";

const schema = z.object({
  summary: z
    .string()
    .min(1, "summary is required.")
    .describe("A concise summary of the completed task and its result."),
});

/**
 * report_task_completion_to_ceo — TEAM LEADER ONLY, and ONLY inside the CEO multi-agent system. Lets
 * a team head/leader report to the CEO agent that the task the CEO assigned has been completed,
 * together with a concise summary of the work and its result. The summary is appended to the CEO's
 * EXISTING conversation via its mailbox (no new session), so the CEO keeps all of its prior context.
 * If the CEO is busy the report waits in the queue and is delivered together with any other pending
 * reports the next time the CEO is free — exactly like a member reporting up to a team leader in the
 * normal multi-agent system.
 *
 * This tool is only present (advertised + described) when the user is in the CEO multi-agent mode; in
 * the ordinary single agent / team mode the team leader never sees it or its usage instructions.
 */
export const reportTaskCompletionToCeoTool = defineTool({
  name: "report_task_completion_to_ceo",
  description:
    "Report to the CEO Agent that the assigned task has been completed. Provide a concise summary " +
    "of the completed work and its result.",
  schema,
  label: () => "Report completion to CEO",
  async execute(args, ctx: ToolContext): Promise<ToolResult> {
    const team = ctx.team;
    if (!team) {
      return {
        ok: false,
        error: {
          code: "not_in_team",
          message:
            "This tool is only available to a team head/leader operating under a CEO agent.",
        },
      };
    }
    if (!team.inCeoMode || !team.reportToCeo || !team.ceoId) {
      return {
        ok: false,
        error: {
          code: "not_in_ceo_mode",
          message:
            "This tool is only available when your team is operating under a CEO agent (CEO " +
            "multi-agent mode). There is no CEO to report to right now.",
        },
      };
    }
    if (!team.isLeader) {
      return {
        ok: false,
        error: {
          code: "leader_only",
          message:
            "Only the team head/leader reports to the CEO. As a team member, use " +
            "message_team_leader to report to your team leader — the leader then reports up to the CEO.",
        },
      };
    }

    const result = team.reportToCeo(args.summary);
    if (!result.ok) {
      return {
        ok: false,
        error: result.error ?? { code: "delivery_failed", message: result.message },
      };
    }

    return {
      ok: true,
      data: {
        from: team.selfId,
        to: team.ceoId,
        message:
          `Your completion report was sent to the CEO ("${team.ceoId}"). The CEO will review it ` +
          "when free — you can finish up or continue any remaining work.",
      },
    };
  },
});
