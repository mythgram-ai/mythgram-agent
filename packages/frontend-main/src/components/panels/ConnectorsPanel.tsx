import { useEffect, useMemo, useState } from "react";
import {
  Check,
  ExternalLink,
  Loader2,
  Plug,
  PlugZap,
  Search,
  Settings2,
  Unplug,
  X,
} from "lucide-react";
import { useStore } from "@/store/useStore";
import type { ConnectorOverviewItem, ConnectorStatus } from "@/types";
import {
  AVAILABLE_CONNECTORS,
  connectorLogo,
  disconnectConnector,
  fetchConnectorsOverview,
  pollConnectorActive,
  refreshConnectors,
  startConnectorConnect,
  type ConnectorMeta,
} from "@/lib/connectors";
import { Modal } from "@/components/ui/Modal";
import { Button, EmptyState, PanelHeader } from "@/components/ui/primitives";
import { cn } from "@/utils/cn";

const STATUS_STYLE: Record<ConnectorStatus, { label: string; cls: string }> = {
  active: { label: "Connected", cls: "bg-emerald-500/15 text-emerald-600" },
  pending: { label: "Awaiting auth", cls: "bg-amber-500/15 text-amber-600" },
  failed: { label: "Failed", cls: "bg-red-500/15 text-red-500" },
  disconnected: { label: "Not connected", cls: "bg-[var(--chip)] text-[var(--muted)]" },
};

/**
 * Connectors page.
 *
 * Lists the available third-party app integrations (GitHub, Slack, Notion, Gmail,
 * Outlook) with their official logos. Connecting opens the app's OAuth page (via
 * Composio) in a new tab; this page polls until the connection is active. Once a
 * connector is connected, every one of its tools is available to the agent
 * (main, custom, sub-agents, teams, CEO) as native function calls.
 */
export function ConnectorsPanel() {
  const setSettingsOpen = useStore((s) => s.setSettingsOpen);
  const setConnector = useStore((s) => s.setConnector);
  const removeConnector = useStore((s) => s.removeConnector);
  const setConnectors = useStore((s) => s.setConnectors);

  const [items, setItems] = useState<ConnectorOverviewItem[]>([]);
  const [configured, setConfigured] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const reload = async () => {
    try {
      const overview = await fetchConnectorsOverview();
      setConfigured(overview.configured);
      setItems(overview.connectors);
      setError(null);
      // Mirror the backend truth into the synced store slice (drives chat turns).
      setConnectors(
        overview.connectors
          .filter((c) => c.status === "active" || c.status === "pending" || c.status === "failed")
          .map((c) => ({
            connectorId: c.id,
            connectedAccountId: c.connected_account_id ?? "",
            status: c.status === "disconnected" ? "pending" : c.status,
            accountLabel: c.account_label ?? "",
            updatedAt: c.updated_at ?? Date.now(),
          }))
          .filter((c) => c.connectedAccountId.length > 0),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  // On open: heal stale states server-side, then load the overview.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void (async () => {
      await refreshConnectors();
      if (!cancelled) await reload();
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const connect = async (id: string) => {
    setBusyId(id);
    setError(null);
    try {
      const started = await startConnectorConnect(id);
      // Track the pending connection immediately so a refresh never loses it.
      setConnector({
        connectorId: id,
        connectedAccountId: started.connected_account_id,
        status: "pending",
        accountLabel: "",
        updatedAt: Date.now(),
      });
      // The user authorizes the app in the opened tab; poll until it resolves.
      window.open(started.redirect_url, "_blank", "noopener,noreferrer");
      const final = await pollConnectorActive(started.connected_account_id);
      setConnector({
        connectorId: id,
        connectedAccountId: started.connected_account_id,
        status: final === "active" ? "active" : "failed",
        accountLabel: "",
        updatedAt: Date.now(),
      });
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  };

  const disconnect = async (id: string) => {
    setBusyId(id);
    try {
      await disconnectConnector(id);
      removeConnector(id);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
      setConfirmId(null);
    }
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const byId = new Map(items.map((i) => [i.id, i]));
    const all = AVAILABLE_CONNECTORS.map((meta) => ({ meta, live: byId.get(meta.id) ?? null }));
    if (!q) return all;
    return all.filter(
      ({ meta, live }) =>
        meta.name.toLowerCase().includes(q) ||
        meta.description.toLowerCase().includes(q) ||
        (live?.account_label ?? "").toLowerCase().includes(q),
    );
  }, [items, query]);

  const activeCount = items.filter((i) => i.status === "active").length;

  return (
    <div className="mx-auto w-full max-w-2xl panel-in">
      <PanelHeader kicker="Apps the agent can use" title="Connectors" />
      <p className="mb-4 text-sm leading-relaxed text-[var(--muted)]">
        Connect an app once — the agent can then use every one of its tools directly
        (read and write) as native function calls, in any chat.
      </p>

      {!loading && !configured && (
        <div className="mb-4 flex items-start gap-2 rounded-[var(--radius-md)] border border-[color:color-mix(in_oklab,var(--warning)_35%,transparent)] bg-[var(--warning-soft)] p-3 text-sm">
          <Settings2 className="mt-0.5 h-4 w-4 shrink-0 text-[var(--warning)]" />
          <div className="flex-1">
            <p className="m-0 text-[var(--fg)]">Add your Composio API key to enable connectors.</p>
            <p className="m-0 mt-0.5 text-xs text-[var(--muted)]">
              The key is stored with your settings and only ever sent to the backend.
            </p>
          </div>
          <Button variant="outline" onClick={() => setSettingsOpen(true)}>
            Open Settings
          </Button>
        </div>
      )}

      <div className="mb-4 flex items-center gap-2 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg)] px-3 py-2">
        <Search className="h-4 w-4 shrink-0 text-[var(--subtle)]" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search connectors…"
          aria-label="Search connectors"
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
          <Loader2 className="h-4 w-4 animate-spin" /> Loading connectors…
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState icon={<Plug className="h-8 w-8" />}>
          No connectors match “{query}”.
        </EmptyState>
      ) : (
        <ul className="m-0 grid list-none grid-cols-1 gap-3 p-0 sm:grid-cols-2">
          {filtered.map(({ meta, live }) => (
            <ConnectorCard
              key={meta.id}
              meta={meta}
              live={live}
              busy={busyId === meta.id}
              configured={configured}
              onConnect={() => void connect(meta.id)}
              onDisconnect={() => setConfirmId(meta.id)}
            />
          ))}
        </ul>
      )}

      {!loading && (
        <p className="mt-4 text-xs text-[var(--subtle)]">
          {activeCount} of {AVAILABLE_CONNECTORS.length} connected
          {activeCount > 0 && " — connected apps are available to the agent right now"}.
        </p>
      )}

      {error && <p className="mt-3 text-xs text-[var(--danger)]">{error}</p>}

      <Modal
        open={confirmId !== null}
        onClose={() => setConfirmId(null)}
        icon={<Unplug className="h-4 w-4" />}
        title="Disconnect app?"
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmId(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() => confirmId && void disconnect(confirmId)}
              disabled={busyId !== null}
            >
              Disconnect
            </Button>
          </>
        }
      >
        <p className="m-0 p-5 text-sm text-[var(--muted)]">
          The agent will immediately lose access to this app's tools. You can reconnect anytime.
        </p>
      </Modal>
    </div>
  );
}

function ConnectorCard({
  meta,
  live,
  busy,
  configured,
  onConnect,
  onDisconnect,
}: {
  meta: ConnectorMeta;
  live: ConnectorOverviewItem | null;
  busy: boolean;
  configured: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
}) {
  const status: ConnectorStatus = live?.status ?? "disconnected";
  const style = STATUS_STYLE[status];
  const connected = status === "active";
  const awaiting = status === "pending";

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
          <ConnectorLogo meta={meta} logoUrl={live?.logo_url} />
          <div className="min-w-0 flex-1">
            <h3 className="m-0 text-base font-semibold text-[var(--fg)]">{meta.name}</h3>
            <a
              href={meta.homepage}
              target="_blank"
              rel="noreferrer"
              className="mt-0.5 inline-flex items-center gap-1 text-[11px] text-[var(--subtle)] hover:text-[var(--secondary)]"
            >
              {meta.homepage.replace(/^https?:\/\//, "")}
              <ExternalLink className="h-2.5 w-2.5" />
            </a>
          </div>
          <span
            className={cn(
              "inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium",
              style.cls,
            )}
          >
            {(awaiting || busy) && <Loader2 className="h-3 w-3 animate-spin" />}
            {connected && <Check className="h-3 w-3" />}
            {style.label}
          </span>
        </div>

        <p className="m-0 mt-2 text-[13px] leading-relaxed text-[var(--muted)]">{meta.description}</p>

        {connected && live?.account_label && (
          <p className="m-0 mt-2 truncate font-mono text-[11px] text-[var(--subtle)]">
            {live.account_label}
          </p>
        )}
        {awaiting && (
          <p className="m-0 mt-2 text-[11px] leading-relaxed text-[var(--warning)]">
            Finish authorizing {meta.name} in the opened tab — this card updates automatically.
          </p>
        )}

        <div className="mt-4 flex items-center gap-2 border-t border-[var(--border)] pt-3">
          {connected ? (
            <Button
              variant="ghost"
              className="px-2 text-[var(--subtle)] hover:text-[var(--danger)]"
              onClick={onDisconnect}
              disabled={busy}
            >
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Unplug className="h-3.5 w-3.5" />}
              Remove
            </Button>
          ) : (
            <Button onClick={onConnect} disabled={busy || !configured} className="px-3">
              {busy ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : awaiting ? (
                <PlugZap className="h-3.5 w-3.5" />
              ) : (
                <Plug className="h-3.5 w-3.5" />
              )}
              {awaiting ? "Waiting for auth…" : status === "failed" ? "Reconnect" : "Connect"}
            </Button>
          )}
        </div>
      </article>
    </li>
  );
}

/** Official app logo (Composio artwork, else Simple-Icons), with a letter fallback. */
function ConnectorLogo({ meta, logoUrl }: { meta: ConnectorMeta; logoUrl?: string | null }) {
  const [failed, setFailed] = useState(false);
  const src = connectorLogo(meta, logoUrl);
  if (failed) {
    return (
      <span className="grid h-11 w-11 shrink-0 place-items-center rounded-[var(--radius-md)] bg-[var(--secondary)] text-lg font-semibold text-[var(--secondary-fg)]">
        {meta.name.slice(0, 1)}
      </span>
    );
  }
  return (
    <img
      key={src}
      src={src}
      alt={`${meta.name} logo`}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className="h-11 w-11 shrink-0 rounded-[var(--radius-md)] border border-[var(--border)] bg-white object-contain p-1.5"
    />
  );
}
