import { z } from "zod";
import { defineTool, type ToolContext, type ToolResult } from "./types.js";
import {
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
      .min(1, "The exact name of the MCP server to delete is required.")
      .describe(
        "The exact name of the MCP server to delete. Get the server name using list_available_mcp_servers before calling this tool.",
      ),
  })
  .strict();

type DeleteMcpArgs = z.infer<typeof schema>;

export const deleteMcpServerTool = defineTool({
  name: "delete_mcp_server",
  description:
    "Delete MCP server. To identify the correct MCP server name, first use the list_available_mcp_servers tool. Then provide the exact MCP server name returned by that tool.",
  schema,
  label: (args: DeleteMcpArgs) => {
    const name = typeof args.mcp_server_name === "string" ? args.mcp_server_name.trim() : "";
    return name ? `Delete MCP: ${name}` : "Delete MCP server";
  },
  async execute(args: DeleteMcpArgs, ctx: ToolContext): Promise<ToolResult> {
    const unavailable = requireMcpManager(ctx);
    if (unavailable) return unavailable;
    const manager = ctx.mcpManager!;

    const server = findServerByName(manager, args.mcp_server_name);
    if (!server) {
      const available = manager
        .list()
        .slice(0, 20)
        .map((s) => s.name);
      return {
        ok: false,
        error: {
          code: "mcp_not_found",
          message:
            `No MCP server named "${args.mcp_server_name}" exists. Call list_available_mcp_servers to see the exact available names, then retry with one of them.` +
            (available.length > 0 ? ` Available: ${available.join(", ")}.` : ""),
        },
      };
    }

    detachServerFromTurn(ctx, server.id);
    const removed = manager.delete(server.id);
    emitMcpServersUpdated(ctx, manager);
    if (!removed) {
      return {
        ok: false,
        error: { code: "mcp_delete_failed", message: `Could not delete MCP server "${server.name}".` },
      };
    }
    return {
      ok: true,
      data: {
        server_name: server.name,
        deleted: true,
        message: `MCP server "${server.name}" deleted permanently. Its tools are no longer available to you.`,
      },
    };
  },
});
