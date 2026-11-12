import { useEffect, useMemo, useState } from "react";
import {
  Check,
  ExternalLink,
  KeyRound,
  Loader2,
  Plug,
  PlugZap,
  Search,
  Unplug,
  X,
} from "lucide-react";
import { useStore } from "@/store/useStore";
import type { ConnectorOverviewItem, ConnectorStatus } from "@/types";
import {
  connectorLogo,
  disconnectConnector,
  fetchConnectorsOverview,
  pollConnectorActive,
  refreshConnectors,
  startConnectorConnect,
  validateComposioKey,
} from "@/lib/connectors";
import { saveStateKey } from "@/lib/backendState";
import { Modal } from "@/components/ui/Modal";
import { Button, EmptyState, PanelHeader, TextInput } from "@/components/ui/primitives";
import { cn } from "@/utils/cn";
import { ConnectorsIcon } from "@/components/icons/NavIcons";

const STATUS_STYLE: Record<ConnectorStatus, { label: string; cls: string }> = {
  active: { label: "Connected", cls: "bg-emerald-500/15 text-emerald-600" },
  pending: { label: "Awaiting auth", cls: "bg-amber-500/15 text-amber-600" },
  failed: { label: "Failed", cls: "bg-red-500/15 text-red-500" },
  disconnected: { label: "Not connected", cls: "bg-[var(--chip)] text-[var(--muted)]" },
};

/** The Zapier MCP notice shown at the top of the page. */
const ZAPPER_NOTICE_URL = "https://zapier.com/mcp";
const ZAPPER_LOGO_URL = "https://cdn.simpleicons.org/zapier";

/**
 * Connectors page.
 *
 * Lists the OAuth-capable app integrations, fetched LIVE from Composio (the backend lists the
 * project's toolkits and keeps only the ones that authenticate via OAuth), with their official
 * logos. Until a Composio API key is configured, the page shows a clear guide with an inline input
 * so the user can add the key right here and load the connectors. Once a connector is connected,
 * every one of its tools is available to the agent (main, custom, sub-agents, teams, CEO) as native
 * function calls.
 */
export function ConnectorsPanel() {
  const settings = useStore((s) => s.settings);
  const setSettings = useStore((s) => s.setSettings);
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

  // Inline Composio API-key entry (shown until a key is configured).
  const [apiKey, setApiKey] = useState(settings.composioApiKey ?? "");
  const [savingKey, setSavingKey] = useState(false);
  const [keyCheck, setKeyCheck] = useState<"ok" | "bad" | null>(null);

  // Keep the inline field in sync if the key changes elsewhere (e.g. Settings).
  useEffect(() => {
    setApiKey(settings.composioApiKey ?? "");
  }, [settings.composioApiKey]);

  const reload = async () => {
    try {
      const overview = await fetchConnectorsOverview();
      setConfigured(overview.configured);
      setItems(overview.connectors);
      setError(null);
      // Mirror the backend truth into the synced store slice (drives chat turns).
      setConnectors(
        overview.connectors
          .filter((c) => c.status !== "disconnected")
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

  /**
   * Validate the entered Composio key, persist it into Settings (so every surface picks it up),
   * then reload the live connector catalog. Persisting the settings document directly guarantees
   * the backend sees the key before we refetch the catalog.
   */
  const saveApiKey = async () => {
    const key = apiKey.trim();
    if (!key) {
      setKeyCheck("bad");
      return;
    }
    setSavingKey(true);
    setKeyCheck(null);
    setError(null);
    try {
      const ok = await validateComposioKey(key);
      if (!ok) {
        setKeyCheck("bad");
        return;
      }
      setKeyCheck("ok");
      setSettings({ composioApiKey: key });
      await saveStateKey("settings", { ...useStore.getState().settings, composioApiKey: key });
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingKey(false);
    }
  };

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
    if (!q) return items;
    return items.filter(
      (item) =>
        item.name.toLowerCase().includes(q) ||
        (item.description ?? "").toLowerCase().includes(q) ||
        item.id.toLowerCase().includes(q) ||
        (item.account_label ?? "").toLowerCase().includes(q),
    );
  }, [items, query]);

  const activeCount = items.filter((i) => i.status === "active").length;

  return (
    <div className="mx-auto w-full max-w-2xl panel-in">
      <PanelHeader kicker="Apps the agent can use" title="Connectors" />

      <a
        href={ZAPPER_NOTICE_URL}
        target="_blank"
        rel="noreferrer"
        className="mb-4 flex items-center gap-3 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg)] p-3 transition-colors hover:border-[var(--secondary)]"
      >
        <img
          src={ZAPPER_LOGO_URL}
          alt="Zapper logo"
          loading="lazy"
          referrerPolicy="no-referrer"
          className="h-8 w-8 shrink-0 rounded-[var(--radius-sm)] object-contain"
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).style.display = "none";
          }}
        />
        <span className="flex-1 text-sm font-medium text-[var(--fg)]">
          Use zapper mcp for connecting to 9000+ apps
        </span>
        <ExternalLink className="h-4 w-4 shrink-0 text-[var(--subtle)]" />
      </a>

      <p className="mb-4 text-sm leading-relaxed text-[var(--muted)]">
        Connect an app once — the agent can then use every one of its tools directly
        (read and write) as native function calls, in any chat. Only OAuth-capable apps
        are shown, fetched live from Composio.
      </p>

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-12 text-sm text-[var(--muted)]">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading connectors from Composio...
        </div>
      ) : !configured ? (
        <ComposioKeyGuide
          apiKey={apiKey}
          onChange={(value) => {
            setApiKey(value);
            setKeyCheck(null);
          }}
          onSave={() => void saveApiKey()}
          saving={savingKey}
          check={keyCheck}
        />
      ) : (
        <>
          <div className="mb-4 flex items-center gap-2 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg)] px-3 py-2">
            <Search className="h-4 w-4 shrink-0 text-[var(--subtle)]" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search connectors..."
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

          {filtered.length === 0 ? (
            <EmptyState icon={<ConnectorsIcon className="h-8 w-8" />}>
              {items.length === 0
                ? "No OAuth-capable connectors were found for this Composio project."
                : `No connectors match “${query}”.`}
            </EmptyState>
          ) : (
            <ul className="m-0 grid list-none grid-cols-1 gap-3 p-0 sm:grid-cols-2">
              {filtered.map((item) => (
                <ConnectorCard
                  key={item.id}
                  item={item}
                  busy={busyId === item.id}
                  configured={configured}
                  onConnect={() => void connect(item.id)}
                  onDisconnect={() => setConfirmId(item.id)}
                />
              ))}
            </ul>
          )}

          {items.length > 0 && (
            <p className="mt-4 text-xs text-[var(--subtle)]">
              {activeCount} of {items.length} connected
              {activeCount > 0 && " — connected apps are available to the agent right now"}.
            </p>
          )}
        </>
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

/**
 * The first-run guide shown until a Composio API key is configured. It explains what the key is
 * for and lets the user paste and save it right on the Connectors page (the connectors load
 * automatically once the key is accepted).
 */
function ComposioKeyGuide({
  apiKey,
  onChange,
  onSave,
  saving,
  check,
}: {
  apiKey: string;
  onChange: (value: string) => void;
  onSave: () => void;
  saving: boolean;
  check: "ok" | "bad" | null;
}) {
  return (
    <div
      className="rounded-[var(--radius-xl)] border border-[var(--border)] bg-[var(--bg)] p-5"
      style={{ boxShadow: "var(--shadow-chip)" }}
    >
      <div className="flex items-start gap-3">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-[var(--radius-md)] bg-[var(--secondary)] text-[var(--secondary-fg)]">
          <KeyRound className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="m-0 text-base font-semibold text-[var(--fg)]">
            Add your Composio API key to get connectors
          </h3>
          <p className="m-0 mt-1 text-sm leading-relaxed text-[var(--muted)]">
            Connectors are powered by Composio and fetched live. Add your API key once here and the
            OAuth-capable apps you can connect will load automatically.
          </p>
        </div>
      </div>

      <ol className="mt-4 list-decimal space-y-1 pl-5 text-sm text-[var(--muted)]">
        <li>
          Create a free account and copy your API key from{" "}
          <a
            href="https://app.composio.dev"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-[var(--secondary)] hover:underline"
          >
            app.composio.dev
            <ExternalLink className="h-3 w-3" />
          </a>
          .
        </li>
        <li>Paste the key below and press “Save &amp; load connectors”.</li>
        <li>Your apps appear here and can be connected in one click.</li>
      </ol>

      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        <TextInput
          type="password"
          value={apiKey}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") onSave();
          }}
          placeholder="ak-..."
          aria-label="Composio API key"
          className="flex-1"
        />
        <Button onClick={onSave} disabled={saving || apiKey.trim().length === 0} className="shrink-0">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
          Save &amp; load connectors
        </Button>
      </div>

      {check === "bad" && (
        <p className="m-0 mt-2 text-xs text-[var(--danger)]">
          That key was rejected by Composio. Check it and try again.
        </p>
      )}
      {check === "ok" && (
        <p className="m-0 mt-2 inline-flex items-center gap-1 text-xs text-emerald-600">
          <Check className="h-3 w-3" /> Key accepted — loading your connectors…
        </p>
      )}

      <p className="m-0 mt-3 text-xs text-[var(--subtle)]">
        The key is stored with your settings and only ever sent to your own backend — connectors are
        fetched directly from Composio. You can also manage it later in Settings.
      </p>
    </div>
  );
}

function ConnectorCard({
  item,
  busy,
  configured,
  onConnect,
  onDisconnect,
}: {
  item: ConnectorOverviewItem;
  busy: boolean;
  configured: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
}) {
  const status: ConnectorStatus = item.status;
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
          <ConnectorLogo name={item.name} logoUrl={item.logo_url} />
          <div className="min-w-0 flex-1">
            <h3 className="m-0 text-base font-semibold text-[var(--fg)]">{item.name}</h3>
            {item.homepage ? (
              <a
                href={item.homepage}
                target="_blank"
                rel="noreferrer"
                className="mt-0.5 inline-flex items-center gap-1 text-[11px] text-[var(--subtle)] hover:text-[var(--secondary)]"
              >
                {item.homepage.replace(/^https?:\/\//, "")}
                <ExternalLink className="h-2.5 w-2.5" />
              </a>
            ) : (
              <span className="mt-0.5 block font-mono text-[11px] text-[var(--subtle)]">{item.id}</span>
            )}
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

        {item.description && (
          <p className="m-0 mt-2 text-[13px] leading-relaxed text-[var(--muted)]">{item.description}</p>
        )}

        {connected && item.account_label && (
          <p className="m-0 mt-2 truncate font-mono text-[11px] text-[var(--subtle)]">
            {item.account_label}
          </p>
        )}
        {awaiting && (
          <p className="m-0 mt-2 text-[11px] leading-relaxed text-[var(--warning)]">
            Finish authorizing {item.name} in the opened tab — this card updates automatically.
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
              {awaiting ? "Waiting for auth..." : status === "failed" ? "Reconnect" : "Connect"}
            </Button>
          )}
        </div>
      </article>
    </li>
  );
}

/** Official app logo (Composio artwork), with a letter fallback. */
function ConnectorLogo({ name, logoUrl }: { name: string; logoUrl?: string | null }) {
  const [failed, setFailed] = useState(false);
  const src = connectorLogo(logoUrl);
  if (failed || !src) {
    return (
      <span className="grid h-11 w-11 shrink-0 place-items-center rounded-[var(--radius-md)] bg-[var(--secondary)] text-lg font-semibold text-[var(--secondary-fg)]">
        {name.slice(0, 1).toUpperCase()}
      </span>
    );
  }
  return (
    <img
      key={src}
      src={src}
      alt={`${name} logo`}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className="h-11 w-11 shrink-0 rounded-[var(--radius-md)] border border-[var(--border)] bg-white object-contain p-1.5"
    />
  );
}
