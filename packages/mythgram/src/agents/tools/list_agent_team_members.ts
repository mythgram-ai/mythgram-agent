import { z } from "zod";
import { defineTool, type ToolContext, type ToolResult } from "./types.js";

const schema = z.object({}).describe("No parameters.");

/**
 * list_agent_team_members — LEADER + MEMBERS. Returns the team roster (each agent's id, role, and
 * description) so any agent knows who is on the team and can coordinate correctly. Descriptions
 * only — no system prompts are exposed.
 */
export const listAgentTeamMembersTool = defineTool({
  name: "list_agent_team_members",
  description: "Get a list of all agent team members available to the current agent.",
  schema,
  label: () => "List team members",
  async execute(_args, ctx: ToolContext): Promise<ToolResult> {
    const team = ctx.team;
    if (!team) {
      return {
        ok: false,
        error: {
          code: "not_in_team",
          message: "This tool is only available to agents inside an active agent team.",
        },
      };
    }

    const members = team.listMembers();
    return {
      ok: true,
      data: {
        self: team.selfId,
        leader: team.leaderId,
        count: members.length,
        members,
        message: `The team has ${members.length} member(s) (including the leader).`,
      },
    };
  },
});
