import { z } from "zod";
import { defineTool, type ToolContext, type ToolResult } from "./types.js";

const schema = z.object({}).describe("No parameters.");

/**
 * list_teams — CEO ONLY. Returns every agent team the CEO controls (the teams the user selected when
 * creating the CEO), each with its team name, its head/leader id, and its specialist members (name +
 * description only — no system prompts are exposed). The CEO uses this to pick the right team(s) and
 * to know exactly which team_leader id to pass to assign_tasks_to_teams.
 */
export const listTeamsTool = defineTool({
  name: "list_teams",
  description: "List all existing agent teams.",
  schema,
  label: () => "List teams",
  async execute(_args, ctx: ToolContext): Promise<ToolResult> {
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

    const teams = ceo.listTeams().map((team) => ({
      team_name: team.team_name,
      team_leader: team.team_leader,
      members: team.members.map((m) => ({ name: m.name, description: m.description })),
    }));

    return {
      ok: true,
      data: {
        count: teams.length,
        teams,
        message:
          teams.length > 0
            ? `You control ${teams.length} team(s). Assign work to a team by passing its team_leader ` +
              "to assign_tasks_to_teams."
            : "You do not control any teams yet.",
      },
    };
  },
});
