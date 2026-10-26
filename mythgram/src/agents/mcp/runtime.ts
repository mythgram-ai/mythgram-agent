import type { OpenAIToolSchema } from "../tools/registry.js";
import type { ToolResult } from "../tools/types.js";
import type { McpServerConfig } from "./configuration.js";
import type { McpManager } from "./manager.js";
import type { McpToolDescription } from "./client.js";
import { McpHttpError } from "./streamableHttp.js";

/**
 * The MCP tool bridge — turns every tool of every connected MCP server into a
 * NATIVE function tool for the agent, exactly like the connector bridge does
 * for Composio apps.
 *
 * There is deliberately no allowlist and no cap: the full `tools/list`
 * catalog of each enabled server is advertised (cursor-paginated to the end)
 * and executable. Tool names are namespaced per server (`mcp_<slug>_<tool>`,
 * sanitized to the OpenAI function-name shape) so two servers exposing the
 * same tool never collide with each other — or with the built-in lowercase
 * registry tools.
 *
 * Catalog reads are cached in memory (short TTL) so a turn with MCP servers
 * does not re-handshake on every message; execution is never cached. One
 * runtime is built per turn from that turn's server selection.
 */

/** Prefix every MCP native tool name carries (never a built-in registry name). */
export const MCP_TOOL_PREFIX = "mcp_";

/** One MCP tool in the OpenAI function shape the providers expect. */
export interface McpToolSchema {
  /** Namespaced native function name, e.g. `mcp_github_search_repos`. */
  name: string;
  /** The tool name as the MCP server reported it. */
  toolName: string;
  /** The MCP server id backing this tool. */
  serverId: string;
  /** The MCP server display name. */
  serverName: string;
  /** Human display name for UI chips. */
  displayName: string;
  description: string;
  parameters: Record<string, unknown>;
}

interface CachedCatalog {
  /** Epoch ms when the entry was stored. */
  at: number;
  tools: McpToolDescription[];
}

/** How long a server's tool catalog stays in memory before it is re-listed. */
export const MCP_CATALOG_TTL_MS = 15 * 60_000;

/**
 * Process-level catalog cache: server id -> tools. In-flight listings are
 * shared so concurrent turns never handshake the same server twice.
 */
export class McpToolCache {
  private readonly entries = new Map<string, CachedCatalog>();
  private readonly inflight = new Map<string, Promise<McpToolDescription[]>>();

  /** Test hook: drop everything (isolates unit tests). */
  clear(): void {
    this.entries.clear();
    this.inflight.clear();
  }

  async get(
    manager: McpManager,
    serverId: string,
    signal?: AbortSignal,
  ): Promise<McpToolDescription[]> {
    const cached = this.entries.get(serverId);
    if (cached && Date.now() - cached.at < MCP_CATALOG_TTL_MS) return cached.tools;

    const running = this.inflight.get(serverId);
    if (running) return running;

    const load = (async (): Promise<McpToolDescription[]> => {
      const client = await manager.connection(serverId, signal);
      const tools = await client.listTools();
      manager.touch(serverId);
      return tools;
    })()
      .then((tools) => {
        this.entries.set(serverId, { at: Date.now(), tools });
        this.inflight.delete(serverId);
        return tools;
      })
      .catch((error) => {
        this.inflight.delete(serverId);
        throw error;
      });
    this.inflight.set(serverId, load);
    return load;
  }

  set(serverId: string, tools: McpToolDescription[]): void {
    this.entries.set(serverId, { at: Date.now(), tools });
  }

  drop(serverId: string): void {
    this.entries.delete(serverId);
    this.inflight.delete(serverId);
  }
}

/** Shared process-level cache used by every turn (see McpToolCache). */
export const sharedMcpToolCache = new McpToolCache();

export interface McpRuntimeOptions {
  manager: McpManager;
  /** Server ids selected for this turn (undefined/empty = every enabled server). */
  serverIds?: string[];
  /** Injectable catalog cache (tests). */
  cache?: McpToolCache;
  signal?: AbortSignal;
}

/**
 * Per-turn view over the connected MCP servers' tools. Empty (no schemas, no
 * network) when no server is enabled — all agent paths handle that.
 */
export class McpRuntime {
  private readonly byName = new Map<string, McpToolSchema>();
  private readonly serverIds: string[] = [];

  private constructor(
    private readonly manager: McpManager,
    readonly enabledServerIds: string[],
  ) {}

  /** Inert runtime with no tools and zero network (used when MCP is off / in tests). */
  static empty(manager: McpManager): McpRuntime {
    return new McpRuntime(manager, []);
  }

  /** Build a runtime, listing each selected server's FULL catalog (cached). */
  static async create(options: McpRuntimeOptions): Promise<McpRuntime> {
    const { manager } = options;
    const cache = options.cache ?? sharedMcpToolCache;
    const all = manager.list().filter((s) => s.enabled);
    const wanted =
      options.serverIds && options.serverIds.length > 0
        ? new Set(options.serverIds.map((id) => id.trim()).filter(Boolean))
        : null;
    const servers = wanted ? all.filter((s) => wanted.has(s.id)) : all;
    const runtime = new McpRuntime(manager, servers.map((s) => s.id));
    if (servers.length === 0) return runtime;

    const settled = await Promise.all(
      servers.map(async (server) => {
        try {
          const tools = await cache.get(manager, server.id, options.signal);
          return { server, tools, error: null as unknown };
        } catch (error) {
          return { server, tools: [] as McpToolDescription[], error };
        }
      }),
    );

    for (const entry of settled) {
      if (entry.error) {
        // Mark unreachable servers so the MCP page shows the failure; an
        // oauth server that lost its token is marked auth_required instead.
        const code = (entry.error as { code?: string }).code;
        if (code !== "OAUTH_REQUIRED") {
          manager.markStatus(entry.server.id, "error", {
            lastError: messageOf(entry.error),
          });
        } else {
          manager.markStatus(entry.server.id, "auth_required", {
            lastError: messageOf(entry.error),
          });
        }
        continue;
      }
      const disabled = new Set(entry.server.disabledTools ?? []);
      for (const tool of entry.tools) {
        if (disabled.has(tool.name)) continue;
        const name = nativeToolName(entry.server, tool.name, runtime.byName);
        if (!name || runtime.byName.has(name)) continue;
        runtime.byName.set(name, {
          name,
          toolName: tool.name,
          serverId: entry.server.id,
          serverName: entry.server.name,
          displayName: tool.name,
          description: tool.description,
          parameters: tool.inputSchema,
        });
      }
      if (!runtime.serverIds.includes(entry.server.id)) runtime.serverIds.push(entry.server.id);
    }
    return runtime;
  }

  /** True when at least one MCP server contributed tools. */
  get active(): boolean {
    return this.byName.size > 0;
  }

  /** Number of native MCP tools available this turn (uncapped by design). */
  get size(): number {
    return this.byName.size;
  }

  /** OpenAI `tools` array for the MCP servers (server, then name order). */
  schemas(): OpenAIToolSchema[] {
    return [...this.byName.values()]
      .sort((a, b) =>
        a.serverName === b.serverName
          ? a.name.localeCompare(b.name)
          : a.serverName.localeCompare(b.serverName),
      )
      .map((tool) => ({
        type: "function" as const,
        function: {
          name: tool.name,
          description: describeForModel(tool),
          parameters: tool.parameters,
        },
      }));
  }

  /** Every MCP tool name available this turn. */
  names(): string[] {
    return [...this.byName.keys()];
  }

  /** True when `name` is an MCP tool available this turn. */
  has(name: string): boolean {
    return this.byName.has((name ?? "").trim());
  }

  /** Short human label for UI chips, e.g. "GitHub MCP: search_repos". */
  label(name: string): string {
    const tool = this.byName.get((name ?? "").trim());
    if (!tool) return name;
    return `${tool.serverName}: ${tool.displayName}`;
  }

  /** Execute an MCP tool with NATIVE arguments against its server. */
  async execute(name: string, args: Record<string, unknown>): Promise<ToolResult> {
    const tool = this.byName.get((name ?? "").trim());
    if (!tool) {
      return {
        ok: false,
        error: {
          code: "unknown_mcp_tool",
          message: `Unknown MCP tool: ${name}. The server may have been disabled or disconnected.`,
        },
      };
    }
    try {
      const client = await this.manager.connection(tool.serverId);
      const result = await client.callTool(tool.toolName, args ?? {});
      this.manager.touch(tool.serverId);
      if (result.isError) {
        return {
          ok: false,
          error: {
            code: "mcp_tool_error",
            message: result.text || `The MCP tool "${tool.toolName}" reported an error.`,
            tool: name,
          },
        };
      }
      return {
        ok: true,
        data: result.structured !== undefined ? result.structured : result.text,
      };
    } catch (error) {
      if (error instanceof McpHttpError && error.status === 401) {
        this.manager.markStatus(tool.serverId, "auth_required", { lastError: messageOf(error) });
        return {
          ok: false,
          error: {
            code: "mcp_auth_required",
            message: `The MCP server "${tool.serverName}" rejected the credentials. Reconnect it on the MCP page.`,
            tool: name,
          },
        };
      }
      const code = (error as { code?: string }).code;
      if (code === "OAUTH_REQUIRED") {
        this.manager.markStatus(tool.serverId, "auth_required", { lastError: messageOf(error) });
        return {
          ok: false,
          error: { code: "mcp_auth_required", message: messageOf(error), tool: name },
        };
      }
      return {
        ok: false,
        error: {
          code: "mcp_tool_failed",
          message: messageOf(error),
          tool: name,
        },
      };
    }
  }

  /** One-line hint appended to an agent's system prompt when MCP is active. */
  hint(): string {
    if (this.serverIds.length === 0) return "";
    const names = this.serverIds
      .map((id) => this.manager.get(id)?.name ?? id)
      .join(", ");
    return (
      `Connected MCP servers (${names}): you have native ${this.size} MCP tool(s) available ` +
      `(e.g. ${[...this.byName.keys()].slice(0, 6).join(", ")}${this.size > 6 ? ", ..." : ""}). ` +
      `Call them as real function calls with exact arguments whenever the task touches one of these servers.`
    );
  }

  /**
   * Dynamically attach one server's FULL tool catalog to this live turn runtime.
   * Used by the agent-driven MCP management tools (connect_remote_mcp,
   * connect_local_mcp_server, on_off_mcp_server) so a server the agent just
   * connected/enabled is immediately usable in the SAME turn — the next model
   * iteration sees its native tools without waiting for the next chat turn.
   * Returns how many native tools were attached.
   */
  async attachServer(
    serverId: string,
    signal?: AbortSignal,
    cache?: McpToolCache,
  ): Promise<{ attached: number; tools: string[] }> {
    const server = this.manager.get(serverId);
    if (!server || !server.enabled) return { attached: 0, tools: [] };
    const toolCache = cache ?? sharedMcpToolCache;
    let descriptions;
    try {
      descriptions = await toolCache.get(this.manager, serverId, signal);
    } catch {
      return { attached: 0, tools: [] };
    }
    // Drop any stale tools previously attached for this server, then re-attach.
    this.detachServer(serverId);
    const fresh = this.manager.get(serverId);
    if (!fresh) return { attached: 0, tools: [] };
    const disabled = new Set(fresh.disabledTools ?? []);
    const added: string[] = [];
    for (const tool of descriptions) {
      if (disabled.has(tool.name)) continue;
      const name = nativeToolName(fresh, tool.name, this.byName);
      if (!name || this.byName.has(name)) continue;
      this.byName.set(name, {
        name,
        toolName: tool.name,
        serverId: fresh.id,
        serverName: fresh.name,
        displayName: tool.name,
        description: tool.description,
        parameters: tool.inputSchema,
      });
      added.push(name);
    }
    if (!this.serverIds.includes(serverId)) this.serverIds.push(serverId);
    if (!this.enabledServerIds.includes(serverId)) this.enabledServerIds.push(serverId);
    this.manager.touch(serverId);
    return { attached: added.length, tools: added };
  }

  /** Drop every native tool contributed by one server (used on disable/delete). */
  detachServer(serverId: string): number {
    let removed = 0;
    for (const [name, tool] of [...this.byName]) {
      if (tool.serverId === serverId) {
        this.byName.delete(name);
        removed += 1;
      }
    }
    const idx = this.serverIds.indexOf(serverId);
    if (idx !== -1) this.serverIds.splice(idx, 1);
    const enabledIdx = this.enabledServerIds.indexOf(serverId);
    if (enabledIdx !== -1) this.enabledServerIds.splice(enabledIdx, 1);
    return removed;
  }
}

/** True when a tool name looks like an MCP namespaced tool (`mcp_<slug>_...`). */
export function isMcpToolName(name: string): boolean {
  return /^mcp_[a-z0-9]+_.+$/i.test((name ?? "").trim());
}

/** URL/host-safe slug of a server name, used inside native tool names. */
export function mcpServerSlug(server: McpServerConfig): string {
  const slug = server.name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 20);
  return slug || `server_${server.id.slice(0, 6).toLowerCase()}`;
}

/**
 * Build the native function name for one MCP tool: `mcp_<slug>_<tool>`,
 * sanitized to `[A-Za-z0-9_-]`, capped at 64 chars (the OpenAI limit), with a
 * short hash suffix when truncation or a collision would occur.
 */
function nativeToolName(
  server: McpServerConfig,
  toolName: string,
  taken: Map<string, McpToolSchema>,
): string | null {
  const clean = toolName
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!clean) return null;
  const slug = mcpServerSlug(server);
  let base = `${MCP_TOOL_PREFIX}${slug}_${clean}`;
  if (base.length > 64) {
    const hash = shortHash(`${server.id}:${toolName}`);
    base = `${base.slice(0, 64 - 7)}_${hash}`;
  }
  if (!taken.has(base)) return base;
  // Collision (two servers, same slug+tool): disambiguate with the server id.
  const hash = shortHash(`${server.id}:${toolName}`);
  const alt = `${base.slice(0, 64 - 7)}_${hash}`;
  return taken.has(alt) ? null : alt;
}

function shortHash(value: string): string {
  let h = 0;
  for (let i = 0; i < value.length; i += 1) {
    h = (Math.imul(h, 31) + value.charCodeAt(i)) | 0;
  }
  return Math.abs(h).toString(36).padStart(6, "0").slice(0, 6);
}

/** Model-facing description: what the tool does + which MCP server it acts on. */
function describeForModel(tool: McpToolSchema): string {
  const base = tool.description.trim();
  const suffix = `(MCP server: ${tool.serverName}. Acts through the user's connected "${tool.serverName}" MCP server.)`;
  return base ? `${base}\n${suffix}` : suffix;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
