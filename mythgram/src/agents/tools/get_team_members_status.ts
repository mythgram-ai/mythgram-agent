import { z } from "zod";
import { defineTool, type ToolContext, type ToolResult } from "./types.js";

const schema = z.object({
  agent_ids: z
    .array(z.string().min(1))
    .min(1, "Provide at least one agent id to check.")
    .describe(
      "A list of exact agent IDs whose current status should be retrieved. Multiple agents can " +
        "be checked in a single call.",
    ),
});

/**
 * get_team_members_status — LEADER ONLY. Returns the live status (idle / working / queued /
 * completed / failed) and mailbox depth of the requested team members, so the head can monitor
 * delegated work, decide whether a member is free for new work, and detect who needs attention.
 */
export const getTeamMembersStatusTool = defineTool({
  name: "get_team_members_status",
  description:
    "Get the current status of one or more agent team members. Use this tool when you need to " +
    "check whether specific agents are currently working, idle, waiting, completed, failed, or " +
    "otherwise unavailable. Provide the exact agent IDs of the agents whose status you want to " +
    "check. You can check multiple agents in a single call. Use the returned status to monitor " +
    "delegated tasks, determine whether an agent is available for new work, identify completed " +
    "work, or detect agents that require attention.",
  schema,
  label: (args) => {
    const count = Array.isArray(args.agent_ids) ? args.agent_ids.length : 0;
    return `Check status of ${count} member${count === 1 ? "" : "s"}`;
  },
  async execute(args, ctx: ToolContext): Promise<ToolResult> {
    const team = ctx.team;
    if (!team) {
      return {
        ok: false,
        error: {
          code: "not_in_team",
          message: "This tool is only available to the head of an active agent team.",
        },
      };
    }
    if (!team.isLeader) {
      return {
        ok: false,
        error: {
          code: "leader_only",
          message: "Only the team leader can check member statuses.",
        },
      };
    }

    const statuses = team.status(args.agent_ids);
    const foundIds = new Set(statuses.map((s) => s.agent_id.toLowerCase()));
    const unknown = args.agent_ids.filter((id) => !foundIds.has(id.trim().toLowerCase()));

    return {
      ok: true,
      data: {
        statuses,
        unknown,
        message:
          statuses.length > 0
            ? `Retrieved status for ${statuses.length} agent(s).`
            : "None of the requested agent ids matched a team member.",
      },
    };
  },
});
