import type { OpenAIToolSchema } from "../tools/registry.js";
import type { ToolResult } from "../tools/types.js";
import { COMPOSIO_DEFAULT_USER_ID, getConnector, type ConnectorWire } from "./configuration.js";
import { ComposioClient, ComposioError, type ComposioToolDefinition } from "./client.js";

/**
 * The connector tool bridge — turns every tool of every connected Composio toolkit
 * into a NATIVE function tool for the agent.
 *
 * There is deliberately no allowlist, no per-connector subset, and no cap: the full
 * catalog Composio returns for a connected toolkit is advertised (cursor-paginated
 * until exhausted) and executable. Tool slugs are globally unique in Composio
 * (`{TOOLKIT}_{ACTION}`, SCREAMING_SNAKE_CASE), so they never collide with the
 * built-in lowercase registry tools.
 *
 * Catalog reads are cached in memory (short TTL) so a turn with connected apps does
 * not re-download hundreds of tool schemas on every message; execution is never
 * cached. One runtime is built per turn from that turn's connections.
 */

/** One connector tool in the OpenAI function shape the providers expect. */
export interface ConnectorToolSchema {
  /** Composio tool slug, e.g. `GITHUB_CREATE_ISSUE` (also the native function name). */
  name: string;
  /** Human display name, e.g. "Create an issue". */
  displayName: string;
  description: string;
  parameters: Record<string, unknown>;
  connectorId: string;
  toolkitName: string;
}

interface CachedCatalog {
  /** Epoch ms when the entry was stored. */
  at: number;
  tools: ComposioToolDefinition[];
}

/** How long a toolkit's tool catalog stays in memory before it is re-fetched. */
export const CONNECTOR_CATALOG_TTL_MS = 15 * 60_000;

/**
 * Process-level catalog cache: toolkit slug -> tools. Keyed by toolkit AND api key
 * (catalogs can differ per Composio project). In-flight fetches are shared so
 * concurrent turns never stampede Composio.
 */
export class ConnectorToolCache {
  private readonly entries = new Map<string, CachedCatalog>();
  private readonly inflight = new Map<string, Promise<ComposioToolDefinition[]>>();

  /** Test hook: drop everything (isolates unit tests). */
  clear(): void {
    this.entries.clear();
    this.inflight.clear();
  }

  async get(
    client: ComposioClient,
    apiKey: string,
    toolkitSlug: string,
  ): Promise<ComposioToolDefinition[]> {
    const key = `${apiKey}::${toolkitSlug.toLowerCase()}`;
    const cached = this.entries.get(key);
    if (cached && Date.now() - cached.at < CONNECTOR_CATALOG_TTL_MS) return cached.tools;

    const running = this.inflight.get(key);
    if (running) return running;

    const load = client
      .listTools(toolkitSlug)
      .then((tools) => {
        this.entries.set(key, { at: Date.now(), tools });
        this.inflight.delete(key);
        return tools;
      })
      .catch((error) => {
        this.inflight.delete(key);
        throw error;
      });
    this.inflight.set(key, load);
    return load;
  }
}

/** Shared process-level cache used by every turn (see ConnectorToolCache). */
export const sharedConnectorToolCache = new ConnectorToolCache();

export interface ConnectorRuntimeOptions {
  /** Composio API key for this turn ("" = connectors disabled, no network). */
  apiKey: string;
  /** Composio user id connections are scoped to. */
  userId?: string;
  /** The turn's connector references (only these toolkits are loaded). */
  connections: ConnectorWire[];
  /** Injectable client factory (tests). */
  clientFactory?: (apiKey: string) => ComposioClient;
  /** Injectable catalog cache (tests). */
  cache?: ConnectorToolCache;
}

/**
 * Per-turn view over the connected apps' tools. Empty (no schemas, no network)
 * when no API key or no connections are present — all agent paths handle that.
 */
export class ConnectorRuntime {
  private readonly byName = new Map<string, ConnectorToolSchema>();
  private readonly accountByToolkit = new Map<string, string>();
  /**
   * Lazily-created client. It stays null until there is an API key to use, so an
   * inert runtime makes zero network calls — but it is still CAPABLE of attaching a
   * connector mid-turn once one is connected (the agent-driven connect tool).
   */
  private client: ComposioClient | null;

  private constructor(
    private readonly apiKey: string,
    private readonly userId: string,
    readonly connectorIds: string[],
    clientFactory: (apiKey: string) => ComposioClient,
    private readonly cache: ConnectorToolCache,
  ) {
    this.client = apiKey ? clientFactory(apiKey) : null;
  }

  /** Inert runtime with no tools and zero network (used when connectors are off / in tests). */
  static empty(): ConnectorRuntime {
    return new ConnectorRuntime(
      "",
      COMPOSIO_DEFAULT_USER_ID,
      [],
      (key: string) => new ComposioClient(key),
      sharedConnectorToolCache,
    );
  }

  /** Build a runtime, downloading each connected toolkit's FULL catalog (cached). */
  static async create(options: ConnectorRuntimeOptions): Promise<ConnectorRuntime> {
    const apiKey = (options.apiKey ?? "").trim();
    const userId = (options.userId ?? "").trim() || COMPOSIO_DEFAULT_USER_ID;
    const factory = options.clientFactory ?? ((key: string) => new ComposioClient(key));
    const cache = options.cache ?? sharedConnectorToolCache;
    const runtime = new ConnectorRuntime(apiKey, userId, [], factory, cache);
    if (!apiKey || options.connections.length === 0) return runtime;

    // De-duplicate by toolkit so two connections to the same app share one catalog read.
    const byToolkit = new Map<string, string>();
    for (const connection of options.connections) {
      const connector = getConnector(connection.connectorId);
      if (!connector) continue;
      const accountId = connection.connectedAccountId.trim();
      if (!accountId) continue;
      byToolkit.set(connector.toolkitSlug.toLowerCase(), accountId);
      if (!runtime.connectorIds.includes(connector.id)) runtime.connectorIds.push(connector.id);
    }
    if (byToolkit.size === 0) return runtime;

    const client = runtime.client!;
    const settled = await Promise.all(
      [...byToolkit.entries()].map(async ([toolkitSlug, accountId]) => {
        try {
          const tools = await cache.get(client, apiKey, toolkitSlug);
          return { toolkitSlug, accountId, tools };
        } catch {
          // One toolkit failing must not hide the others — it simply contributes no tools.
          return { toolkitSlug, accountId, tools: [] as ComposioToolDefinition[] };
        }
      }),
    );

    for (const entry of settled) {
      runtime.addToolkit(entry.toolkitSlug, entry.accountId, entry.tools);
    }
    return runtime;
  }

  /** Register every tool of one toolkit under the account it executes with. */
  private addToolkit(
    toolkitSlug: string,
    connectedAccountId: string,
    tools: ComposioToolDefinition[],
  ): void {
    if (tools.length === 0) return;
    this.accountByToolkit.set(toolkitSlug.toLowerCase(), connectedAccountId);
    for (const tool of tools) {
      const name = tool.slug.trim();
      if (!name || this.byName.has(name)) continue;
      const connector = getConnector(tool.toolkitSlug) ?? getConnector(toolkitSlug);
      this.byName.set(name, {
        name,
        displayName: tool.name.trim() || name,
        description: tool.description,
        parameters: toOpenAIParameters(tool.inputParameters),
        connectorId: connector?.id ?? toolkitSlug,
        toolkitName: tool.toolkitName || connector?.name || toolkitSlug,
      });
    }
  }

  /** True when at least one connected toolkit contributed tools. */
  get active(): boolean {
    return this.byName.size > 0;
  }

  /**
   * The Composio client backing this turn (null when no API key is configured).
   * The agent-driven connector management tools reuse it for auth-config discovery,
   * connected-account polling, and deletion — so they share this turn's credentials,
   * transport, and test seams. Never performs I/O by itself.
   */
  composioClient(): ComposioClient | null {
    return this.client;
  }

  /** Number of native connector tools available this turn (uncapped by design). */
  get size(): number {
    return this.byName.size;
  }

  /** OpenAI `tools` array for the connected apps (registry order: connector, then name). */
  schemas(): OpenAIToolSchema[] {
    return [...this.byName.values()]
      .sort((a, b) =>
        a.connectorId === b.connectorId
          ? a.name.localeCompare(b.name)
          : a.connectorId.localeCompare(b.connectorId),
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

  /** Every connector tool name available this turn. */
  names(): string[] {
    return [...this.byName.keys()];
  }

  /** True when `name` is a connector tool available this turn. */
  has(name: string): boolean {
    return this.byName.has((name ?? "").trim());
  }

  /** Short human label for UI chips, e.g. "GitHub: Create an issue". */
  label(name: string): string {
    const tool = this.byName.get((name ?? "").trim());
    if (!tool) return name;
    return `${tool.toolkitName}: ${tool.displayName}`;
  }

  /** Execute a connector tool with NATIVE arguments (never prose) via Composio. */
  async execute(name: string, args: Record<string, unknown>): Promise<ToolResult> {
    const tool = this.byName.get((name ?? "").trim());
    if (!tool || !this.client) {
      return {
        ok: false,
        error: {
          code: "unknown_connector_tool",
          message: `Unknown connector tool: ${name}. The app may have been disconnected.`,
        },
      };
    }
    const toolkitKey = toolSlugToolkit(tool.name) ?? "";
    const connectedAccountId =
      this.accountByToolkit.get(toolkitKey.toLowerCase()) ??
      this.accountByToolkit.get(tool.connectorId);
    if (!connectedAccountId) {
      return {
        ok: false,
        error: {
          code: "connector_not_connected",
          message: `The ${tool.toolkitName} connector is not connected. Connect it on the Connectors page first.`,
        },
      };
    }
    try {
      const result = await this.client.executeTool(tool.name, {
        userId: this.userId,
        connectedAccountId,
        args: args ?? {},
      });
      if (!result.successful) {
        return {
          ok: false,
          error: {
            code: "connector_tool_failed",
            message: result.error || `The ${tool.name} tool call failed.`,
            tool: tool.name,
          },
        };
      }
      return { ok: true, data: result.data ?? null };
    } catch (error) {
      if (error instanceof ComposioError) {
        return {
          ok: false,
          error: { code: error.code, message: error.message, tool: tool.name },
        };
      }
      return {
        ok: false,
        error: {
          code: "connector_tool_failed",
          message: error instanceof Error ? error.message : String(error),
          tool: tool.name,
        },
      };
    }
  }

  /** One-line hint appended to an agent's system prompt when connectors are active. */
  hint(): string {
    if (this.connectorIds.length === 0) return "";
    const names = this.connectorIds
      .map((id) => getConnector(id)?.name ?? id)
      .join(", ");
    return (
      `Connected apps (${names}): you have native ${this.size} app tool(s) available ` +
      `(e.g. ${[...this.byName.keys()].slice(0, 6).join(", ")}${this.size > 6 ? ", ..." : ""}). ` +
      `Call them as real function calls with exact arguments whenever the task touches a connected app.`
    );
  }

  /**
   * Dynamically attach one connector's FULL tool catalog to this live turn runtime.
   *
   * Used by the agent-driven connector management tool (connect_applications_connectors)
   * so an app the agent just connected is usable in the SAME turn — the next model
   * iteration sees its native tools without waiting for the next chat turn. Any tools
   * previously attached for that connector are replaced (reconnect-safe).
   *
   * Returns how many native tools were attached. Never throws: a catalog failure leaves
   * the persisted connection usable from the next chat turn on.
   */
  async attachConnector(
    connectorId: string,
    connectedAccountId: string,
  ): Promise<{ attached: number; tools: string[] }> {
    const connector = getConnector(connectorId);
    const accountId = connectedAccountId.trim();
    if (!connector || !accountId || !this.apiKey) return { attached: 0, tools: [] };
    // Reconnects replace the previous account binding rather than stacking.
    this.detachConnector(connector.id);
    let definitions: ComposioToolDefinition[];
    try {
      definitions = await this.cache.get(this.client!, this.apiKey, connector.toolkitSlug);
    } catch {
      return { attached: 0, tools: [] };
    }
    const before = this.byName.size;
    this.addToolkit(connector.toolkitSlug, accountId, definitions);
    if (!this.connectorIds.includes(connector.id)) this.connectorIds.push(connector.id);
    const tools = [...this.byName.keys()].slice(before);
    return { attached: this.byName.size - before, tools };
  }

  /** Drop every native tool contributed by one connector (used on disconnect). */
  detachConnector(connectorId: string): number {
    const key = (connectorId ?? "").trim().toLowerCase();
    if (!key) return 0;
    let removed = 0;
    for (const [name, tool] of [...this.byName]) {
      if (tool.connectorId.toLowerCase() === key) {
        this.byName.delete(name);
        removed += 1;
      }
    }
    // The execution account lives under the toolkit slug, so drop that binding too —
    // otherwise a detached tool name could still resolve a stale connected account.
    const toolkitSlug = getConnector(key)?.toolkitSlug;
    if (toolkitSlug) this.accountByToolkit.delete(toolkitSlug.toLowerCase());
    const index = this.connectorIds.indexOf(key);
    if (index !== -1) this.connectorIds.splice(index, 1);
    return removed;
  }
}

/** Derive the toolkit slug from a `{TOOLKIT}_{ACTION}` slug (prefix before the first `_`). */
function toolSlugToolkit(slug: string): string | null {
  const index = slug.indexOf("_");
  if (index <= 0) return null;
  return slug.slice(0, index).toLowerCase();
}

/**
 * Normalize a Composio input schema into OpenAI function parameters. Composio serves
 * JSON-Schema-like objects; providers expect `{type: "object", properties, required}`.
 * Unknown shapes degrade to an empty object schema rather than breaking the turn.
 */
export function toOpenAIParameters(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { type: "object", properties: {} };
  }
  const r = input as Record<string, unknown>;
  const properties =
    r.properties && typeof r.properties === "object" && !Array.isArray(r.properties)
      ? (r.properties as Record<string, unknown>)
      : {};
  const required = Array.isArray(r.required)
    ? (r.required as unknown[]).filter((v): v is string => typeof v === "string")
    : [];
  const out: Record<string, unknown> = { type: "object", properties };
  if (required.length > 0) out.required = required;
  if (typeof r.description === "string" && r.description.trim()) {
    out.description = r.description;
  }
  return out;
}

/** Model-facing description: what the tool does + which connected app it acts on. */
function describeForModel(tool: ConnectorToolSchema): string {
  const base = tool.description.trim();
  const suffix = `(Connected app: ${tool.toolkitName}. Acts on the user's connected ${tool.toolkitName} account.)`;
  return base ? `${base}\n${suffix}` : suffix;
}
