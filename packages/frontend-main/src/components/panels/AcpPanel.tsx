import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Terminal,
  Copy,
  Check,
  RefreshCw,
  Info,
  Cpu,
  Volume2,
  FolderOpen,
  Bot,
  Users,
  Crown,
  ShieldCheck,
  ChevronDown,
} from "lucide-react";
import {
  Button,
  Field,
  PanelHeader,
  Select,
  TextInput,
  Toggle,
} from "@/components/ui/primitives";
import { useStore } from "@/store/useStore";
import {
  DEFAULT_ACP_CONFIG,
  fetchAcpInfo,
  saveAcpConfig,
  type AcpConfig,
  type AcpInfo,
} from "@/lib/acp";
import { CUSTOM_PROVIDER_PREFIX } from "@/lib/providers";
import { setWorkspace } from "@/lib/workspace";
import { cn } from "@/utils/cn";

/**
 * ACP panel — configure the Agent Client Protocol gateway and copy the exact
 * connection command for any ACP client (Zed and friends).
 */
export function AcpPanel() {
  const providers = useStore((s) => s.providers);
  const customProviders = useStore((s) => s.customProviders);
  const setWorkspacePath = useStore((s) => s.setWorkspacePath);
  const setSection = useStore((s) => s.setSection);

  const [info, setInfo] = useState<AcpInfo | null>(null);
  const [config, setConfig] = useState<AcpConfig>(DEFAULT_ACP_CONFIG);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [dirty, setDirty] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  // Initial load: all state updates happen after the async fetch resolves, so the
  // effect itself never triggers a cascading render.
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const next = await fetchAcpInfo();
        if (!active) return;
        setInfo(next);
        setConfig(next.config);
        setDirty(false);
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await fetchAcpInfo();
      setInfo(next);
      setConfig(next.config);
      setDirty(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  const update = (patch: Partial<AcpConfig>) => {
    setConfig((prev) => ({ ...prev, ...patch }));
    setDirty(true);
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const saved = await saveAcpConfig(config);
      setConfig(saved);
      setDirty(false);
      setSavedAt(Date.now());
      const next = await fetchAcpInfo();
      setInfo(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const providerOptions = useMemo(() => {
    const list = providers.map((p) => ({ id: p.id, label: p.label || p.id }));
    for (const cp of customProviders) list.push({ id: cp.id, label: `${cp.name} (custom)` });
    return list;
  }, [providers, customProviders]);

  if (loading && !info) {
    return (
      <div className="mx-auto w-full max-w-3xl space-y-5">
        <PanelHeader kicker="Gateway" title="Agent Client Protocol" />
        <p className="text-sm text-[var(--muted)]">Loading ACP status…</p>
      </div>
    );
  }

  if (!info) {
    return (
      <div className="mx-auto w-full max-w-3xl space-y-5">
        <PanelHeader kicker="Gateway" title="Agent Client Protocol" />
        <div className="flex items-start gap-2 rounded-[var(--radius-md)] border border-[color:color-mix(in_oklab,var(--danger)_35%,var(--border))] bg-[var(--danger-soft)] p-3 text-sm">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-[var(--danger)]" />
          <div className="flex-1">
            <p className="text-[var(--fg)]">Could not reach the ACP endpoint.</p>
            <p className="mt-0.5 text-xs text-[var(--muted)]">{error || "The backend is unavailable."}</p>
          </div>
          <Button variant="outline" onClick={() => void reload()}>
            <RefreshCw className="h-4 w-4" /> Retry
          </Button>
        </div>
      </div>
    );
  }

  const targetValue =
    config.mode === "custom"
      ? `custom:${config.customAgentId}`
      : config.mode === "team"
        ? `team:${config.teamId}`
        : config.mode === "ceo"
          ? `ceo:${config.ceoId}`
          : config.mode;

  const onTarget = (value: string) => {
    if (value.startsWith("custom:")) update({ mode: "custom", customAgentId: value.slice(7) });
    else if (value.startsWith("team:")) update({ mode: "team", teamId: value.slice(5) });
    else if (value.startsWith("ceo:")) update({ mode: "ceo", ceoId: value.slice(4) });
    else if (value === "chat") update({ mode: "chat" });
    else update({ mode: "default" });
  };

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      <div className="flex items-end justify-between gap-3">
        <PanelHeader kicker="Gateway" title="Agent Client Protocol" />
        <div className="flex items-center gap-2">
          {dirty && <span className="text-xs text-[var(--warning)]">Unsaved changes</span>}
          {!dirty && savedAt && <span className="text-xs text-[var(--success)]">Saved</span>}
          <Button variant="outline" onClick={() => void reload()} disabled={saving}>
            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
          </Button>
          <Button onClick={() => void save()} disabled={saving || !dirty}>
            {saving ? "Saving…" : "Save configuration"}
          </Button>
        </div>
      </div>

      <p className="text-sm text-[var(--muted)]">
        ACP (Agent Client Protocol) lets any compatible client — such as the{" "}
        <span className="text-[var(--fg)]">Zed</span> editor — drive Mythgram as its agent. The client
        launches a small stdio bridge that runs your configured agent through this backend, so the
        Default Agent, Custom Agents, agent teams and CEO systems, both context-management methods,
        the memory agent, connectors, MCP servers, TTS and workspace all behave exactly as they do in
        this console.
      </p>

      {error && (
        <div className="rounded-[var(--radius-md)] border border-[color:color-mix(in_oklab,var(--danger)_35%,var(--border))] bg-[var(--danger-soft)] p-3 text-sm text-[var(--danger)]">
          {error}
        </div>
      )}

      {/* Status */}
      <section className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--card)] p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <ShieldCheck className={cn("h-4 w-4", config.enabled ? "text-[var(--success)]" : "text-[var(--muted)]")} />
            <span className="text-sm font-semibold text-[var(--fg)]">
              {config.enabled ? "ACP gateway enabled" : "ACP gateway disabled"}
            </span>
          </div>
          <Toggle checked={config.enabled} onChange={(next) => update({ enabled: next })} label="Enable ACP" />
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <StatusCell
            icon={<Cpu className="h-4 w-4" />}
            label="LLM provider"
            primary={`${info.llm.provider || "—"}`}
            secondary={
              info.llm.hasApiKey || info.llm.provider === "local"
                ? info.llm.inherited
                  ? "Connected · inherited from Settings"
                  : "Connected · ACP override"
                : "No API key — configure in Settings"
            }
            warn={!(info.llm.hasApiKey || info.llm.provider === "local")}
          />
          <StatusCell
            icon={<Volume2 className="h-4 w-4" />}
            label="Text to speech"
            primary={info.tts?.providerName ?? "Not connected"}
            secondary={info.tts ? "Auto for the voice tool" : "Configure in Text to speech"}
            warn={!info.tts}
          />
          <StatusCell
            icon={<FolderOpen className="h-4 w-4" />}
            label="Workspace"
            primary={info.workspace || "—"}
            secondary="Files & agent work root"
            mono
          />
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-[var(--muted)]">
          <span>Active runtime:</span>
          <span className="rounded-full bg-[var(--chip)] px-2 py-0.5 font-medium text-[var(--fg)]">
            {info.selected.label}
          </span>
          {!info.llm.ready && (
            <span className="text-[var(--warning)]">
              Connect an LLM provider in Settings before clients can run turns.
            </span>
          )}
        </div>
      </section>

      {/* Runtime */}
      <section className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--card)] p-4">
        <h2 className="text-sm font-semibold text-[var(--fg)]">Run ACP sessions as</h2>
        <p className="mt-1 text-xs text-[var(--muted)]">
          Pick which configured agent serves ACP requests. Custom agents, teams and CEO agents you
          create in this console appear here.
        </p>
        <div className="mt-3">
          <Field label="Active runtime">
            <Select value={targetValue} onChange={(e) => onTarget(e.target.value)}>
              <option value="default">Default Agent</option>
              <option value="chat">Chat mode (conversation only)</option>
              {info.customAgents.length > 0 && (
                <optgroup label="Custom agents">
                  {info.customAgents.map((a) => (
                    <option key={a.id} value={`custom:${a.id}`}>
                      {a.name}
                    </option>
                  ))}
                </optgroup>
              )}
              {info.teams.length > 0 && (
                <optgroup label="Agent teams">
                  {info.teams.map((t) => (
                    <option key={t.id} value={`team:${t.id}`}>
                      {t.name}
                    </option>
                  ))}
                </optgroup>
              )}
              {info.ceos.length > 0 && (
                <optgroup label="CEO agents">
                  {info.ceos.map((c) => (
                    <option key={c.id} value={`ceo:${c.id}`}>
                      {c.name}
                    </option>
                  ))}
                </optgroup>
              )}
            </Select>
          </Field>
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] text-[var(--muted)]">
          <TargetBadge icon={<Bot className="h-3 w-3" />} label={`${info.customAgents.length} custom`} />
          <TargetBadge icon={<Users className="h-3 w-3" />} label={`${info.teams.length} team`} />
          <TargetBadge icon={<Crown className="h-3 w-3" />} label={`${info.ceos.length} CEO`} />
          <button
            type="button"
            onClick={() => setSection("customagents")}
            className="rounded-full bg-[var(--chip)] px-2 py-0.5 hover:text-[var(--fg)]"
          >
            Manage agents
          </button>
        </div>
      </section>

      {/* Context + memory */}
      <section className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--card)] p-4">
        <h2 className="text-sm font-semibold text-[var(--fg)]">Context management & memory</h2>
        <p className="mt-1 text-xs text-[var(--muted)]">
          By default ACP follows your app Settings. Override here to tune how long sessions behave.
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Field label="Context management">
            <Select
              value={config.contextManagementMethod}
              onChange={(e) =>
                update({ contextManagementMethod: e.target.value as AcpConfig["contextManagementMethod"] })
              }
            >
              <option value="inherit">Inherit from Settings</option>
              <option value="summarization">Auto summarization</option>
              <option value="sliding_window">Sliding window</option>
            </Select>
          </Field>
          <Field label="Memory agent">
            <Select
              value={config.memoryAgent}
              onChange={(e) => update({ memoryAgent: e.target.value as AcpConfig["memoryAgent"] })}
            >
              <option value="inherit">Inherit from Settings</option>
              <option value="on">On</option>
              <option value="off">Off</option>
            </Select>
          </Field>
          {config.contextManagementMethod === "sliding_window" && (
            <Field label="Sliding-window truncate %" hint="0.05–0.9">
              <TextInput
                type="number"
                step="0.05"
                min="0.05"
                max="0.9"
                value={config.slidingWindowTruncatePercent ?? ""}
                placeholder="0.3"
                onChange={(e) =>
                  update({
                    slidingWindowTruncatePercent: e.target.value === "" ? null : Number(e.target.value),
                  })
                }
              />
            </Field>
          )}
          {config.contextManagementMethod !== "sliding_window" && (
            <Field label="Summarization threshold" hint="0.1–1.0">
              <TextInput
                type="number"
                step="0.05"
                min="0.1"
                max="1"
                value={config.summaryThreshold ?? ""}
                placeholder="0.9"
                onChange={(e) => update({ summaryThreshold: e.target.value === "" ? null : Number(e.target.value) })}
              />
            </Field>
          )}
          {config.memoryAgent !== "off" && (
            <Field label="Memory agent interval" hint="Tasks between runs">
              <TextInput
                type="number"
                min="1"
                max="50"
                value={config.memoryAgentInterval ?? ""}
                placeholder="3"
                onChange={(e) =>
                  update({ memoryAgentInterval: e.target.value === "" ? null : Number(e.target.value) })
                }
              />
            </Field>
          )}
        </div>
      </section>

      {/* Advanced LLM override */}
      <section className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--card)] p-4">
        <button
          type="button"
          onClick={() => setAdvancedOpen((v) => !v)}
          className="flex w-full items-center justify-between gap-2 text-left"
        >
          <span>
            <span className="text-sm font-semibold text-[var(--fg)]">LLM override (optional)</span>
            <span className="mt-1 block text-xs text-[var(--muted)]">
              Leave the provider empty to use the provider connected in Settings. Set it only to run
              ACP on a different provider/model (or API key).
            </span>
          </span>
          <ChevronDown className={cn("h-4 w-4 shrink-0 text-[var(--muted)] transition-transform", advancedOpen && "rotate-180")} />
        </button>
        {advancedOpen && (
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <Field label="Provider">
              <Select value={config.provider} onChange={(e) => update({ provider: e.target.value })}>
                <option value="">Inherit ({info.llm.provider || "none"})</option>
                {providerOptions.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Model">
              <TextInput
                value={config.model}
                placeholder={`Inherit (${info.llm.model || "none"})`}
                onChange={(e) => update({ model: e.target.value })}
              />
            </Field>
            <Field label="API key">
              <TextInput
                type="password"
                value={config.apiKey}
                placeholder={config.provider.startsWith(CUSTOM_PROVIDER_PREFIX) ? "Custom provider key" : "Inherit from Settings"}
                onChange={(e) => update({ apiKey: e.target.value })}
              />
            </Field>
            <Field label="Base URL">
              <TextInput
                value={config.baseUrl}
                placeholder="Inherit from Settings"
                onChange={(e) => update({ baseUrl: e.target.value })}
              />
            </Field>
            <Field label="Temperature" hint="0–2">
              <TextInput
                type="number"
                step="0.1"
                min="0"
                max="2"
                value={config.temperature ?? ""}
                placeholder="Inherit"
                onChange={(e) => update({ temperature: e.target.value === "" ? null : Number(e.target.value) })}
              />
            </Field>
            <Field label="Reasoning effort">
              <Select value={config.effort} onChange={(e) => update({ effort: e.target.value })}>
                <option value="">Inherit from Settings</option>
                <option value="low">low</option>
                <option value="medium">medium</option>
                <option value="high">high</option>
                <option value="max">max</option>
              </Select>
            </Field>
            <Field label="Context window (tokens, optional)" hint="Auto-detected">
              <TextInput
                type="number"
                min="1000"
                value={config.contextLimit ?? ""}
                placeholder="Auto"
                onChange={(e) => update({ contextLimit: e.target.value === "" ? null : Number(e.target.value) })}
              />
            </Field>
          </div>
        )}
      </section>

      {/* Workspace */}
      <section className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--card)] p-4">
        <h2 className="text-sm font-semibold text-[var(--fg)]">Workspace</h2>
        <p className="mt-1 text-xs text-[var(--muted)]">
          ACP turns run in the same workspace as this console. Change it here or with the folder
          button in the composer.
        </p>
        <div className="mt-3 flex items-end gap-2">
          <div className="flex-1">
            <Field label="Workspace root">
              <TextInput
                value={info.workspace}
                readOnly
                title={info.workspace}
              />
            </Field>
          </div>
          <WorkspacePicker
            onSet={async (path) => {
              const resolved = await setWorkspace(path);
              setWorkspacePath(resolved);
              await reload();
            }}
          />
        </div>
      </section>

      {/* Connection guide */}
      <ConnectionGuide info={info} />

      <p className="pb-2 text-xs text-[var(--subtle)]">
        Tip: keep the backend running on {info.connection.backendUrl}. The bridge discovers it
        automatically — no base URL needs to be passed as an argument.
      </p>
    </div>
  );
}

function StatusCell({
  icon,
  label,
  primary,
  secondary,
  warn,
  mono,
}: {
  icon: React.ReactNode;
  label: string;
  primary: string;
  secondary: string;
  warn?: boolean;
  mono?: boolean;
}) {
  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg)] p-3">
      <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-[var(--subtle)]">
        {icon}
        {label}
      </div>
      <p className={cn("mt-1 truncate text-sm font-semibold text-[var(--fg)]", mono && "font-mono text-xs")} title={primary}>
        {primary}
      </p>
      <p className={cn("mt-0.5 text-[11px]", warn ? "text-[var(--warning)]" : "text-[var(--muted)]")}>{secondary}</p>
    </div>
  );
}

function TargetBadge({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-[var(--chip)] px-2 py-0.5">
      {icon}
      {label}
    </span>
  );
}

function WorkspacePicker({ onSet }: { onSet: (path: string) => Promise<void> }) {
  const [path, setPath] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="w-52">
      <Field label="Switch to" hintError={!!error}>
        <div className="flex gap-2">
          <TextInput
            value={path}
            placeholder="Absolute or relative path"
            onChange={(e) => setPath(e.target.value)}
          />
          <Button
            variant="outline"
            disabled={busy || path.trim().length === 0}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                await onSet(path.trim());
                setPath("");
              } catch (e) {
                setError(e instanceof Error ? e.message : String(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            Set
          </Button>
        </div>
      </Field>
      {error && <p className="mt-1 text-[11px] text-[var(--danger)]">{error}</p>}
    </div>
  );
}

function ConnectionGuide({ info }: { info: AcpInfo }) {
  const zedSnippet = useMemo(
    () =>
      JSON.stringify(
        {
          agent_servers: {
            Mythgram: {
              command: info.connection.command,
              args: info.connection.args,
            },
          },
        },
        null,
        2,
      ),
    [info.connection.command, info.connection.args],
  );

  const commandLine = `${info.connection.command} ${info.connection.args.join(" ")}`;

  return (
    <section className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--card)] p-4">
      <div className="flex items-center gap-2">
        <Terminal className="h-4 w-4 text-[var(--secondary)]" />
        <h2 className="text-sm font-semibold text-[var(--fg)]">Connect an ACP client</h2>
      </div>

      <ol className="mt-3 space-y-1.5 text-sm text-[var(--muted)]">
        <li>
          1. Keep this Mythgram backend running — the bridge connects to{" "}
          <code className="rounded bg-[var(--chip)] px-1 py-0.5 text-xs text-[var(--fg)]">{info.connection.backendUrl}</code>{" "}
          automatically.
        </li>
        <li>2. Connect a provider in Settings (and TTS if you want voice) — ACP reuses them.</li>
        <li>3. Add the agent to your ACP client using the configuration below.</li>
      </ol>

      <div className="mt-4 space-y-3">
        <div>
          <p className="text-xs font-medium text-[var(--muted)]">Launch command</p>
          <CopyBlock text={commandLine} />
        </div>
        <div>
          <p className="text-xs font-medium text-[var(--muted)]">
            Zed configuration <span className="text-[var(--subtle)]">(settings.json → agent_servers)</span>
          </p>
          <CopyBlock text={zedSnippet} mono />
        </div>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <InfoLine label="Transport" value={info.connection.transport} />
        <InfoLine label="Protocol version" value={String(info.connection.protocolVersion)} />
        <InfoLine label="Agent" value={`${info.connection.agent.title || info.connection.agent.name} v${info.connection.agent.version}`} />
        <InfoLine label="Bridge entry" value={info.connection.entryPath} mono />
      </div>

      <p className="mt-3 text-[11px] text-[var(--subtle)]">
        The bridge is a local stdio process launched via <code>npx</code>. It needs the Mythgram
        package (tsx) available; the exact command above already points at this installation.
      </p>
    </section>
  );
}

function InfoLine({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-xs">
      <span className="text-[var(--subtle)]">{label}</span>
      <span className={cn("truncate text-[var(--fg)]", mono && "font-mono")} title={value}>
        {value}
      </span>
    </div>
  );
}

function CopyBlock({ text, mono }: { text: string; mono?: boolean }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard may be unavailable; ignore.
    }
  };
  return (
    <div className="relative mt-1">
      <pre
        className={cn(
          "overflow-x-auto rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg)] p-3 pr-12 text-xs leading-relaxed text-[var(--fg)]",
          mono && "font-mono",
        )}
      >
        {text}
      </pre>
      <button
        type="button"
        onClick={() => void copy()}
        title="Copy"
        className="absolute right-2 top-2 grid h-7 w-7 place-items-center rounded-[var(--radius-sm)] text-[var(--muted)] hover:bg-[var(--chip)] hover:text-[var(--fg)]"
      >
        {copied ? <Check className="h-3.5 w-3.5 text-[var(--success)]" /> : <Copy className="h-3.5 w-3.5" />}
      </button>
    </div>
  );
}
