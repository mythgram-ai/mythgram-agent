import { z } from "zod";
import { defineTool, type ToolContext, type ToolResult } from "./types.js";
import { resolveDefaultSubAgents } from "../sub-agents/index.js";

/** Error message returned when the model tries to delete a built-in (default) sub-agent. */
export const DELETE_DEFAULT_SUB_AGENT_ERROR = "can't delete default sub-agents";

const schema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "A sub-agent name is required.")
    .describe("The exact name of the sub-agent to delete."),
});

export const deleteSubAgentTool = defineTool({
  name: "delete_sub_agent",
  description:
    "Delete an existing sub-agent by its exact name. The provided name must match the registered " +
    "sub-agent name exactly. Built-in default sub-agents cannot be deleted. The sub-agent is " +
    "removed from the user's saved sub-agents so it is no longer available to list_sub_agents / " +
    "call_sub_agent in this and future sessions.",
  schema,
  label: (args) => `Delete Sub-Agent: ${args.name}`,
  async execute(args, ctx: ToolContext): Promise<ToolResult> {
    const runtime = ctx.subAgents;
    if (!runtime) {
      return {
        ok: false,
        error: {
          code: "registry_unavailable",
          message:
            "The sub-agent runtime is not available in this context. delete_sub_agent can only be " +
            "used by the main agent.",
        },
      };
    }

    const requested = args.name.trim();
    const requestedKey = requested.toLowerCase();

    // Built-in default sub-agents are shipped with the agent and can never be removed.
    const defaults = await resolveDefaultSubAgents();
    const isDefault = defaults.some((def) => def.name.trim().toLowerCase() === requestedKey);
    if (isDefault) {
      return {
        ok: false,
        error: {
          code: "cannot_delete_default_sub_agent",
          message: DELETE_DEFAULT_SUB_AGENT_ERROR,
        },
      };
    }

    // The name must match an existing (user-defined) sub-agent exactly.
    const match = runtime.definitions.find(
      (def) => def.name.trim().toLowerCase() === requestedKey,
    );
    if (!match) {
      const names = runtime.definitions
        .map((def) => def.name.trim())
        .filter((name) => name.length > 0);
      return {
        ok: false,
        error: {
          code: "unknown_sub_agent",
          message:
            `No sub-agent named "${requested}" exists. ` +
            (names.length > 0
              ? `Registered sub-agents: ${names.join(", ")}.`
              : "There are no sub-agents to delete."),
        },
      };
    }

    // The frontend removes the sub-agent from the user's saved sub-agents (its database) when it
    // sees this result, mirroring how create_sub_agent persists a newly created sub-agent.
    return {
      ok: true,
      data: {
        deleted_sub_agent: match.name,
        message:
          `Deleted sub-agent "${match.name}". It has been removed from the user's saved sub-agents ` +
          "and is no longer available to list_sub_agents or call_sub_agent.",
      },
    };
  },
});
