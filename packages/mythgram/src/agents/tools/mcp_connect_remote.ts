import { z } from "zod";
import { defineTool, type ToolContext, type ToolResult } from "./types.js";
import {
  MCP_OAUTH_TIMEOUT_MS,
  attachServerToTurn,
  emitMcpOAuthRequired,
  emitMcpServersUpdated,
  findServerByName,
  requireMcpManager,
  testAndActivateServer,
  waitForMcpOAuth,
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
    url: z
      .string()
      .trim()
      .min(1, "The remote MCP server URL is required.")
      .describe("The remote MCP server URL to connect to."),
    auth_type: z
      .enum(["no_auth", "oauth"])
      .describe(
        "Authentication method for the MCP server. Use no_auth for unauthenticated servers or oauth for servers requiring OAuth authorization.",
      ),
  })
  .strict();

type ConnectRemoteArgs = z.infer<typeof schema>;

function isValidHttpUrl(raw: string): boolean {
  if (!/^https?:\/\//i.test(raw.trim())) return false;
  try {
    const u = new URL(raw.trim());
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

export const connectRemoteMcpTool = defineTool({
  name: "connect_remote_mcp",
  description:
    "Connect to a remote MCP server. Provide the server name, description, MCP server URL, and authentication method. Use no_auth for servers that require no authentication, or oauth when the server requires OAuth authorization.",
  schema,
  label: (args: ConnectRemoteArgs) => {
    const name = typeof args.mcp_server_name === "string" ? args.mcp_server_name.trim() : "";
    return name ? `Connect MCP: ${name}` : "Connect MCP server";
  },
  async execute(args: ConnectRemoteArgs, ctx: ToolContext): Promise<ToolResult> {
    const unavailable = requireMcpManager(ctx);
    if (unavailable) return unavailable;
    const manager = ctx.mcpManager!;

    const name = args.mcp_server_name.trim().slice(0, 70);
    const description = args.mcp_server_description.trim().slice(0, 300);
    const url = args.url.trim();
    if (!name) {
      return { ok: false, error: { code: "mcp_name_required", message: "A name for the MCP server is required." } };
    }
    if (!isValidHttpUrl(url)) {
      return {
        ok: false,
        error: {
          code: "invalid_mcp_url",
          message: `Invalid MCP server URL "${args.url}". Provide a valid http(s) URL (e.g. https://example-server.modelcontextprotocol.io/mcp).`,
        },
      };
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

    const authType = args.auth_type === "oauth" ? "oauth" : "none";

    let created;
    try {
      created = manager.create({
        name,
        description,
        kind: "remote",
        url,
        authType,
      });
    } catch (error) {
      return {
        ok: false,
        error: {
          code: "mcp_create_failed",
          message: error instanceof Error ? error.message : String(error),
        },
      };
    }

    // Unauthenticated servers are tested immediately; on success their native
    // mcp_* tools are attached to this very turn so the agent can call them on
    // the next model iteration without waiting for the next chat turn.
    if (authType === "none") {
      try {
        const activated = await testAndActivateServer(manager, ctx, created.id);
        return {
          ok: true,
          data: {
            server_id: activated.id,
            server_name: activated.name,
            description: activated.description,
            url: activated.url,
            auth_type: "no_auth",
            status: activated.status,
            enabled: activated.enabled,
            tool_count: activated.cachedTools.length,
            tools: activated.cachedTools,
            message:
              `Connected to remote MCP server "${activated.name}" (${activated.cachedTools.length} tool(s) available). ` +
              `Its native mcp_* tools are now available to you in this conversation — call them as real function calls.`,
          },
        };
      } catch (error) {
        try {
          manager.delete(created.id);
        } catch {
          // best effort — the failed record is harmless
        }
        emitMcpServersUpdated(ctx, manager);
        return {
          ok: false,
          error: {
            code: "mcp_connection_failed",
            message:
              `Could not connect to remote MCP server "${name}" at ${url}: ` +
              `${error instanceof Error ? error.message : String(error)}`,
          },
        };
      }
    }

    // OAuth servers cannot be tested before the user authorizes. Persist the
    // record as auth_required, surface a Connect button in the chat UI, and
    // block up to 3 minutes for the user to finish the browser flow. The
    // frontend opens the authorization URL (via POST /api/mcp/oauth/start with
    // its own origin) when the user presses Connect.
    manager.markStatus(created.id, "auth_required", {
      lastError: "Waiting for the user to complete OAuth authorization.",
    });
    emitMcpServersUpdated(ctx, manager);
    emitMcpOAuthRequired(ctx, manager.get(created.id) ?? created);
    ctx.emit?.("status", { state: "waiting", label: `Waiting for OAuth — connect "${name}"…` });

    const finished = await waitForMcpOAuth(manager, created.id, {
      timeoutMs: MCP_OAUTH_TIMEOUT_MS,
      signal: ctx.signal,
    });

    if (ctx.signal?.aborted) {
      return { ok: false, error: { code: "aborted", message: "The MCP connection was aborted." } };
    }
    if (!finished) {
      return {
        ok: true,
        data: {
          server_id: created.id,
          server_name: name,
          auth_type: "oauth",
          status: manager.get(created.id)?.status ?? "auth_required",
          oauth_pending: true,
          message:
            `The user has not completed the OAuth authorization for MCP server "${name}" within 3 minutes. ` +
            `The server is saved and shows a Connect button in the MCP page and in this tool block — ask the user to press Connect to authorize, then continue.`,
        },
      };
    }
    if (finished.status === "error") {
      return {
        ok: false,
        error: {
          code: "mcp_oauth_failed",
          message:
            `OAuth authorization failed for MCP server "${name}": ` +
            `${finished.lastError ?? "the connection failed. Ask the user to try Connect again from the MCP page or this tool block."}`,
        },
      };
    }

    const attached = await attachServerToTurn(ctx, finished.id);
    emitMcpServersUpdated(ctx, manager);
    const fresh = manager.get(finished.id) ?? finished;
    return {
      ok: true,
      data: {
        server_id: fresh.id,
        server_name: fresh.name,
        description: fresh.description,
        url: fresh.url,
        auth_type: "oauth",
        status: fresh.status,
        enabled: fresh.enabled,
        tool_count: fresh.cachedTools.length,
        tools: fresh.cachedTools,
        attached_tools: attached.tools,
        message:
          `OAuth completed — remote MCP server "${fresh.name}" is connected (${fresh.cachedTools.length} tool(s) available). ` +
          `Its native mcp_* tools are now available to you in this conversation — call them as real function calls.`,
      },
    };
  },
});
