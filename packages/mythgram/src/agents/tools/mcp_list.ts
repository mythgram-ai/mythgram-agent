import { z } from "zod";
import { defineTool, type ToolContext, type ToolResult } from "./types.js";
import { requireMcpManager } from "./mcpManagement.js";

const schema = z.object({}).strict();

export const listAvailableMcpServersTool = defineTool({
  name: "list_available_mcp_servers",
  description:
    "List all MCP servers currently available to the agent, including their names, descriptions, connection status.",
  schema,
  label: () => "List MCP servers",
  async execute(_args, ctx: ToolContext): Promise<ToolResult> {
    const unavailable = requireMcpManager(ctx);
    if (unavailable) return unavailable;
    const manager = ctx.mcpManager!;

    const servers = manager.list().map((s) => ({
      name: s.name,
      description: s.description,
      kind: s.kind,
      url: s.kind === "remote" ? s.url : undefined,
      auth_type: s.kind === "remote" ? s.authType === "oauth" ? "oauth" : "no_auth" : undefined,
      status: s.status,
      enabled: s.enabled,
      tool_count: s.cachedTools.length,
      disabled_tools: s.disabledTools,
    }));

    return {
      ok: true,
      data: {
        count: servers.length,
        servers,
        message:
          servers.length === 0
            ? "No MCP servers are available yet. Connect one with connect_remote_mcp or connect_local_mcp_server."
            : `${servers.length} MCP server(s) available. Use the exact \"name\" with delete_mcp_server, on_off_mcp_server, or get_mcp_server_status.`,
      },
    };
  },
});
