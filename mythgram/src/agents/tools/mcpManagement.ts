import type { McpManager } from "../mcp/manager.js";
import type { McpServerConfig } from "../mcp/configuration.js";
import { toPublicServer } from "../mcp/configuration.js";
import type { ToolContext, ToolResult } from "./types.js";

/** The six agent-driven MCP management tool names (single source of truth). */
export const MCP_MANAGEMENT_TOOL_NAMES: readonly string[] = [
  "connect_remote_mcp",
  "connect_local_mcp_server",
  "list_available_mcp_servers",
  "delete_mcp_server",
  "on_off_mcp_server",
  "get_mcp_server_status",
];

/** True when a tool name is one of the agent-driven MCP management tools. */
export function isMcpManagementTool(name: string): boolean {
  return (MCP_MANAGEMENT_TOOL_NAMES as readonly string[]).includes((name ?? "").trim());
}

/** Shared guard: management tools need the persisted MCP manager. */
export function requireMcpManager(ctx: ToolContext): ToolResult | null {
  if (!ctx.mcpManager) {
    return {
      ok: false,
      error: {
        code: "mcp_unavailable",
        message:
          "MCP server management is not available in this context. It is only available to the main agent, custom agents, and team/CEO agents.",
      },
    };
  }
  return null;
}

/** Find a persisted server by exact name (case-insensitive, trimmed). */
export function findServerByName(
  manager: McpManager,
  rawName: string,
): McpServerConfig | undefined {
  const target = (rawName ?? "").trim().toLowerCase();
  if (!target) return undefined;
  return manager.list().find((s) => s.name.trim().toLowerCase() === target);
}

/** Browser-safe projection list, newest-first (mirrors manager.list order). */
export function publicServerList(manager: McpManager): ReturnType<typeof toPublicServer>[] {
  return manager.list().map(toPublicServer);
}

/**
 * Emit the fresh MCP server list to the frontend so the MCP page + the next
 * chat turn converge on the backend truth immediately. Best-effort — a failure
 * to emit must never break the tool result.
 */
export function emitMcpServersUpdated(ctx: ToolContext, manager: McpManager): void {
  try {
    ctx.emit?.("mcp_servers_updated", {
      servers: publicServerList(manager),
      chat_id: ctx.chatId,
      tool_call_id: ctx.toolCallId,
    });
  } catch {
    // best effort
  }
}

/**
 * Emit an OAuth-connect request so the chat UI renders a Connect button inside
 * this tool's block. The frontend opens the authorization URL (fetched via
 * POST /api/mcp/oauth/start with its own origin) in a new tab; the tool itself
 * keeps polling the stored server status until it flips to connected, fails,
 * or the timeout elapses.
 */
export function emitMcpOAuthRequired(
  ctx: ToolContext,
  server: McpServerConfig,
): void {
  try {
    ctx.emit?.("mcp_oauth_required", {
      server_id: server.id,
      server_name: server.name,
      chat_id: ctx.chatId,
      tool_call_id: ctx.toolCallId,
    });
  } catch {
    // best effort
  }
}

/** How long an OAuth tool waits for the user to finish authorizing (3 minutes). */
export const MCP_OAUTH_TIMEOUT_MS = 3 * 60_000;

/** Poll interval while waiting for OAuth completion. */
const MCP_OAUTH_POLL_MS = 2_000;

function sleep(ms: number, signal?: AbortSignal): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    if (signal?.aborted) {
      resolve(true);
      return;
    }
    const onAbort = (): void => {
      clearTimeout(timer);
      resolve(true);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve(false);
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Block until an OAuth server flips to connected, fails, or the timeout
 * elapses. Returns the fresh server config (or null on timeout/abort).
 * Never throws — timeouts and aborts resolve to null so the caller can shape
 * a model-facing message.
 */
export async function waitForMcpOAuth(
  manager: McpManager,
  serverId: string,
  options?: { timeoutMs?: number; signal?: AbortSignal },
): Promise<McpServerConfig | null> {
  const timeoutMs = options?.timeoutMs ?? MCP_OAUTH_TIMEOUT_MS;
  const signal = options?.signal;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (signal?.aborted) return null;
    const fresh = manager.get(serverId);
    if (!fresh) return null;
    if (fresh.status === "connected") return fresh;
    if (fresh.status === "error") return fresh;
    if (Date.now() >= deadline) return null;
    const remaining = deadline - Date.now();
    await sleep(Math.min(MCP_OAUTH_POLL_MS, Math.max(250, remaining)), signal);
  }
}

/**
 * After a server connects (or is re-enabled), attach its FULL tool catalog to
 * the live turn runtime so the agent can call its native mcp_* tools on the
 * very next model iteration — without waiting for the next chat turn.
 * Best-effort: a catalog failure still leaves the persisted server usable next turn.
 */
export async function attachServerToTurn(
  ctx: ToolContext,
  serverId: string,
): Promise<{ attached: number; tools: string[] }> {
  try {
    if (!ctx.mcp) return { attached: 0, tools: [] };
    return await ctx.mcp.attachServer(serverId, ctx.signal);
  } catch {
    return { attached: 0, tools: [] };
  }
}

/** Detach one server's native tools from the live turn runtime (disable/delete). */
export function detachServerFromTurn(ctx: ToolContext, serverId: string): void {
  try {
    ctx.mcp?.detachServer(serverId);
  } catch {
    // best effort
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Test a freshly created no-auth/local server end-to-end (connect + tools/list),
 * persist its connected status + cached catalog, and attach it to the live turn.
 * Returns the updated server config. Throws with a human message on failure
 * (the caller converts to a ToolResult and removes the half-created record).
 */
export async function testAndActivateServer(
  manager: McpManager,
  ctx: ToolContext,
  serverId: string,
): Promise<McpServerConfig> {
  const server = manager.get(serverId);
  if (!server) throw new Error("The MCP server record could not be found after creation.");
  let tools: Array<{ name: string; description: string }>;
  try {
    const client = await manager.connection(serverId, ctx.signal);
    tools = (await client.listTools()).map((t) => ({
      name: t.name,
      description: t.description,
    }));
    manager.touch(serverId);
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === "OAUTH_REQUIRED") {
      manager.markStatus(serverId, "auth_required", { lastError: messageOf(error) });
    } else {
      manager.markStatus(serverId, "error", { lastError: messageOf(error).slice(0, 300) });
    }
    throw error instanceof Error ? error : new Error(messageOf(error));
  }
  const updated =
    manager.markStatus(serverId, "connected", { cachedTools: tools }) ??
    manager.get(serverId);
  if (!updated) throw new Error("The MCP server record was lost while testing the connection.");
  await attachServerToTurn(ctx, serverId);
  emitMcpServersUpdated(ctx, manager);
  return updated;
}
