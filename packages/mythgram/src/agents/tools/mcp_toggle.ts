import { z } from "zod";
import { defineTool, type ToolContext, type ToolResult } from "./types.js";
import {
  attachServerToTurn,
  detachServerFromTurn,
  emitMcpServersUpdated,
  findServerByName,
  requireMcpManager,
} from "./mcpManagement.js";

const schema = z
  .object({
    mcp_server_name: z
      .string()
      .trim()
      .min(1, "The exact name of the MCP server is required.")
      .describe(
        "The exact name of the MCP server to enable or disable. Get the server name using list_available_mcp_servers before calling this tool.",
      ),
    status: z
      .enum(["on", "off"])
      .describe("Set the MCP server status. Use on to enable the server or off to disable it."),
  })
  .strict();

type ToggleMcpArgs = z.infer<typeof schema>;

export const toggleMcpServerTool = defineTool({
  name: "on_off_mcp_server",
  description:
    "Enable or disable a connected MCP server. To identify the correct MCP server name, first use the list_available_mcp_servers tool. Then provide the exact MCP server name and select on or off.",
  schema,
  label: (args: ToggleMcpArgs) => {
    const name = typeof args.mcp_server_name === "string" ? args.mcp_server_name.trim() : "";
    return name ? `${args.status === "on" ? "Enable" : "Disable"} MCP: ${name}` : "Toggle MCP server";
  },
  async execute(args: ToggleMcpArgs, ctx: ToolContext): Promise<ToolResult> {
    const unavailable = requireMcpManager(ctx);
    if (unavailable) return unavailable;
    const manager = ctx.mcpManager!;

    const server = findServerByName(manager, args.mcp_server_name);
    if (!server) {
      return {
        ok: false,
        error: {
          code: "mcp_not_found",
          message: `No MCP server named "${args.mcp_server_name}" exists. Call list_available_mcp_servers to see the exact available names.`,
        },
      };
    }

    const enabled = args.status === "on";
    if (server.enabled === enabled) {
      return {
        ok: true,
        data: {
          server_name: server.name,
          status: args.status,
          enabled,
          message: `MCP server "${server.name}" is already ${enabled ? "enabled" : "disabled"}.`,
        },
      };
    }

    const updated = manager.update(server.id, { enabled });
    if (!updated) {
      return {
        ok: false,
        error: { code: "mcp_update_failed", message: `Could not update MCP server "${server.name}".` },
      };
    }

    if (enabled) {
      // Re-enabling immediately re-attaches the catalog so the agent can use it
      // on the very next model iteration.
      const attached = await attachServerToTurn(ctx, server.id);
      emitMcpServersUpdated(ctx, manager);
      const fresh = manager.get(server.id) ?? updated;
      return {
        ok: true,
        data: {
          server_name: fresh.name,
          status: "on",
          enabled: true,
          connection_status: fresh.status,
          attached_tools: attached.tools,
          message:
            attached.attached > 0
              ? `MCP server "${fresh.name}" is now enabled (${attached.attached} tool(s) immediately available to you).`
              : `MCP server "${fresh.name}" is now enabled. Its tools will be available to you immediately.`,
        },
      };
    }

    detachServerFromTurn(ctx, server.id);
    try {
      await manager.dropConnection(server.id);
    } catch {
      // best effort — disabling never fails on connection teardown
    }
    emitMcpServersUpdated(ctx, manager);
    return {
      ok: true,
      data: {
        server_name: updated.name,
        status: "off",
        enabled: false,
        message: `MCP server "${updated.name}" is now disabled. Its tools are immediately unavailable to you.`,
      },
    };
  },
});
