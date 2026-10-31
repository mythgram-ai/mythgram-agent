import { z } from "zod";
import { defineTool, type ToolContext, type ToolResult } from "./types.js";
import { findServerByName, requireMcpManager } from "./mcpManagement.js";

const schema = z
  .object({
    mcp_server_name: z
      .string()
      .trim()
      .min(1, "The exact name of the MCP server is required.")
      .describe(
        "The exact name of the MCP server whose status you want to check. Get the server name using list_available_mcp_servers.",
      ),
  })
  .strict();

type McpStatusArgs = z.infer<typeof schema>;

export const getMcpServerStatusTool = defineTool({
  name: "get_mcp_server_status",
  description:
    "Get the current status of an MCP server. To identify the correct MCP server name, first use the list_available_mcp_servers tool, then provide the exact server name.",
  schema,
  label: (args: McpStatusArgs) => {
    const name = typeof args.mcp_server_name === "string" ? args.mcp_server_name.trim() : "";
    return name ? `MCP status: ${name}` : "Get MCP status";
  },
  async execute(args: McpStatusArgs, ctx: ToolContext): Promise<ToolResult> {
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

    return {
      ok: true,
      data: {
        server_name: server.name,
        description: server.description,
        kind: server.kind,
        url: server.kind === "remote" ? server.url : undefined,
        auth_type: server.kind === "remote" ? (server.authType === "oauth" ? "oauth" : "no_auth") : undefined,
        status: server.status,
        enabled: server.enabled,
        tool_count: server.cachedTools.length,
        tools: server.cachedTools,
        disabled_tools: server.disabledTools,
        last_error: server.lastError ?? null,
        message: `MCP server "${server.name}" is ${server.enabled ? "enabled" : "disabled"} with connection status "${server.status}".`,
      },
    };
  },
});
