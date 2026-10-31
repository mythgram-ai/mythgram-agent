import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AudioLines,
  Check,
  Copy,
  Download,
  ExternalLink,
  KeyRound,
  Loader2,
  Plus,
  RefreshCw,
  Server,
  Settings2,
  Trash2,
  TriangleAlert,
  Volume2,
  X,
  Zap,
} from "lucide-react";
import { useStore } from "@/store/useStore";
import type {
  CustomHeader,
  LocalTtsInstallStatus,
  TtsAudioResult,
  TtsModel,
  TtsOutputFormat,
  TtsProvider,
  TtsProviderDefinition,
  TtsVoice,
} from "@/types";
import {
  audioResultToBlob,
  createTtsProvider,
  deleteTtsProvider,
  downloadAudioResult,
  fetchLocalTtsStatus,
  fetchTtsAgentConfig,
  fetchTtsModels,
  fetchTtsProviders,
  fetchTtsVoices,
  installLocalTts,
  synthesizeTts,
  updateTtsAgentConfig,
  updateTtsProvider,
  type TtsProviderInput,
  type TtsProvidersPayload,
} from "@/lib/tts";
import { Modal } from "@/components/ui/Modal";
import { Button, EmptyState, Field, PanelHeader, Select, TextArea, TextInput, Toggle } from "@/components/ui/primitives";
import { cn } from "@/utils/cn";

const OUTPUT_FORMATS: TtsOutputFormat[] = ["mp3", "wav", "flac", "aac", "opus", "pcm"];

const KIND_BADGE: Record<TtsProvider["kind"], string> = {
  openrouter: "Cloud",
  kittenml: "Cloud",
  sarvam: "Cloud",
  azure: "Cloud",
  elevenlabs: "Cloud",
  google: "Cloud",
  gradium: "Cloud",
  inworld: "Cloud",
  minimax: "Cloud",
  volcengine: "Cloud",
  xai: "Cloud",
  mimo: "Cloud",
  localtts: "Local",
  custom: "Custom",
};

/**
 * Text-to-speech workspace.
 *
 * Configure TTS providers (OpenRouter, KittenML, or any OpenAI-compatible
 * endpoint), then generate speech from text. Models and voices are always
 * fetched live from the provider; API keys stay server-side.
 */
export function TtsPanel() {
  const setTtsProviders = useStore((s) => s.setTtsProviders);

  const [providers, setProviders] = useState<TtsProvider[]>([]);
  const [catalog, setCatalog] = useState<TtsProviderDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [configuringId, setConfiguringId] = useState<string | null>(null);
  const [creatingCustom, setCreatingCustom] = useState(false);

  const applyPayload = useCallback(
    (payload: TtsProvidersPayload) => {
      setProviders(payload.providers);
      setCatalog(payload.catalog);
      setTtsProviders(payload.providers);
      setError(null);
    },
    [setTtsProviders],
  );

  const reload = useCallback(async () => {
    try {
      applyPayload(await fetchTtsProviders());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [applyPayload]);

  // Initial load. The awaits keep every state update asynchronous to the effect.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const payload = await fetchTtsProviders();
        if (!cancelled) applyPayload(payload);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [applyPayload]);

  const definitionOf = useCallback(
    (kind: TtsProvider["kind"]): TtsProviderDefinition | undefined =>
      catalog.find((c) => c.kind === kind),
    [catalog],
  );

  const configuring = providers.find((p) => p.id === configuringId) ?? null;

  return (
    <div className="mx-auto w-full max-w-3xl panel-in">
      <PanelHeader kicker="Speak any text" title="Text to speech" />
      <p className="mb-6 max-w-2xl text-sm leading-relaxed text-[var(--muted)]">
        Run a private Piper server on your own machine, or turn text into natural speech with a cloud
        voice. Local TTS only needs a base URL; cloud providers need an API key and a model + voice.
        Keys are stored server-side only.
      </p>

      {error && (
        <div className="mb-4 flex items-start gap-2 rounded-[var(--radius-md)] border border-[color:color-mix(in_oklab,var(--danger)_35%,transparent)] bg-[var(--danger-soft)] p-3 text-sm text-[var(--danger)]">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-12 text-sm text-[var(--muted)]">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading providers...
        </div>
      ) : (
        <>
          <LocalTtsCard
            provider={providers.find((p) => p.kind === "localtts") ?? null}
            onSaved={(saved) => {
              setProviders((prev) => [...prev.filter((p) => p.id !== saved.id), saved]);
              useStore.getState().upsertTtsProvider(saved);
            }}
            onRefresh={reload}
          />

          <ProviderSection
            providers={providers.filter((p) => p.kind !== "localtts")}
            definitionOf={definitionOf}
            onConfigure={setConfiguringId}
            onAddCustom={() => setCreatingCustom(true)}
            onReload={reload}
          />

          <AgentSpeechSettings providers={providers} />
        </>
      )}

      {configuring && (
        <ProviderConfigModal
          key={configuring.id}
          provider={configuring}
          definition={definitionOf(configuring.kind)}
          custom={configuring.kind === "custom"}
          onClose={() => setConfiguringId(null)}
          onSaved={(saved) => {
            setProviders((prev) => [...prev.filter((p) => p.id !== saved.id), saved]);
            const current = useStore.getState().ttsProviders;
            setTtsProviders([...current.filter((p) => p.id !== saved.id), saved]);
            setConfiguringId(null);
          }}
          onDeleted={(id) => {
            setProviders((prev) => prev.filter((p) => p.id !== id));
            useStore.getState().removeTtsProvider(id);
            setConfiguringId(null);
          }}
        />
      )}

      {creatingCustom && (
        <ProviderConfigModal
          key="create-custom"
          provider={null}
          definition={definitionOf("custom")}
          custom
          onClose={() => setCreatingCustom(false)}
          onSaved={(saved) => {
            setProviders((prev) => [...prev, saved]);
            useStore.getState().upsertTtsProvider(saved);
            setCreatingCustom(false);
          }}
          onDeleted={() => undefined}
        />
      )}
    </div>
  );
}

const LOCAL_TTS_DEFAULT_BASE_URL = "http://localhost:7878/v1";

type LocalInstallTab = "pypi" | "release" | "docker";

const LOCAL_INSTALL_TABS: Array<{ id: LocalInstallTab; label: string }> = [
  { id: "pypi", label: "pip · PyPI" },
  { id: "release", label: "pip · Release" },
  { id: "docker", label: "Docker" },
];

/**
 * Local TTS quick-start card.
 *
 * local-tts is a self-hosted Piper server that exposes an OpenAI-compatible
 * `/v1/audio/speech` endpoint where `input` is the only required field. This
 * card shows the install methods, stores the base URL (+ optional API key used
 * only when encryption is enabled) and generates speech without ever asking for
 * a model or voice.
 */
function LocalTtsCard({
  provider,
  onSaved,
  onRefresh,
}: {
  provider: TtsProvider | null;
  onSaved: (provider: TtsProvider) => void;
  onRefresh: () => void;
}) {
  const [installTab, setInstallTab] = useState<LocalInstallTab>("pypi");
  const [baseUrl, setBaseUrl] = useState(provider?.baseUrl || LOCAL_TTS_DEFAULT_BASE_URL);
  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [savedOnce, setSavedOnce] = useState(false);

  const [installStatus, setInstallStatus] = useState<LocalTtsInstallStatus | null>(null);
  const [installBusy, setInstallBusy] = useState(false);
  const [installError, setInstallError] = useState<string | null>(null);

  const [text, setText] = useState("");
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [result, setResult] = useState<TtsAudioResult | null>(null);

  const resultUrl = useMemo(
    () => (result ? URL.createObjectURL(audioResultToBlob(result)) : ""),
    [result],
  );
  useEffect(() => {
    return () => {
      if (resultUrl) URL.revokeObjectURL(resultUrl);
    };
  }, [resultUrl]);

  // Read the installer's current state once when the card mounts.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const next = await fetchLocalTtsStatus();
        if (cancelled) return;
        setInstallStatus(next);
        if (next.state === "running") {
          if (next.baseUrl) setBaseUrl(next.baseUrl);
          onRefresh();
        }
      } catch {
        // Status is best-effort: keep the card usable if the endpoint is absent.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [onRefresh]);

  // Poll while an install/start is in flight; stop once it settles.
  useEffect(() => {
    const active = installStatus?.state === "installing" || installStatus?.state === "starting";
    if (!active) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const next = await fetchLocalTtsStatus();
        if (cancelled) return;
        setInstallStatus(next);
        if (next.state === "running") {
          if (next.baseUrl) setBaseUrl(next.baseUrl);
          onRefresh();
        }
      } catch {
        // Keep polling; a transient failure is not fatal.
      }
    };
    const id = window.setInterval(() => void tick(), 1500);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [installStatus?.state, onRefresh]);

  const installNow = async () => {
    setInstallError(null);
    setInstallBusy(true);
    try {
      const next = await installLocalTts(installTab);
      setInstallStatus(next);
    } catch (e) {
      setInstallError(e instanceof Error ? e.message : String(e));
    } finally {
      setInstallBusy(false);
    }
  };

  const installActive =
    installStatus?.state === "installing" || installStatus?.state === "starting";
  const selectedTabLabel =
    LOCAL_INSTALL_TABS.find((tab) => tab.id === installTab)?.label ?? installTab;

  const persist = async (): Promise<TtsProvider | null> => {
    const url = baseUrl.trim();
    if (!url) {
      setFormError("An API base URL is required.");
      return null;
    }
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      setFormError("Enter a valid URL, e.g. http://localhost:7878/v1.");
      return null;
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      setFormError("The base URL must start with http:// or https://.");
      return null;
    }
    setSaving(true);
    setFormError(null);
    try {
      const input: TtsProviderInput = {
        kind: "localtts",
        name: "Local TTS",
        enabled: true,
        baseUrl: url,
        responseFormat: "wav",
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
      };
      const saved = provider
        ? await updateTtsProvider(provider.id, input)
        : await createTtsProvider(input);
      onSaved(saved);
      setApiKey("");
      return saved;
    } catch (e) {
      setFormError(e instanceof Error ? e.message : String(e));
      return null;
    } finally {
      setSaving(false);
    }
  };

  const save = async () => {
    if (await persist()) setSavedOnce(true);
  };

  const generate = async () => {
    if (!text.trim()) return;
    setGenerating(true);
    setGenError(null);
    setResult(null);
    try {
      const saved = await persist();
      if (!saved) return;
      setResult(await synthesizeTts({ providerId: saved.id, text }));
    } catch (e) {
      setGenError(e instanceof Error ? e.message : String(e));
    } finally {
      setGenerating(false);
    }
  };

  return (
    <section className="mb-8">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-[var(--fg)]">
          <Server className="h-4 w-4 text-[var(--subtle)]" /> Local TTS
        </h2>
        <span
          className={cn(
            "rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide",
            installStatus?.reachable
              ? "bg-emerald-500/15 text-emerald-600"
              : "bg-[var(--chip)] text-[var(--muted)]",
          )}
        >
          {installStatus?.reachable ? "Running" : "On-device"}
        </span>
      </div>

      <div
        className="rounded-[var(--radius-xl)] border border-[var(--border)] bg-[var(--bg)] p-5"
        style={{ boxShadow: "var(--shadow-chip)" }}
      >
        <p className="max-w-2xl text-sm leading-relaxed text-[var(--muted)]">
          Run local-tts: a self-hosted Piper studio with a web UI and an OpenAI-compatible speech API.
          Only its base URL is needed here — install the engine, download a voice and pick the API voice
          inside local-tts.
        </p>

        <div className="mt-4 rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--chip)] p-3">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 text-xs font-semibold text-[var(--fg)]">
              <Download className="h-3.5 w-3.5" /> Install &amp; run local-tts
            </span>
            <div className="flex flex-wrap gap-1">
              {LOCAL_INSTALL_TABS.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setInstallTab(tab.id)}
                  className={cn(
                    "rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors",
                    installTab === tab.id
                      ? "bg-[var(--secondary)] text-[var(--secondary-fg)]"
                      : "text-[var(--muted)] hover:bg-[var(--bg)]",
                  )}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          {installTab === "pypi" && (
            <div className="space-y-2">
              <p className="text-[11px] leading-relaxed text-[var(--muted)]">
                Install the published package, then start the server. It listens on port 7878.
              </p>
              <CopyableCommand command="pip install local-tts-studio" />
              <CopyableCommand command="local-tts" />
            </div>
          )}

          {installTab === "release" && (
            <div className="space-y-2">
              <p className="text-[11px] leading-relaxed text-[var(--muted)]">
                Install the wheel attached to a GitHub Release (replace v1.0.0 with the version you want),
                then start the server.
              </p>
              <CopyableCommand command="pip install https://github.com/mythgram-ai/mythgram-agent/releases/download/v1.0.0/local_tts_studio-1.0.0-py3-none-any.whl" />
              <CopyableCommand command="local-tts" />
              <p className="break-all text-[11px] leading-relaxed text-[var(--subtle)]">
                Source build: pip install
                https://github.com/mythgram-ai/mythgram-agent/releases/download/v1.0.0/local_tts_studio-1.0.0.tar.gz
              </p>
            </div>
          )}

          {installTab === "docker" && (
            <div className="space-y-2">
              <p className="text-[11px] leading-relaxed text-[var(--muted)]">
                Pull the container, then run it with port 7878 mapped and a data volume for voices and
                settings.
              </p>
              <CopyableCommand command="docker pull ghcr.io/mythgram-ai/local-tts:main" />
              <CopyableCommand
                command={
                  "docker run -d --name local-tts \\\n  -p 7878:7878 \\\n  -v local-tts-data:/data \\\n  ghcr.io/mythgram-ai/local-tts:main"
                }
              />
            </div>
          )}

          <p className="mt-2 text-[11px] leading-relaxed text-[var(--muted)]">
            Then open{" "}
            <a
              href="http://127.0.0.1:7878"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-[var(--secondary)] hover:underline"
            >
              http://127.0.0.1:7878 <ExternalLink className="h-3 w-3" />
            </a>{" "}
            to install the Piper engine, download a voice and choose the API default voice. The web UI,
            <code className="mx-1">/api</code> and <code className="mx-1">/v1</code> all share that port.
          </p>
        </div>

        <div className="mt-3 rounded-[var(--radius-lg)] border border-dashed border-[var(--border)] bg-[var(--chip)] p-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-xs font-semibold text-[var(--fg)]">One-click install &amp; start</p>
              <p className="mt-0.5 max-w-xl text-[11px] leading-relaxed text-[var(--muted)]">
                Runs the selected method ({selectedTabLabel}) on the backend host, starts local-tts on
                port 7878, then points the base URL at it.
              </p>
            </div>
            <Button onClick={() => void installNow()} disabled={installBusy || installActive}>
              {installBusy || installActive ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Download className="h-4 w-4" />
              )}
              {installActive ? "Installing..." : installBusy ? "Starting..." : "Install & start"}
            </Button>
          </div>

          {installError && (
            <div className="mt-2 flex items-start gap-2 rounded-[var(--radius-md)] border border-[color:color-mix(in_oklab,var(--danger)_35%,transparent)] bg-[var(--danger-soft)] p-2.5 text-[11px] text-[var(--danger)]">
              <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span className="break-words">{installError}</span>
            </div>
          )}

          {installStatus && installStatus.state !== "idle" && (
            <div
              className={cn(
                "mt-2 rounded-[var(--radius-md)] border p-2.5 text-[11px]",
                installStatus.state === "running"
                  ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-700"
                  : installStatus.state === "failed"
                    ? "border-[color:color-mix(in_oklab,var(--danger)_35%,transparent)] bg-[var(--danger-soft)] text-[var(--danger)]"
                    : "border-[var(--border)] bg-[var(--bg)] text-[var(--muted)]",
              )}
            >
              <div className="flex items-center gap-2">
                {installActive ? (
                  <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
                ) : installStatus.state === "running" ? (
                  <Check className="h-3.5 w-3.5 shrink-0" />
                ) : installStatus.state === "failed" ? (
                  <TriangleAlert className="h-3.5 w-3.5 shrink-0" />
                ) : null}
                <span className="break-words font-medium">
                  {installStatus.message || installStatus.state}
                </span>
              </div>
              {installStatus.log && (
                <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-[var(--radius-md)] bg-[var(--bg)] p-2 font-mono text-[10px] leading-relaxed text-[var(--muted)]">
                  {installStatus.log}
                </pre>
              )}
            </div>
          )}
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="API base URL" hint="required">
            <TextInput
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder={LOCAL_TTS_DEFAULT_BASE_URL}
              inputMode="url"
              autoComplete="off"
            />
          </Field>
          <Field label="API key" hint="optional">
            <TextInput
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={
                provider?.hasApiKey ? "•••• saved — leave blank to keep" : "Only if encryption is enabled"
              }
              autoComplete="off"
            />
          </Field>
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-[var(--subtle)]">
          The base URL is all that is required. Model, voice and prosody are configured inside local-tts;
          paste its API key above only if you enabled encryption there.
        </p>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={() => void save()} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            {saving ? "Saving..." : "Save settings"}
          </Button>
          {savedOnce && <span className="text-[11px] text-[var(--success)]">Saved</span>}
          {provider?.hasApiKey && (
            <span className="inline-flex items-center gap-1 text-[11px] text-[var(--subtle)]">
              <KeyRound className="h-3 w-3" /> API key stored
            </span>
          )}
        </div>

        {formError && (
          <div className="mt-3 flex items-start gap-2 rounded-[var(--radius-md)] border border-[color:color-mix(in_oklab,var(--danger)_35%,transparent)] bg-[var(--danger-soft)] p-3 text-xs text-[var(--danger)]">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <span className="break-words">{formError}</span>
          </div>
        )}

        <div className="mt-5 border-t border-[var(--border)] pt-4">
          <Field label="Text" hint={`${text.length} chars`}>
            <TextArea
              rows={4}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Type or paste the text you want spoken..."
            />
          </Field>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button onClick={() => void generate()} disabled={generating || !text.trim()}>
              {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
              {generating ? "Generating..." : "Generate speech"}
            </Button>
            <span className="text-[11px] text-[var(--subtle)]">Saves these settings automatically.</span>
          </div>

          {genError && (
            <div className="mt-3 flex items-start gap-2 rounded-[var(--radius-md)] border border-[color:color-mix(in_oklab,var(--danger)_35%,transparent)] bg-[var(--danger-soft)] p-3 text-xs text-[var(--danger)]">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
              <span className="break-words">{genError}</span>
            </div>
          )}

          {result && resultUrl && (
            <div className="mt-4 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--chip)] p-4">
              <div className="mb-2 flex items-center gap-2 text-xs text-[var(--muted)]">
                <AudioLines className="h-4 w-4" />
                <span className="truncate">
                  {result.format.toUpperCase()} · {(result.bytes / 1024).toFixed(0)} KB
                </span>
              </div>
              {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
              <audio controls src={resultUrl} className="w-full" />
              <div className="mt-2 flex justify-end">
                <Button variant="outline" onClick={() => downloadAudioResult(result)}>
                  <Download className="h-4 w-4" /> Download {result.filename}
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

/** A copy-to-clipboard command line. */
function CopyableCommand({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };
  return (
    <div className="flex items-start gap-2 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg)] px-2.5 py-2">
      <code className="min-w-0 flex-1 whitespace-pre-wrap break-all font-mono text-[11px] leading-relaxed text-[var(--fg)]">
        {command}
      </code>
      <button
        type="button"
        onClick={() => void copy()}
        className="grid h-6 w-6 shrink-0 place-items-center rounded-[var(--radius-md)] text-[var(--subtle)] transition-colors hover:bg-[var(--chip)] hover:text-[var(--fg)]"
        title="Copy command"
        aria-label="Copy command"
      >
        {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      </button>
    </div>
  );
}

/** Provider cards + add-custom button. */
function ProviderSection({
  providers,
  definitionOf,
  onConfigure,
  onAddCustom,
  onReload,
}: {
  providers: TtsProvider[];
  definitionOf: (kind: TtsProvider["kind"]) => TtsProviderDefinition | undefined;
  onConfigure: (id: string) => void;
  onAddCustom: () => void;
  onReload: () => void;
}) {
  return (
    <section className="mb-8">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-[var(--fg)]">
          <Settings2 className="h-4 w-4 text-[var(--subtle)]" /> Providers
        </h2>
        <div className="flex items-center gap-2">
          <Button variant="ghost" onClick={onReload} title="Refresh">
            <RefreshCw className="h-4 w-4" /> Refresh
          </Button>
          <Button variant="outline" onClick={onAddCustom}>
            <Plus className="h-4 w-4" /> Add custom
          </Button>
        </div>
      </div>

      {providers.length === 0 ? (
        <EmptyState icon={<Volume2 className="h-8 w-8" />}>
          No TTS providers yet. Add a custom OpenAI-compatible provider to get started.
        </EmptyState>
      ) : (
        <ul className="m-0 grid list-none grid-cols-1 gap-3 p-0 sm:grid-cols-2">
          {providers.map((provider) => (
            <ProviderCard
              key={provider.id}
              provider={provider}
              definition={definitionOf(provider.kind)}
              onConfigure={() => onConfigure(provider.id)}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function ProviderCard({
  provider,
  definition,
  onConfigure,
}: {
  provider: TtsProvider;
  definition?: TtsProviderDefinition;
  onConfigure: () => void;
}) {
  const usable = provider.kind === "custom" || provider.hasApiKey || !definition?.requiresApiKey;
  const status =
    !provider.enabled
      ? { label: "Disabled", cls: "bg-[var(--chip)] text-[var(--muted)]" }
      : usable
        ? { label: "Ready", cls: "bg-emerald-500/15 text-emerald-600" }
        : { label: "Add API key", cls: "bg-amber-500/15 text-amber-600" };

  return (
    <li className="flex h-full flex-col rounded-[var(--radius-xl)] bg-[var(--bg)] p-5" style={{ boxShadow: "var(--shadow-chip)" }}>
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-sm font-semibold text-[var(--fg)]">{provider.name}</h3>
            <span className="shrink-0 rounded-full bg-[var(--chip)] px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-[var(--muted)]">
              {KIND_BADGE[provider.kind]}
            </span>
          </div>
          <p className="mt-1 line-clamp-2 text-xs text-[var(--muted)]">
            {definition?.description ?? "OpenAI-compatible text-to-speech provider."}
          </p>
        </div>
        <span className={cn("inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium", status.cls)}>
          {status.label}
        </span>
      </div>

      <p className="mb-1 truncate font-mono text-[11px] text-[var(--subtle)]" title={provider.baseUrl}>
        {provider.baseUrl || "no base URL"}
      </p>
      {(provider.model || provider.voice) && (
        <p className="mb-3 truncate text-[11px] text-[var(--subtle)]">
          {provider.model || "—"}
          {provider.voice ? ` · ${provider.voice}` : ""}
        </p>
      )}
      {provider.kind === "custom" && (provider.models.length > 0 || provider.voices.length > 0) && (
        <p className="mb-3 text-[11px] text-[var(--subtle)]">
          {provider.models.length} model{provider.models.length === 1 ? "" : "s"} · {provider.voices.length} voice
          {provider.voices.length === 1 ? "" : "s"}
        </p>
      )}

      <div className="mt-auto flex items-center gap-2 pt-2">
        <Button variant="outline" className="flex-1" onClick={onConfigure}>
          <Settings2 className="h-4 w-4" /> Configure
        </Button>
        {definition?.docsUrl && (
          <a
            href={definition.docsUrl}
            target="_blank"
            rel="noreferrer"
            className="grid h-9 w-9 place-items-center rounded-[var(--radius-md)] text-[var(--subtle)] transition-colors hover:bg-[var(--chip)] hover:text-[var(--fg)]"
            title="Open documentation"
          >
            <ExternalLink className="h-4 w-4" />
          </a>
        )}
      </div>
    </li>
  );
}

/** The generation studio: provider → model → voice → text → audio. */
/** Agent voice settings: the provider + voice the agent uses for `generate_speech`. */
function AgentSpeechSettings({ providers }: { providers: TtsProvider[] }) {
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [providerId, setProviderId] = useState(() => providers[0]?.id ?? "");
  const [model, setModel] = useState("");
  const [voice, setVoice] = useState("");
  const [language, setLanguage] = useState("");
  const [format, setFormat] = useState<TtsOutputFormat | "">("");
  const [speed, setSpeed] = useState("");
  const [instructions, setInstructions] = useState("");
  const [models, setModels] = useState<TtsModel[]>([]);
  const [voices, setVoices] = useState<TtsVoice[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [loadingVoices, setLoadingVoices] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Load the persisted settings once.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const payload = await fetchTtsAgentConfig();
        if (cancelled) return;
        const c = payload.config;
        setProviderId((prev) => c.providerId || prev);
        setModel(c.model);
        setVoice(c.voice);
        setLanguage(c.language);
        setFormat((c.responseFormat as TtsOutputFormat) || "");
        setSpeed(c.speed != null ? String(c.speed) : "");
        setInstructions(c.instructions);
      } catch (e) {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const provider = providers.find((p) => p.id === providerId) ?? null;
  const isLocal = provider?.kind === "localtts";
  const pinned = providerId !== "";

  const markDirty = () => setSaved(false);

  // Load the pinned provider's models (skipped for local TTS, which owns its voice).
  useEffect(() => {
    if (!provider || isLocal) return;
    let cancelled = false;
    void (async () => {
      setLoadingModels(true);
      try {
        const list = await fetchTtsModels(provider.id);
        if (cancelled) return;
        const effective =
          list.length > 0
            ? list
            : provider.models.map((id) => ({ id, name: id, voices: [], languages: [] }));
        setModels(effective);
        // Default to a supported model (the provider's saved default, else the first one).
        setModel((prev) =>
          prev && effective.some((m) => m.id === prev) ? prev : provider.model || effective[0]?.id || "",
        );
      } catch {
        if (!cancelled) {
          const fallback = provider.models.map((id) => ({ id, name: id, voices: [], languages: [] }));
          setModels(fallback);
          setModel((prev) =>
            prev && fallback.some((m) => m.id === prev) ? prev : provider.model || fallback[0]?.id || "",
          );
        }
      } finally {
        if (!cancelled) setLoadingModels(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [provider, isLocal]);

  // Load voices for the pinned provider + model.
  useEffect(() => {
    if (!provider || isLocal || !model) return;
    let cancelled = false;
    void (async () => {
      setLoadingVoices(true);
      const manual = provider.voices.map((id) => ({ id, name: id, model }));
      try {
        const list = await fetchTtsVoices(provider.id, model);
        if (!cancelled) {
          const merged = dedupeVoices([...list, ...manual]);
          setVoices(merged);
          // Only keep a voice the selected model actually supports; otherwise clear it.
          setVoice((prev) => (prev && merged.some((v) => v.id === prev) ? prev : merged[0]?.id || ""));
        }
      } catch {
        if (!cancelled) setVoices(manual);
      } finally {
        if (!cancelled) setLoadingVoices(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [provider, isLocal, model]);

  const onProviderChange = (id: string) => {
    const next = providers.find((p) => p.id === id) ?? null;
    setProviderId(id);
    setModel(next?.model ?? "");
    setVoice(next?.voice ?? "");
    setLanguage(next?.language ?? "");
    setFormat((next?.responseFormat as TtsOutputFormat) || "");
    setSpeed("");
    setInstructions("");
    setModels([]);
    setVoices([]);
    markDirty();
  };

  const save = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      await updateTtsAgentConfig({
        providerId: pinned ? providerId : "",
        model: pinned && !isLocal ? model : "",
        voice: pinned && !isLocal ? voice : "",
        language: pinned && !isLocal ? language.trim() : "",
        responseFormat: pinned ? format : "",
        speed:
          pinned && !isLocal && speed.trim() !== "" && Number.isFinite(Number(speed))
            ? Number(speed)
            : null,
        instructions: pinned && !isLocal ? instructions.trim() : "",
      });
      setSaved(true);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="mb-6">
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-[var(--fg)]">
        <Volume2 className="h-4 w-4 text-[var(--subtle)]" /> Agent voice
      </h2>
      <div
        className="rounded-[var(--radius-xl)] border border-[var(--border)] bg-[var(--bg)] p-5"
        style={{ boxShadow: "var(--shadow-chip)" }}
      >
        <p className="mb-4 text-[11px] leading-relaxed text-[var(--subtle)]">
          The provider and voice the agent uses when it speaks (the generate_speech tool).
        </p>

        {loadError && (
          <div className="mb-3 flex items-start gap-2 rounded-[var(--radius-md)] border border-[color:color-mix(in_oklab,var(--danger)_35%,transparent)] bg-[var(--danger-soft)] p-3 text-xs text-[var(--danger)]">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{loadError}</span>
          </div>
        )}

        {!loaded ? (
          <div className="flex items-center gap-2 py-4 text-xs text-[var(--muted)]">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading agent voice settings...
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Provider">
                <Select value={providerId} onChange={(e) => onProviderChange(e.target.value)}>
                  {providers.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                      {p.enabled ? "" : " (disabled)"}
                    </option>
                  ))}
                </Select>
              </Field>

              {pinned && !isLocal && (
                <Field
                  label="Model"
                  hint={loadingModels ? "loading..." : models.length ? `${models.length}` : undefined}
                >
                  {models.length > 0 ? (
                    <Select
                      value={model}
                      onChange={(e) => {
                        setModel(e.target.value);
                        markDirty();
                      }}
                    >
                      {models.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name}
                        </option>
                      ))}
                    </Select>
                  ) : (
                    <TextInput
                      value={model}
                      onChange={(e) => {
                        setModel(e.target.value);
                        markDirty();
                      }}
                      placeholder={provider?.model || "model id"}
                    />
                  )}
                </Field>
              )}

              {pinned && !isLocal && (
                <Field
                  label="Voice"
                  hint={loadingVoices ? "loading..." : voices.length ? `${voices.length}` : undefined}
                >
                  {voices.length > 0 ? (
                    <Select
                      value={voice}
                      onChange={(e) => {
                        setVoice(e.target.value);
                        markDirty();
                      }}
                    >
                      {voices.map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.name}
                          {v.language ? ` (${v.language})` : ""}
                        </option>
                      ))}
                    </Select>
                  ) : (
                    <TextInput
                      value={voice}
                      onChange={(e) => {
                        setVoice(e.target.value);
                        markDirty();
                      }}
                      placeholder={provider?.voice || "voice id"}
                    />
                  )}
                </Field>
              )}

              {pinned && (
                <Field label="Format" hint="output container">
                  <Select
                    value={format}
                    onChange={(e) => {
                      setFormat(e.target.value as TtsOutputFormat | "");
                      markDirty();
                    }}
                  >
                    <option value="">Provider default</option>
                    {OUTPUT_FORMATS.map((f) => (
                      <option key={f} value={f}>
                        {f.toUpperCase()}
                      </option>
                    ))}
                  </Select>
                </Field>
              )}

              {pinned && !isLocal && (
                <Field label="Language" hint="optional BCP-47">
                  <TextInput
                    value={language}
                    onChange={(e) => {
                      setLanguage(e.target.value);
                      markDirty();
                    }}
                    placeholder="en-US"
                  />
                </Field>
              )}

              {pinned && !isLocal && (
                <Field label="Speed" hint="optional, provider-dependent">
                  <TextInput
                    value={speed}
                    onChange={(e) => {
                      setSpeed(e.target.value);
                      markDirty();
                    }}
                    placeholder="1.0"
                    inputMode="decimal"
                  />
                </Field>
              )}

              {pinned && !isLocal && (
                <Field label="Instructions" hint="optional tone / style">
                  <TextInput
                    value={instructions}
                    onChange={(e) => {
                      setInstructions(e.target.value);
                      markDirty();
                    }}
                    placeholder="Speak warmly and slowly"
                  />
                </Field>
              )}
            </div>

            {pinned && isLocal && (
              <p className="mt-3 text-[11px] leading-relaxed text-[var(--subtle)]">
                Local TTS chooses its own voice; only the output format is configurable here.
              </p>
            )}
          </>
        )}

        <div className="mt-4 flex items-center gap-3">
          <Button onClick={() => void save()} disabled={saving || !loaded}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            {saving ? "Saving..." : "Save agent voice"}
          </Button>
          {saved && (
            <span className="flex items-center gap-1 text-xs text-[var(--success)]">
              <Check className="h-3.5 w-3.5" /> Saved
            </span>
          )}
        </div>

        {saveError && (
          <div className="mt-3 flex items-start gap-2 rounded-[var(--radius-md)] border border-[color:color-mix(in_oklab,var(--danger)_35%,transparent)] bg-[var(--danger-soft)] p-3 text-xs text-[var(--danger)]">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <span className="break-words">{saveError}</span>
          </div>
        )}
      </div>
    </section>
  );
}

/** Configure (or create) a provider. */
function ProviderConfigModal({
  provider,
  definition,
  custom,
  onClose,
  onSaved,
  onDeleted,
}: {
  provider: TtsProvider | null;
  definition?: TtsProviderDefinition;
  custom: boolean;
  onClose: () => void;
  onSaved: (provider: TtsProvider) => void;
  onDeleted: (id: string) => void;
}) {
  // The modal is mounted only while open and keyed by provider id, so these
  // initializers run once per open — no reset effect needed.
  const [name, setName] = useState(provider?.name ?? definition?.name ?? "Custom provider");
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState(provider?.baseUrl ?? definition?.defaultBaseUrl ?? "");
  const [language, setLanguage] = useState(provider?.language ?? definition?.defaultLanguage ?? "");
  const [enabled, setEnabled] = useState(provider?.enabled ?? true);
  const [responseFormat, setResponseFormat] = useState<TtsOutputFormat | "">(
    (provider?.responseFormat as TtsOutputFormat) || "",
  );
  const [headers, setHeaders] = useState<CustomHeader[]>(provider?.headers ?? []);
  const [modelsText, setModelsText] = useState((provider?.models ?? []).join("\n"));
  const [voicesText, setVoicesText] = useState((provider?.voices ?? []).join("\n"));
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const save = async () => {
    setSaving(true);
    setFormError(null);
    try {
      const models = splitLines(modelsText);
      const voices = splitLines(voicesText);
      const base: TtsProviderInput = {
        kind: provider?.kind ?? "custom",
        name: name.trim(),
        enabled,
        baseUrl: baseUrl.trim(),
        language: language.trim(),
        responseFormat: responseFormat || "",
        headers: headers.filter((h) => h.key.trim()),
        models,
        voices,
        // A typed key replaces the stored one; an empty field keeps it.
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
      };
      const saved = provider
        ? await updateTtsProvider(provider.id, base)
        : await createTtsProvider(base);
      onSaved(saved);
    } catch (e) {
      setFormError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!provider) return;
    await deleteTtsProvider(provider.id);
    onDeleted(provider.id);
  };

  return (
    <>
      <Modal
        open
        onClose={onClose}
        size="lg"
        align="top"
        icon={<Settings2 className="h-4 w-4" />}
        title={provider ? `Configure ${provider.name}` : "Add custom TTS provider"}
        footer={
          <>
            {provider?.kind === "custom" && (
              <Button variant="danger" onClick={() => setConfirmDelete(true)} disabled={saving}>
                <Trash2 className="h-4 w-4" /> Delete
              </Button>
            )}
            <Button variant="ghost" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={() => void save()} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              {saving ? "Saving..." : "Save"}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4 p-5">
          {definition && definition.instructions.length > 0 && (
            <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--chip)] p-3">
              <div className="mb-1 flex items-center gap-2 text-xs font-semibold text-[var(--fg)]">
                <KeyRound className="h-3.5 w-3.5" /> How to set up {definition.name}
              </div>
              <ol className="m-0 list-decimal space-y-1 pl-4 text-xs leading-relaxed text-[var(--muted)]">
                {definition.instructions.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ol>
              <div className="mt-2 flex flex-wrap gap-3 text-xs">
                {definition.signupUrl && (
                  <a className="inline-flex items-center gap-1 text-[var(--secondary)] hover:underline" href={definition.signupUrl} target="_blank" rel="noreferrer">
                    Get an API key <ExternalLink className="h-3 w-3" />
                  </a>
                )}
                {definition.docsUrl && (
                  <a className="inline-flex items-center gap-1 text-[var(--secondary)] hover:underline" href={definition.docsUrl} target="_blank" rel="noreferrer">
                    Documentation <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </div>
            </div>
          )}

          {custom && (
            <Field label="Name">
              <TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder="Local TTS" />
            </Field>
          )}

          <Field label="Base URL" hint={custom ? "required, /audio/speech" : "advanced"}>
            <TextInput
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://api.example.com/v1"
            />
          </Field>

          <Field label="API key" hint={provider?.hasApiKey ? "•••• saved — leave blank to keep" : "optional for local servers"}>
            <TextInput
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={provider?.hasApiKey ? "Leave blank to keep the stored key" : "sk-..."}
              autoComplete="off"
            />
          </Field>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Field label="Language" hint="BCP-47">
              <TextInput
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
                placeholder="en-US"
              />
            </Field>
            <Field label="Default format">
              <Select value={responseFormat} onChange={(e) => setResponseFormat(e.target.value as TtsOutputFormat | "")}>
                <option value="">Provider default</option>
                {OUTPUT_FORMATS.map((f) => (
                  <option key={f} value={f}>
                    {f.toUpperCase()}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="flex items-end">
              <label className="flex items-center gap-2 text-sm text-[var(--muted)]">
                <Toggle checked={enabled} onChange={setEnabled} label="Enabled" />
                Provider enabled
              </label>
            </div>
          </div>

          {custom && (
            <>
              <HeadersEditor headers={headers} onChange={setHeaders} />
              <Field label="Models" hint="one per line">
                <TextArea rows={3} value={modelsText} onChange={(e) => setModelsText(e.target.value)} placeholder={"tts-1\nmy-model"} />
              </Field>
              <Field label="Voices" hint="one per line">
                <TextArea rows={3} value={voicesText} onChange={(e) => setVoicesText(e.target.value)} placeholder={"alloy\nnova"} />
              </Field>
            </>
          )}

          {formError && (
            <div className="flex items-start gap-2 rounded-[var(--radius-md)] border border-[color:color-mix(in_oklab,var(--danger)_35%,transparent)] bg-[var(--danger-soft)] p-3 text-xs text-[var(--danger)]">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
              <span className="break-words">{formError}</span>
            </div>
          )}
        </div>
      </Modal>

      <Modal
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        size="sm"
        icon={<Trash2 className="h-4 w-4" />}
        title="Delete provider?"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={() => void remove()}>
              Delete
            </Button>
          </>
        }
      >
        <p className="m-0 p-5 text-sm text-[var(--muted)]">
          This removes the provider and its stored API key. Generated audio is unaffected.
        </p>
      </Modal>
    </>
  );
}

/** Simple key/value header editor for custom providers. */
function HeadersEditor({
  headers,
  onChange,
}: {
  headers: CustomHeader[];
  onChange: (headers: CustomHeader[]) => void;
}) {
  const update = (index: number, patch: Partial<CustomHeader>) => {
    onChange(headers.map((h, i) => (i === index ? { ...h, ...patch } : h)));
  };
  const add = () => onChange([...headers, { key: "", value: "" }]);
  const remove = (index: number) => onChange(headers.filter((_, i) => i !== index));

  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-xs font-medium text-[var(--muted)]">Custom headers</span>
        <button
          type="button"
          onClick={add}
          className="inline-flex items-center gap-1 text-xs text-[var(--secondary)] hover:underline"
        >
          <Plus className="h-3 w-3" /> Add header
        </button>
      </div>
      {headers.length === 0 ? (
        <p className="text-[11px] text-[var(--subtle)]">No custom headers.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {headers.map((header, index) => (
            <div key={index} className="flex items-center gap-2">
              <TextInput
                value={header.key}
                onChange={(e) => update(index, { key: e.target.value })}
                placeholder="Header name"
                className="flex-1"
              />
              <TextInput
                value={header.value}
                onChange={(e) => update(index, { value: e.target.value })}
                placeholder="Value"
                className="flex-1"
              />
              <button
                type="button"
                onClick={() => remove(index)}
                className="grid h-9 w-9 shrink-0 place-items-center rounded-[var(--radius-md)] text-[var(--subtle)] transition-colors hover:bg-[var(--chip)] hover:text-[var(--danger)]"
                aria-label="Remove header"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function splitLines(value: string): string[] {
  return value
    .split(/[\n,]/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function dedupeVoices(voices: TtsVoice[]): TtsVoice[] {
  const seen = new Set<string>();
  const out: TtsVoice[] = [];
  for (const voice of voices) {
    if (!voice.id || seen.has(voice.id)) continue;
    seen.add(voice.id);
    out.push(voice);
  }
  return out;
}
