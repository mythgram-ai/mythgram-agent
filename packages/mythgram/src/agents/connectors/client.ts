import { COMPOSIO_API_BASE } from "./configuration.js";

/**
 * Minimal Composio REST client (v3.1) over the global `fetch` — no SDK dependency,
 * matching how the provider layer talks to LLM APIs.
 *
 * Covered surface (everything the connectors feature needs):
 *   - auth config discovery/creation per toolkit  (OAuth connect flow)
 *   - connected-account link creation (returns the user-facing `redirect_url`)
 *   - connected-account status polling + listing + deletion
 *   - full tool-catalog listing per toolkit (cursor-paginated, NO limit)
 *   - tool execution against a connected account
 *   - toolkit metadata (official name + logo URL for the connector cards)
 *
 * Every method is defensive: unknown response shapes degrade to structured errors,
 * never throws raw. `fetchFn` is injectable so tests run without network.
 */

/** Structured error raised for Composio API failures (HTTP or application-level). */
export class ComposioError extends Error {
  readonly code: string;
  readonly status?: number;
  constructor(code: string, message: string, status?: number) {
    super(message);
    this.name = "ComposioError";
    this.code = code;
    if (status !== undefined) this.status = status;
  }
}

/** One auth config as returned by `GET /auth_configs`. */
export interface ComposioAuthConfig {
  id: string;
  type: string;
  status: string;
  authScheme: string;
  isComposioManaged: boolean;
  toolkitSlug: string;
  createdAt: string;
}

/** Result of creating an auth-link session (`POST /connected_accounts/link`). */
export interface ComposioLinkResult {
  redirectUrl: string;
  connectedAccountId: string;
}

/** Status detail of one connected account. */
export interface ComposioConnectedAccount {
  id: string;
  /** Normalized lowercase status: active | initiated | initializing | failed | ... */
  status: string;
  toolkitSlug: string;
  userId: string;
}

/** One tool of a toolkit's catalog (`GET /tools`). */
export interface ComposioToolDefinition {
  slug: string;
  name: string;
  description: string;
  /** Raw input schema as served by Composio (normalized at the bridge layer). */
  inputParameters: Record<string, unknown>;
  toolkitSlug: string;
  toolkitName: string;
  toolkitLogo: string;
}

/** Outcome of a tool execution (`POST /tools/execute/{slug}`). */
export interface ComposioExecuteResult {
  successful: boolean;
  data: unknown;
  error: string | null;
}

/** Toolkit metadata (`GET /toolkits/{slug}`). */
export interface ComposioToolkitInfo {
  slug: string;
  name: string;
  logo: string;
  toolsCount: number;
}

export type ComposioFetch = typeof fetch;

const REQUEST_TIMEOUT_MS = 30_000;
/** Page size for catalog listing — pagination continues until exhausted (no tool cap). */
const TOOLS_PAGE_SIZE = 1000;

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export class ComposioClient {
  private readonly baseUrl: string;
  private readonly fetchFn: ComposioFetch;

  constructor(
    private readonly apiKey: string,
    options?: { baseUrl?: string; fetchFn?: ComposioFetch },
  ) {
    this.baseUrl = (options?.baseUrl ?? COMPOSIO_API_BASE).replace(/\/+$/, "");
    this.fetchFn = options?.fetchFn ?? fetch;
  }

  get configured(): boolean {
    return this.apiKey.trim().length > 0;
  }

  private headers(): Record<string, string> {
    return { "x-api-key": this.apiKey.trim(), "Content-Type": "application/json" };
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    if (!this.configured) {
      throw new ComposioError(
        "composio_key_missing",
        "No Composio API key is configured. Add one in Settings → Composio.",
      );
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let res: Response;
    try {
      res = await this.fetchFn(`${this.baseUrl}${path}`, {
        method,
        headers: this.headers(),
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (error) {
      throw new ComposioError(
        "composio_network_error",
        `Could not reach Composio: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      clearTimeout(timer);
    }

    let payload: unknown = {};
    try {
      payload = await res.json();
    } catch {
      payload = {};
    }

    if (!res.ok) {
      const message =
        messageOf(payload) || `Composio request failed with HTTP ${res.status}.`;
      const code =
        res.status === 401 || res.status === 403
          ? "composio_unauthorized"
          : res.status === 404
            ? "composio_not_found"
            : "composio_request_failed";
      throw new ComposioError(code, message, res.status);
    }
    return payload as T;
  }

  /**
   * Find the auth config to use for a toolkit: the newest ENABLED default
   * (Composio-managed preferred) config. Returns null when the project has none.
   */
  async findAuthConfig(toolkitSlug: string): Promise<ComposioAuthConfig | null> {
    const payload = await this.request<{ items?: unknown[] }>(
      "GET",
      `/auth_configs?toolkit_slug=${encodeURIComponent(toolkitSlug)}&limit=50`,
    );
    const items = Array.isArray(payload.items) ? payload.items : [];
    const candidates: ComposioAuthConfig[] = [];
    for (const item of items) {
      const parsed = parseAuthConfig(item);
      if (parsed && parsed.status === "ENABLED") candidates.push(parsed);
    }
    if (candidates.length === 0) return null;
    candidates.sort((a, b) => {
      if (a.isComposioManaged !== b.isComposioManaged) return a.isComposioManaged ? -1 : 1;
      if (a.type !== b.type) return a.type === "default" ? -1 : 1;
      return b.createdAt.localeCompare(a.createdAt);
    });
    return candidates[0] ?? null;
  }

  /**
   * Create a Composio-managed auth config for a toolkit (used when the project
   * has none yet — mirrors what the official SDKs do automatically).
   */
  async createAuthConfig(toolkitSlug: string): Promise<ComposioAuthConfig> {
    const payload = await this.request<{ auth_config?: unknown; id?: unknown }>(
      "POST",
      "/auth_configs",
      {
        toolkit: { slug: toolkitSlug },
        auth_config: {
          type: "use_composio_managed_auth",
          tool_access_config: { tools_for_connected_account_creation: [] },
        },
      },
    );
    const parsed = parseAuthConfig(payload.auth_config ?? payload);
    if (!parsed || !parsed.id) {
      throw new ComposioError(
        "composio_auth_config_failed",
        `Composio did not return an auth config for "${toolkitSlug}".`,
      );
    }
    return parsed;
  }

  /**
   * Start an OAuth connect session for a user (Composio-managed auth). Returns the
   * URL the user must visit plus the pending connected-account id to poll.
   */
  async createLink(authConfigId: string, userId: string): Promise<ComposioLinkResult> {
    const payload = await this.request<Record<string, unknown>>("POST", "/connected_accounts/link", {
      auth_config_id: authConfigId,
      user_id: userId,
    });
    const redirectUrl = str(payload.redirect_url ?? payload.redirectUrl).trim();
    const connectedAccountId = str(
      payload.connected_account_id ?? payload.connectedAccountId ?? payload.id,
    ).trim();
    if (!redirectUrl || !connectedAccountId) {
      throw new ComposioError(
        "composio_link_failed",
        "Composio did not return an authentication URL. Try again.",
      );
    }
    return { redirectUrl, connectedAccountId };
  }

  /** Current status of one connected account (poll until `active`). */
  async getConnectedAccount(connectedAccountId: string): Promise<ComposioConnectedAccount> {
    const payload = await this.request<Record<string, unknown>>(
      "GET",
      `/connected_accounts/${encodeURIComponent(connectedAccountId)}`,
    );
    return parseConnectedAccount(payload, connectedAccountId);
  }

  /** Every connected account of a user (used to reconcile stored connections). */
  async listConnectedAccounts(userId: string): Promise<ComposioConnectedAccount[]> {
    const payload = await this.request<{ items?: unknown[] }>(
      "GET",
      `/connected_accounts?user_id=${encodeURIComponent(userId)}&limit=100`,
    );
    const items = Array.isArray(payload.items) ? payload.items : [];
    return items
      .map((item, i) => {
        try {
          return parseConnectedAccount(item as Record<string, unknown>, `item-${i}`);
        } catch {
          return null;
        }
      })
      .filter((a): a is ComposioConnectedAccount => a !== null);
  }

  /** Delete a connected account (best-effort disconnect on Composio's side). */
  async deleteConnectedAccount(connectedAccountId: string): Promise<void> {
    await this.request("DELETE", `/connected_accounts/${encodeURIComponent(connectedAccountId)}`);
  }

  /**
   * The FULL tool catalog of a toolkit — every page is fetched until the cursor is
   * exhausted. Deliberately no `important`-only filter and no max-tool cap: when a
   * connector is connected, all of its tools become available to the agent.
   */
  async listTools(toolkitSlug: string): Promise<ComposioToolDefinition[]> {
    const out: ComposioToolDefinition[] = [];
    let cursor: string | null = null;
    for (;;) {
      const params = new URLSearchParams({
        toolkit_slug: toolkitSlug,
        toolkit_versions: "latest",
        limit: String(TOOLS_PAGE_SIZE),
      });
      if (cursor) params.set("cursor", cursor);
      const payload = await this.request<{ items?: unknown[]; next_cursor?: unknown }>(
        "GET",
        `/tools?${params.toString()}`,
      );
      const items = Array.isArray(payload.items) ? payload.items : [];
      for (const item of items) {
        const parsed = parseTool(item);
        if (parsed) out.push(parsed);
      }
      const next = str(payload.next_cursor);
      if (!next || items.length === 0) break;
      cursor = next;
    }
    return out;
  }

  /**
   * Execute one tool with structured arguments (native tool calling — the model
   * always passes real arguments, never prose). `text` (NL execution) is never used.
   */
  async executeTool(
    toolSlug: string,
    options: { userId: string; connectedAccountId: string; args: Record<string, unknown> },
  ): Promise<ComposioExecuteResult> {
    const payload = await this.request<Record<string, unknown>>(
      "POST",
      `/tools/execute/${encodeURIComponent(toolSlug)}`,
      {
        user_id: options.userId,
        connected_account_id: options.connectedAccountId,
        arguments: options.args ?? {},
      },
    );
    const successful = payload.successful === true;
    const error = str(payload.error);
    return {
      successful,
      data: payload.data ?? null,
      error: successful ? null : error || "The tool execution failed without an error message.",
    };
  }

  /** Toolkit metadata — the official name + logo URL for the connector cards. */
  async getToolkit(toolkitSlug: string): Promise<ComposioToolkitInfo | null> {
    try {
      const payload = await this.request<Record<string, unknown>>(
        "GET",
        `/toolkits/${encodeURIComponent(toolkitSlug)}`,
      );
      return {
        slug: str(payload.slug) || toolkitSlug,
        name: str(payload.name) || toolkitSlug,
        logo: str(payload.logo),
        toolsCount: typeof payload.tools_count === "number" ? payload.tools_count : 0,
      };
    } catch {
      return null;
    }
  }
}

/** Best-effort message extraction from an error payload (string | {message|error|detail}). */
function messageOf(payload: unknown): string {
  if (typeof payload === "string") return payload.slice(0, 500);
  if (payload && typeof payload === "object") {
    const r = payload as Record<string, unknown>;
    for (const key of ["message", "error", "detail", "msg"]) {
      if (typeof r[key] === "string" && (r[key] as string).trim()) {
        return (r[key] as string).slice(0, 500);
      }
    }
  }
  return "";
}

function parseAuthConfig(raw: unknown): ComposioAuthConfig | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = str(r.id).trim();
  if (!id) return null;
  const toolkit = r.toolkit && typeof r.toolkit === "object" ? (r.toolkit as Record<string, unknown>) : {};
  return {
    id,
    type: str(r.type) || "default",
    status: str(r.status) || "ENABLED",
    authScheme: str(r.auth_scheme ?? r.authScheme),
    isComposioManaged: r.is_composio_managed === true || r.isComposioManaged === true,
    toolkitSlug: str(toolkit.slug),
    createdAt: str(r.created_at ?? r.createdAt),
  };
}

function parseConnectedAccount(raw: unknown, fallbackId: string): ComposioConnectedAccount {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const connection = r.connection && typeof r.connection === "object" ? (r.connection as Record<string, unknown>) : {};
  const state = connection.state && typeof connection.state === "object"
    ? (connection.state as Record<string, unknown>)
    : r.state && typeof r.state === "object"
      ? (r.state as Record<string, unknown>)
      : {};
  const status = str(
    r.status ?? state.status ?? connection.status ?? r.state,
  ).trim().toLowerCase() || "unknown";
  const toolkit = r.toolkit && typeof r.toolkit === "object" ? (r.toolkit as Record<string, unknown>) : {};
  return {
    id: str(r.id).trim() || fallbackId,
    status,
    toolkitSlug: str(toolkit.slug ?? r.toolkit_slug ?? connection.toolkitSlug),
    userId: str(r.user_id ?? r.userId),
  };
}

function parseTool(raw: unknown): ComposioToolDefinition | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const slug = str(r.slug).trim();
  if (!slug) return null;
  const toolkit = r.toolkit && typeof r.toolkit === "object" ? (r.toolkit as Record<string, unknown>) : {};
  const input = r.input_parameters && typeof r.input_parameters === "object"
    ? (r.input_parameters as Record<string, unknown>)
    : {};
  return {
    slug,
    name: str(r.displayName ?? r.name) || slug,
    description: str(r.human_description ?? r.description),
    inputParameters: input,
    toolkitSlug: str(toolkit.slug),
    toolkitName: str(toolkit.name),
    toolkitLogo: str(toolkit.logo),
  };
}
