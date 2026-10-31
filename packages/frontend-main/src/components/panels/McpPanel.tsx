import { useEffect, useState } from "react";
import {
  Check,
  ChevronDown,
  Globe,
  Loader2,
  Pencil,
  Plug,
  PlugZap,
  Plus,
  RefreshCw,
  Search,
  Server,
  ShieldCheck,
  SquareTerminal,
  Trash2,
  Unplug,
  Wrench,
  X,
} from "lucide-react";
import { useStore } from "@/store/useStore";
import type { McpAuthType, McpServer } from "@/types";
import {
  MCP_AUTH_TYPES,
  createMcpServer,
  deleteMcpServer,
  disconnectMcpOAuth,
  discoverMcpOAuth,
  fetchMcpServerTools,
  fetchMcpServers,
  pollMcpConnected,
  startMcpOAuth,
  testMcpServer,
  updateMcpServer,
  validateMcpServer,
  type McpOAuthDiscovery,
  type McpServerInput,
} from "@/lib/mcp";
import { Modal } from "@/components/ui/Modal";
import {
  Button,
  EmptyState,
  Field,
  PanelHeader,
  TextArea,
  TextInput,
} from "@/components/ui/primitives";
import { cn } from "@/utils/cn";

const STATUS_STYLE: Record<McpServer["status"], { label: string; cls: string }> = {
  connected: { label: "Connected", cls: "bg-emerald-500/15 text-emerald-600" },
  connecting: { label: "Connecting", cls: "bg-amber-500/15 text-amber-600" },
  error: { label: "Error", cls: "bg-red-500/15 text-red-500" },
  auth_required: { label: "Auth required", cls: "bg-amber-500/15 text-amber-600" },
  disconnected: { label: "Not connected", cls: "bg-[var(--chip)] text-[var(--muted)]" },
};

const AUTH_ICON: Record<McpAuthType, typeof Plug> = {
  none: Globe,
  oauth: ShieldCheck,
};

const LOCAL_JSON_TEMPLATE = `{
  "command": "npx",
  "args": ["-y", "@modelcontextprotocol/server-everything"],
  "env": {}
}`;

/**
 * MCP servers page.
 *
 * Two ways to add a server:
 *  - Remote: a Streamable HTTP endpoint (https://…/mcp) with no-auth or
 *    OAuth (auto-discovered authorization URL, browser flow with
 *    a configurable frontend landing URL).
 *  - Local: pasted MCP JSON ({ command, args, env }) spawned over stdio.
 *
 * Remote no-auth servers are connection-tested before saving and tested again
 * right after saving so the card shows live status + tools without a manual
 * Test. OAuth servers save first, then Connect to authorize. Once connected,
 * every server tool is a native agent tool (main, custom,
 * sub-agents, teams, CEO). Cards show live status, the tool catalog with
 * per-tool switches, and server enable/edit/delete actions.
 */
export function McpPanel() {
  const mcpServers = useStore((s) => s.mcpServers);
  const setMcpServers = useStore((s) => s.setMcpServers);
  const removeMcpServer = useStore((s) => s.removeMcpServer);
  const upsertMcpServer = useStore((s) => s.upsertMcpServer);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [form, setForm] = useState<"remote" | "local" | null>(null);
  const [editing, setEditing] = useState<McpServer | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const reload = async () => {
    try {
      const servers = await fetchMcpServers();
      setMcpServers(servers);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setLoading(true);
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const test = async (id: string) => {
    setBusyId(id);
    setError(null);
    try {
      const result = await testMcpServer(id);
      upsertMcpServer(result.server);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      await reload();
    } finally {
      setBusyId(null);
    }
  };

  const connectOAuth = async (server: McpServer) => {
    setBusyId(server.id);
    setError(null);
    try {
      const frontendUrl =
        server.frontendUrl?.trim() ||
        (typeof window !== "undefined" ? window.location.origin : "");
      // The provider redirects back to this app (?mcp_oauth=1&code=…&state=…),
      // which completes the exchange automatically. Polling here also picks up
      // the connected status for this tab.
      const started = await startMcpOAuth(server.id, { frontendUrl });
      window.open(started.auth_url, "_blank", "noopener,noreferrer");
      const final = await pollMcpConnected(server.id);
      if (final !== "connected") {
        setError(
          final === "auth_required"
            ? "Authorization did not complete — the server still needs OAuth."
            : "The server did not connect. Check its status on the card.",
        );
      }
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  };

  const disconnectOAuth = async (server: McpServer) => {
    setBusyId(server.id);
    try {
      await disconnectMcpOAuth(server.id);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (id: string) => {
    setBusyId(id);
    try {
      await deleteMcpServer(id);
      removeMcpServer(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
      setConfirmId(null);
    }
  };

  const filtered = (() => {
    const q = query.trim().toLowerCase();
    if (!q) return mcpServers;
    return mcpServers.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q) ||
        s.url.toLowerCase().includes(q),
    );
  })();

  const connectedCount = mcpServers.filter((s) => s.status === "connected").length;

  return (
    <div className="mx-auto w-full max-w-2xl panel-in">
      <div className="flex items-end justify-between gap-3">
        <PanelHeader kicker="Tools beyond the workspace" title="MCP servers" />
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setForm("local")}>
            <SquareTerminal className="h-4 w-4" /> Add local
          </Button>
          <Button onClick={() => setForm("remote")}>
            <Plus className="h-4 w-4" /> Add remote
          </Button>
        </div>
      </div>

      <p className="mb-4 text-sm leading-relaxed text-[var(--muted)]">
        Connect a Model Context Protocol server once — every one of its tools becomes a native
        agent tool (main agent, custom agents, sub-agents, teams, and CEO). Add a remote
        Streamable HTTP endpoint or paste a local server&apos;s JSON.
      </p>

      <div className="mb-4 flex items-center gap-2 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg)] px-3 py-2">
        <Search className="h-4 w-4 shrink-0 text-[var(--subtle)]" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search MCP servers…"
          aria-label="Search MCP servers"
          className="w-full bg-transparent text-sm text-[var(--fg)] outline-none placeholder:text-[var(--subtle)]"
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery("")}
            aria-label="Clear search"
            className="text-[var(--subtle)] hover:text-[var(--fg)]"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-12 text-sm text-[var(--muted)]">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading MCP servers…
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState icon={<Server className="h-8 w-8" />}>
          {mcpServers.length === 0
            ? "No MCP servers yet. Add a remote endpoint or paste a local server's JSON."
            : `No MCP servers match “${query}”.`}
        </EmptyState>
      ) : (
        <ul className="m-0 grid list-none grid-cols-1 gap-3 p-0">
          {filtered.map((server) => (
            <McpCard
              key={server.id}
              server={server}
              busy={busyId === server.id}
              onTest={() => void test(server.id)}
              onConnect={() => void connectOAuth(server)}
              onDisconnectOAuth={() => void disconnectOAuth(server)}
              onEdit={() => setEditing(server)}
              onDelete={() => setConfirmId(server.id)}
            />
          ))}
        </ul>
      )}

      {!loading && (
        <p className="mt-4 text-xs text-[var(--subtle)]">
          {connectedCount} of {mcpServers.length} connected
          {connectedCount > 0 && " — connected servers serve tools to the agent right now"}.
        </p>
      )}

      {error && <p className="mt-3 text-xs text-[var(--danger)]">{error}</p>}

      {form && (
        <McpCreateModal
          kind={form}
          onClose={() => setForm(null)}
          onSaved={(server) => {
            upsertMcpServer(server);
            setForm(null);
          }}
        />
      )}

      {editing && (
        <McpEditModal
          server={editing}
          onClose={() => setEditing(null)}
          onSaved={(server) => {
            upsertMcpServer(server);
            setEditing(null);
          }}
        />
      )}

      <Modal
        open={confirmId !== null}
        onClose={() => setConfirmId(null)}
        icon={<Unplug className="h-4 w-4" />}
        title="Delete MCP server?"
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmId(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() => confirmId && void remove(confirmId)}
              disabled={busyId !== null}
            >
              Delete
            </Button>
          </>
        }
      >
        <p className="m-0 p-5 text-sm text-[var(--muted)]">
          The agent will immediately lose access to this server&apos;s tools. Local processes are
          stopped. You can re-add it anytime.
        </p>
      </Modal>
    </div>
  );
}

function McpCard({
  server,
  busy,
  onTest,
  onConnect,
  onDisconnectOAuth,
  onEdit,
  onDelete,
}: {
  server: McpServer;
  busy: boolean;
  onTest: () => void;
  onConnect: () => void;
  onDisconnectOAuth: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const setMcpServerEnabled = useStore((s) => s.setMcpServerEnabled);
  const setMcpToolEnabled = useStore((s) => s.setMcpToolEnabled);
  const upsertMcpServer = useStore((s) => s.upsertMcpServer);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [toolsError, setToolsError] = useState<string | null>(null);

  const style = STATUS_STYLE[server.status];
  const connected = server.status === "connected";
  const needsAuth = server.status === "auth_required";
  const AuthIcon = AUTH_ICON[server.authType] ?? Plug;
  const enabledTools = server.cachedTools.filter((t) => !server.disabledTools.includes(t.name));

  const refreshTools = async () => {
    setRefreshing(true);
    setToolsError(null);
    try {
      const tools = await fetchMcpServerTools(server.id);
      // Refresh the whole card from the backend (status + cached catalog).
      const servers = await fetchMcpServers();
      const updated = servers.find((s) => s.id === server.id);
      if (updated) upsertMcpServer(updated);
      else setToolsError(`Listed ${tools.length} tool(s).`);
    } catch (e) {
      setToolsError(e instanceof Error ? e.message : String(e));
    } finally {
      setRefreshing(false);
    }
  };

  const persistToggle = async (enabled: boolean) => {
    setMcpServerEnabled(server.id, enabled);
    try {
      const updated = await updateMcpServer(server.id, { enabled });
      upsertMcpServer(updated);
    } catch {
      setMcpServerEnabled(server.id, server.enabled);
    }
  };

  const persistToolToggle = async (tool: string, enabled: boolean) => {
    setMcpToolEnabled(server.id, tool, enabled);
    try {
      const next = new Set(server.disabledTools);
      if (enabled) next.delete(tool);
      else next.add(tool);
      const updated = await updateMcpServer(server.id, { disabledTools: [...next] });
      upsertMcpServer(updated);
    } catch {
      setMcpToolEnabled(server.id, tool, !enabled);
    }
  };

  return (
    <li>
      <article
        className={cn(
          "flex h-full flex-col rounded-[var(--radius-xl)] bg-[var(--bg)] p-5",
          connected && "ring-1 ring-[var(--secondary)]",
        )}
        style={{ boxShadow: "var(--shadow-chip)" }}
      >
        <div className="flex items-start gap-3">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-[var(--radius-md)] bg-[var(--secondary)] text-[var(--secondary-fg)]">
            {server.kind === "local" ? (
              <SquareTerminal className="h-5 w-5" />
            ) : (
              <Server className="h-5 w-5" />
            )}
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="m-0 truncate text-base font-semibold text-[var(--fg)]">{server.name}</h3>
            <p className="m-0 mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-[var(--subtle)]">
              <span className="rounded-full border border-[var(--border)] px-1.5 py-0.5">
                {server.kind === "local" ? "local · stdio" : "remote · http"}
              </span>
              <span className="inline-flex items-center gap-1 rounded-full border border-[var(--border)] px-1.5 py-0.5">
                <AuthIcon className="h-2.5 w-2.5" />
                {MCP_AUTH_TYPES.find((a) => a.id === server.authType)?.name ?? server.authType}
              </span>
            </p>
            {server.description && (
              <p className="m-0 mt-1.5 line-clamp-2 text-[13px] leading-relaxed text-[var(--muted)]">
                {server.description}
              </p>
            )}
            <p className="m-0 mt-1 truncate font-mono text-[11px] text-[var(--subtle)]">
              {server.kind === "local"
                ? `${server.local?.command ?? ""} ${(server.local?.args ?? []).join(" ")}`.trim() || "local server"
                : server.url}
            </p>
          </div>
          <span
            className={cn(
              "inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium",
              style.cls,
            )}
          >
            {(server.status === "connecting" || busy) && <Loader2 className="h-3 w-3 animate-spin" />}
            {connected && <Check className="h-3 w-3" />}
            {style.label}
          </span>
        </div>

        {server.lastError && (
          <p className="m-0 mt-2 rounded-[var(--radius-md)] bg-[var(--danger-soft)] px-3 py-2 text-xs text-[var(--danger)]">
            {server.lastError}
          </p>
        )}

        {/* Tools served right now + per-tool switches */}
        <button
          type="button"
          onClick={() => setToolsOpen((v) => !v)}
          className="mt-3 flex w-full items-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--border)] px-3 py-2 text-left text-xs font-medium text-[var(--fg)] hover:border-[var(--secondary)]"
        >
          <Wrench className="h-3.5 w-3.5 text-[var(--muted)]" />
          Tools · {enabledTools.length} on
          {server.disabledTools.length > 0 ? ` · ${server.disabledTools.length} off` : ""}
          <ChevronDown className={cn("ml-auto h-3.5 w-3.5 transition-transform", toolsOpen && "rotate-180")} />
        </button>

        {toolsOpen && (
          <div className="mt-2 rounded-[var(--radius-md)] border border-[var(--border)] p-2">
            <div className="mb-1.5 flex items-center justify-between px-1">
              <span className="text-[10px] uppercase tracking-wide text-[var(--subtle)]">
                {server.cachedTools.length} discovered
              </span>
              <button
                type="button"
                onClick={() => void refreshTools()}
                disabled={refreshing}
                className="inline-flex items-center gap-1 text-[10px] text-[var(--muted)] hover:text-[var(--fg)] disabled:opacity-50"
              >
                <RefreshCw className={cn("h-3 w-3", refreshing && "animate-spin")} />
                Refresh
              </button>
            </div>
            {toolsError && <p className="px-1 text-[11px] text-[var(--danger)]">{toolsError}</p>}
            {server.cachedTools.length === 0 ? (
              <p className="px-1 py-2 text-xs text-[var(--muted)]">
                No tools discovered yet — press Test below to connect and list them.
              </p>
            ) : (
              <ul className="max-h-52 space-y-0.5 overflow-auto">
                {server.cachedTools.map((t) => {
                  const on = !server.disabledTools.includes(t.name);
                  return (
                    <li
                      key={t.name}
                      className="flex items-start gap-2 rounded-[var(--radius-sm)] px-2 py-1.5 hover:bg-[var(--chip)]"
                    >
                      <button
                        type="button"
                        role="switch"
                        aria-checked={on}
                        aria-label={`${on ? "Disable" : "Enable"} ${t.name}`}
                        onClick={() => void persistToolToggle(t.name, !on)}
                        className={cn(
                          "relative mt-0.5 inline-flex h-4 w-7 shrink-0 items-center rounded-full transition-colors",
                          on ? "bg-[var(--secondary)]" : "bg-[var(--border)]",
                        )}
                      >
                        <span
                          className={cn(
                            "inline-block h-3 w-3 rounded-full bg-white transition-transform",
                            on ? "translate-x-[14px]" : "translate-x-[2px]",
                          )}
                        />
                      </button>
                      <span className="min-w-0">
                        <span className="block truncate font-mono text-xs font-medium text-[var(--fg)]">
                          {t.name}
                        </span>
                        {t.description && (
                          <span className="block truncate text-[10px] text-[var(--subtle)]">
                            {t.description}
                          </span>
                        )}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-[var(--border)] pt-3">
          <button
            type="button"
            role="switch"
            aria-checked={server.enabled}
            aria-label={server.enabled ? "Disable server" : "Enable server"}
            onClick={() => void persistToggle(!server.enabled)}
            className={cn(
              "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors",
              server.enabled ? "bg-[var(--secondary)]" : "bg-[var(--border)]",
            )}
          >
            <span
              className={cn(
                "inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform",
                server.enabled ? "translate-x-[18px]" : "translate-x-[3px]",
              )}
            />
          </button>
          <span className="text-xs text-[var(--muted)]">{server.enabled ? "Enabled" : "Disabled"}</span>

          <span className="ml-auto flex items-center gap-1.5">
            {server.authType === "oauth" && !server.oauth?.connected && (
              <Button onClick={onConnect} disabled={busy} className="px-3 py-1.5 text-xs">
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PlugZap className="h-3.5 w-3.5" />}
                Connect
              </Button>
            )}
            {server.authType === "oauth" && server.oauth?.connected && (
              <Button variant="ghost" onClick={onDisconnectOAuth} disabled={busy} className="px-2 py-1.5 text-xs">
                <Unplug className="h-3.5 w-3.5" /> Disconnect
              </Button>
            )}
            <Button variant="outline" onClick={onTest} disabled={busy} className="px-3 py-1.5 text-xs">
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              Test
            </Button>
            <button
              onClick={onEdit}
              title="Edit"
              className="grid h-8 w-8 place-items-center rounded-[var(--radius-md)] text-[var(--subtle)] hover:bg-[var(--chip)] hover:text-[var(--fg)]"
            >
              <Pencil className="h-4 w-4" />
            </button>
            <button
              onClick={onDelete}
              title="Delete"
              className="grid h-8 w-8 place-items-center rounded-[var(--radius-md)] text-[var(--subtle)] hover:text-[var(--danger)]"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </span>
        </div>
        {needsAuth && (
          <p className="m-0 mt-2 text-[11px] leading-relaxed text-[var(--warning)]">
            This server needs OAuth — press Connect to authorize in your browser (no API key needed).
          </p>
        )}
      </article>
    </li>
  );
}

interface OAuthDraft {
  discovery: McpOAuthDiscovery | null;
  discovering: boolean;
  clientId: string;
  clientSecret: string;
  scopes: string;
}

/**
 * Shared OAuth editor: discovery, redirect-mode selection, the exact redirect
 * URI to allowlist at the provider, client credentials, scopes, and the
 * frontend landing URL. Used by both the create and edit modals.
 */
function OAuthSection({
  url,
  frontendUrl,
  setFrontendUrl,
  oauth,
  setOauth,
  setError,
}: {
  url: string;
  frontendUrl: string;
  setFrontendUrl: (v: string) => void;
  oauth: OAuthDraft;
  setOauth: (f: (o: OAuthDraft) => OAuthDraft) => void;
  setError: (e: string | null) => void;
}) {
  const discover = async () => {
    if (!url.trim()) {
      setError("Enter the MCP server URL first.");
      return;
    }
    setOauth((o) => ({ ...o, discovering: true }));
    setError(null);
    try {
      const discovery = await discoverMcpOAuth(url.trim());
      setOauth((o) => ({
        ...o,
        discovery,
        discovering: false,
        scopes: o.scopes || discovery.scopes.join(" "),
      }));
    } catch (e) {
      setOauth((o) => ({ ...o, discovering: false }));
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const frontendRedirect = (() => {
    const base = frontendUrl.trim().replace(/\/+$/, "");
    if (!base) return "";
    return base.includes("?") ? `${base}&mcp_oauth=1` : `${base}?mcp_oauth=1`;
  })();
  const allowlistUri = frontendRedirect;

  return (
    <div className="space-y-3 rounded-[var(--radius-md)] border border-[var(--border)] p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-[var(--muted)]">
          OAuth discovery — finds the server&apos;s authorization URL
        </span>
        <Button variant="outline" onClick={() => void discover()} disabled={oauth.discovering} className="px-2.5 py-1.5 text-xs">
          {oauth.discovering ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <ShieldCheck className="h-3.5 w-3.5" />
          )}
          Discover
        </Button>
      </div>
      {oauth.discovery ? (
        <div className="space-y-1.5 rounded-[var(--radius-sm)] bg-[var(--chip)] p-2.5 text-xs">
          <p className="m-0 flex items-center gap-1.5 text-[var(--success)]">
            <Check className="h-3.5 w-3.5" /> Found authorization server
          </p>
          <p className="m-0 truncate font-mono text-[var(--muted)]">
            {oauth.discovery.authorization_server}
          </p>
          <p className="m-0 text-[var(--muted)]">
            {oauth.discovery.supports_dynamic_registration
              ? "Supports one-click registration — no client ID needed."
              : "Needs a pre-registered client ID below."}
          </p>
          {oauth.discovery.scopes.length > 0 && (
            <p className="m-0 text-[var(--muted)]">
              Suggested scopes: {oauth.discovery.scopes.join(", ")}
            </p>
          )}
        </div>
      ) : (
        <p className="m-0 text-xs text-[var(--muted)]">
          Discovers <span className="font-mono">/.well-known/oauth-protected-resource</span>{" "}
          (and the 401 hint) to find where to authorize. No API key needed.
        </p>
      )}

      <div className="rounded-[var(--radius-sm)] bg-[var(--chip)] p-2.5">
        <p className="m-0 text-[10px] font-semibold uppercase tracking-wide text-[var(--subtle)]">
          Register this exact redirect URI at your provider
        </p>
        <p className="m-0 mt-1 break-all font-mono text-xs text-[var(--fg)]">
          {allowlistUri || "Enter your frontend URL below"}
        </p>
        <p className="m-0 mt-1 text-[10px] leading-relaxed text-[var(--subtle)]">
          The provider redirects back to this app URL, which finishes the flow automatically.
          It must match what you allowlisted exactly — a mismatch is the classic
          “invalid redirect_uri” failure.
        </p>
      </div>

      <Field label="Client ID (optional)" hint="for servers without one-click registration">
        <TextInput
          value={oauth.clientId}
          onChange={(e) => setOauth((o) => ({ ...o, clientId: e.target.value }))}
          placeholder="Pre-registered OAuth client ID"
          className="font-mono text-xs"
        />
      </Field>
      <Field label="Client secret (optional)" hint="confidential clients only">
        <TextInput
          type="password"
          value={oauth.clientSecret}
          onChange={(e) => setOauth((o) => ({ ...o, clientSecret: e.target.value }))}
          placeholder="Pre-registered client secret"
          className="font-mono text-xs"
        />
      </Field>
      <Field label="Scopes (optional)" hint="space or comma separated">
        <TextInput
          value={oauth.scopes}
          onChange={(e) => setOauth((o) => ({ ...o, scopes: e.target.value }))}
          placeholder="e.g. read write"
          className="font-mono text-xs"
        />
      </Field>
      <Field
        label="Frontend URL"
        hint="auto-detected — override for cloud setups"
      >
        <TextInput
          value={frontendUrl}
          onChange={(e) => setFrontendUrl(e.target.value)}
          placeholder={typeof window !== "undefined" ? window.location.origin : "https://…"}
          className="font-mono text-xs"
        />
      </Field>
      <p className="m-0 text-[11px] leading-relaxed text-[var(--subtle)]">
        After saving, press Connect on the card: your browser opens the authorization page,
        then lands back in this app to finish.
      </p>
    </div>
  );
}

function McpCreateModal({
  kind,
  onClose,
  onSaved,
}: {
  kind: "remote" | "local";
  onClose: () => void;
  onSaved: (server: McpServer) => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [url, setUrl] = useState("");
  const [authType, setAuthType] = useState<McpAuthType>("none");
  const [json, setJson] = useState(LOCAL_JSON_TEMPLATE);
  const [frontendUrl, setFrontendUrl] = useState(
    typeof window !== "undefined" ? window.location.origin : "",
  );
  const [oauth, setOauth] = useState<{
    discovery: McpOAuthDiscovery | null;
    discovering: boolean;
    clientId: string;
    clientSecret: string;
    scopes: string;
  }>({ discovery: null, discovering: false, clientId: "", clientSecret: "", scopes: "" });
  const [saving, setSaving] = useState(false);
  /** Save runs in two visible phases: testing the connection, then saving. */
  const [phase, setPhase] = useState<"idle" | "testing" | "saving">("idle");
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    if (!name.trim()) {
      setError("A server name is required.");
      return;
    }
    if (kind === "remote" && !url.trim()) {
      setError("The MCP server URL is required (e.g. https://example-server.modelcontextprotocol.io/mcp).");
      return;
    }
    if (kind === "local" && !json.trim()) {
      setError("Paste the MCP server JSON first.");
      return;
    }
    // OAuth servers save first, then Connect to authorize — they cannot be
    // tested before saving. Every other server is tested before it is saved.
    const shouldPreTest = kind === "local" || (kind === "remote" && authType !== "oauth");
    setSaving(true);
    setError(null);
    setPhase(shouldPreTest ? "testing" : "saving");
    try {
      const input: McpServerInput = {
        name: name.trim(),
        description: description.trim(),
        kind,
        ...(kind === "remote" ? { url: url.trim() } : { json }),
        authType: kind === "remote" ? authType : "none",
        ...(authType === "oauth" && kind === "remote"
          ? {
              oauth: {
                ...(oauth.discovery ? { authorizationServer: oauth.discovery.authorization_server } : {}),
                scopes: oauth.scopes.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean),
                ...(oauth.clientId.trim() ? { clientId: oauth.clientId.trim() } : {}),
                ...(oauth.clientSecret.trim() ? { clientSecret: oauth.clientSecret.trim() } : {}),
                ...(oauth.discovery
                  ? {
                      authorizationEndpoint: oauth.discovery.authorization_endpoint,
                      tokenEndpoint: oauth.discovery.token_endpoint,
                      ...(oauth.discovery.registration_endpoint
                        ? { registrationEndpoint: oauth.discovery.registration_endpoint }
                        : {}),
                    }
                  : {}),
              },
              ...(frontendUrl.trim() ? { frontendUrl: frontendUrl.trim() } : {}),
            }
          : {}),
      };
      // Local servers and remote no-auth servers are tested BEFORE saving: the
      // connection is dialed and its tools listed, and the server is only
      // persisted when that succeeds.
      if (shouldPreTest) {
        const validated = await validateMcpServer(input);
        if (validated.count === 0) {
          throw new Error("The server connected but exposed no tools. Check its configuration.");
        }
        setPhase("saving");
      }
      const server = await createMcpServer(input);
      // Newly saved local servers and remote no-auth servers are tested again
      // immediately so the card shows live status + tools without a manual Test.
      // OAuth servers skip this — they connect via the Connect (browser) flow.
      if (shouldPreTest) {
        try {
          const tested = await testMcpServer(server.id);
          onSaved(tested.server);
          return;
        } catch {
          // Saved fine — the card's Test button can retry the connection.
        }
      }
      onSaved(server);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
      setPhase("idle");
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      icon={kind === "local" ? <SquareTerminal className="h-4 w-4" /> : <Server className="h-4 w-4" />}
      title={kind === "local" ? "Add local MCP server" : "Add remote MCP server"}
      size="lg"
      footer={
        <Button onClick={() => void save()} disabled={saving}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
          {phase === "testing" ? "Testing connection…" : saving ? "Saving…" : "Save server"}
        </Button>
      }
    >
      <div className="space-y-4 p-5">
        <Field label="Server name *">
          <TextInput
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={kind === "local" ? "e.g. Filesystem" : "e.g. Example MCP"}
          />
        </Field>
        <Field label="Description (optional)">
          <TextArea
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What does this server provide?"
          />
        </Field>

        {kind === "remote" ? (
          <>
            <Field label="MCP server URL *" hint="Streamable HTTP endpoint">
              <TextInput
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://example-server.modelcontextprotocol.io/mcp"
                className="font-mono text-xs"
              />
            </Field>

            <Field label="Authentication">
              <div className="grid grid-cols-2 gap-1.5 max-[520px]:grid-cols-1">
                {MCP_AUTH_TYPES.map((a) => {
                  const Icon = AUTH_ICON[a.id] ?? Plug;
                  const active = authType === a.id;
                  return (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => setAuthType(a.id)}
                      aria-pressed={active}
                      className={cn(
                        "flex items-start gap-2 rounded-[var(--radius-md)] border p-2.5 text-left transition-colors",
                        active
                          ? "border-[var(--secondary)] bg-[var(--chip)]"
                          : "border-[var(--border)] hover:border-[var(--secondary)]",
                      )}
                    >
                      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-[var(--secondary)]" />
                      <span>
                        <span className="block text-xs font-medium text-[var(--fg)]">{a.name}</span>
                        <span className="block text-[10px] text-[var(--subtle)]">{a.description}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </Field>

            {authType === "oauth" && (
              <OAuthSection
                url={url}
                frontendUrl={frontendUrl}
                setFrontendUrl={setFrontendUrl}
                oauth={oauth}
                setOauth={setOauth}
                setError={setError}
              />
            )}
          </>
        ) : (
          <>
            <Field
              label="MCP server JSON *"
              hint="Claude-style { command, args, env } or { mcpServers: { … } }"
            >
              <TextArea
                rows={10}
                value={json}
                onChange={(e) => setJson(e.target.value)}
                spellCheck={false}
                className="font-mono text-xs"
                placeholder={LOCAL_JSON_TEMPLATE}
              />
            </Field>
            <p className="m-0 text-[11px] leading-relaxed text-[var(--subtle)]">
              The backend spawns this command over stdio (working directory: the agent workspace).
              Environment values stay server-side. Saving tests the connection first — the server
              is only kept when it connects and lists tools.
            </p>
          </>
        )}

        {error && <p className="m-0 text-xs text-[var(--danger)]">{error}</p>}
      </div>
    </Modal>
  );
}

function McpEditModal({
  server,
  onClose,
  onSaved,
}: {
  server: McpServer;
  onClose: () => void;
  onSaved: (server: McpServer) => void;
}) {
  const [name, setName] = useState(server.name);
  const [description, setDescription] = useState(server.description);
  const [url, setUrl] = useState(server.url);
  const [frontendUrl, setFrontendUrl] = useState(server.frontendUrl ?? "");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [oauthScopes, setOauthScopes] = useState(server.oauth?.scopes.join(" ") ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    if (!name.trim()) {
      setError("A server name is required.");
      return;
    }
    if (server.kind === "remote" && !url.trim()) {
      setError("The MCP server URL is required.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const hasCredentials =
        server.authType === "oauth" &&
        Boolean(clientId.trim() || clientSecret.trim() || oauthScopes.trim());
      const updated = await updateMcpServer(server.id, {
        name: name.trim(),
        description: description.trim(),
        ...(server.kind === "remote" ? { url: url.trim() } : {}),
        ...(server.kind === "remote" ? { frontendUrl: frontendUrl.trim() || undefined } : {}),
        ...(hasCredentials
          ? {
              oauth: {
                ...(clientId.trim() ? { clientId: clientId.trim() } : {}),
                ...(clientSecret.trim() ? { clientSecret: clientSecret.trim() } : {}),
                ...(oauthScopes.trim()
                  ? { scopes: oauthScopes.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean) }
                  : {}),
              },
            }
          : {}),
      });
      onSaved(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      icon={<Pencil className="h-4 w-4" />}
      title={`Edit — ${server.name}`}
      size="lg"
      footer={
        <Button onClick={() => void save()} disabled={saving}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
          {saving ? "Saving…" : "Save"}
        </Button>
      }
    >
      <div className="space-y-4 p-5">
        <Field label="Server name *">
          <TextInput value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Description">
          <TextArea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        {server.kind === "remote" && (
          <Field label="MCP server URL *">
            <TextInput
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              className="font-mono text-xs"
            />
          </Field>
        )}
        {server.kind === "local" && server.local && (
          <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--chip)] p-3 font-mono text-xs text-[var(--muted)]">
            {server.local.command} {(server.local.args ?? []).join(" ")}
          </div>
        )}
        {server.authType === "oauth" && (
          <>
            <div className="flex items-center gap-2 text-xs text-[var(--muted)]">
              <ShieldCheck className="h-3.5 w-3.5" />
              {server.oauth?.connected ? "Authorization active." : "Not authorized yet — press Connect on the card."}
            </div>
            <OAuthSection
              url={server.url}
              frontendUrl={frontendUrl}
              setFrontendUrl={setFrontendUrl}
              oauth={{
                discovery: null,
                discovering: false,
                clientId,
                clientSecret,
                scopes: oauthScopes,
              }}
              setOauth={(f) => {
                const next = f({ discovery: null, discovering: false, clientId, clientSecret, scopes: oauthScopes });
                setClientId(next.clientId);
                setClientSecret(next.clientSecret);
                setOauthScopes(next.scopes);
              }}
              setError={setError}
            />
          </>
        )}
        {error && <p className="m-0 text-xs text-[var(--danger)]">{error}</p>}
      </div>
    </Modal>
  );
}
