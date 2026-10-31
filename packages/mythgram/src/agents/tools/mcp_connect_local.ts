import { z } from "zod";
import { defineTool, type ToolContext, type ToolResult } from "./types.js";
import {
  emitMcpServersUpdated,
  findServerByName,
  requireMcpManager,
  testAndActivateServer,
} from "./mcpManagement.js";

const schema = z
  .object({
    mcp_server_name: z
      .string()
      .trim()
      .min(1, "A name for the MCP server is required.")
      .describe("A name for the MCP server."),
    mcp_server_description: z
      .string()
      .trim()
      .min(1, "A short description of the MCP server is required.")
      .describe("A short description of what the MCP server provides or is used for."),
    mcpconfig_json: z
      .unknown()
      .describe(
        "The complete MCP server configuration JSON used to connect to the local MCP server.",
      ),
  })
  .strict()
  .superRefine((val, ctx) => {
    const raw = (val as { mcpconfig_json?: unknown }).mcpconfig_json;
    if (raw === undefined || raw === null) {
      ctx.addIssue({ code: "custom", message: "The MCP configuration JSON is required.", path: ["mcpconfig_json"] });
      return;
    }
    if (typeof raw === "string") {
      if (!raw.trim()) {
        ctx.addIssue({ code: "custom", message: "The MCP configuration JSON must not be empty.", path: ["mcpconfig_json"] });
      }
      return;
    }
    if (typeof raw !== "object" || Array.isArray(raw)) {
      ctx.addIssue({
        code: "custom",
        message: "The MCP configuration JSON must be an object (e.g. { command, args, env } or { mcpServers: { ... } }).",
        path: ["mcpconfig_json"],
      });
    }
  });

type ConnectLocalArgs = {
  mcp_server_name: string;
  mcp_server_description: string;
  mcpconfig_json: unknown;
};

export const connectLocalMcpServerTool = defineTool({
  name: "connect_local_mcp_server",
  description:
    "Connect to a local MCP server using its MCP configuration JSON. Provide the server name, description, and complete MCP configuration json.",
  schema,
  label: (args: { mcp_server_name?: unknown }) => {
    const name = typeof args.mcp_server_name === "string" ? args.mcp_server_name.trim() : "";
    return name ? `Connect local MCP: ${name}` : "Connect local MCP server";
  },
  async execute(rawArgs: unknown, ctx: ToolContext): Promise<ToolResult> {
    const args = rawArgs as ConnectLocalArgs;
    const unavailable = requireMcpManager(ctx);
    if (unavailable) return unavailable;
    const manager = ctx.mcpManager!;

    const name = (args.mcp_server_name ?? "").trim().slice(0, 70);
    const description = (args.mcp_server_description ?? "").trim().slice(0, 300);
    if (!name) {
      return { ok: false, error: { code: "mcp_name_required", message: "A name for the MCP server is required." } };
    }
    const existing = findServerByName(manager, name);
    if (existing) {
      return {
        ok: false,
        error: {
          code: "mcp_name_exists",
          message: `An MCP server named "${existing.name}" already exists. Use list_available_mcp_servers to see it, or pick another name.`,
        },
      };
    }

    let created;
    try {
      created = manager.create({
        name,
        description,
        kind: "local",
        json: args.mcpconfig_json,
      });
    } catch (error) {
      return {
        ok: false,
        error: {
          code: "invalid_mcp_config",
          message:
            `Invalid local MCP configuration: ${error instanceof Error ? error.message : String(error)} ` +
            `Provide a valid MCP JSON object such as { "command": "npx", "args": ["-y", "<server-package>"] } ` +
            `or { "mcpServers": { "<name>": { "command": ... } } }.`,
        },
      };
    }

    try {
      const activated = await testAndActivateServer(manager, ctx, created.id);
      return {
        ok: true,
        data: {
          server_id: activated.id,
          server_name: activated.name,
          description: activated.description,
          kind: "local",
          status: activated.status,
          enabled: activated.enabled,
          tool_count: activated.cachedTools.length,
          tools: activated.cachedTools,
          message:
            `Connected to local MCP server "${activated.name}" (${activated.cachedTools.length} tool(s) available). ` +
            `Its native mcp_* tools are now available to you in this conversation — call them as real function calls.`,
        },
      };
    } catch (error) {
      try {
        manager.delete(created.id);
      } catch {
        // best effort
      }
      emitMcpServersUpdated(ctx, manager);
      return {
        ok: false,
        error: {
          code: "mcp_connection_failed",
          message:
            `Could not connect to local MCP server "${name}": ` +
            `${error instanceof Error ? error.message : String(error)}`,
        },
      };
    }
  },
});
