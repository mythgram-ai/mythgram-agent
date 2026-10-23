import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AudioLines,
  Check,
  Download,
  ExternalLink,
  KeyRound,
  Loader2,
  Play,
  Plus,
  RefreshCw,
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
  fetchTtsModels,
  fetchTtsProviders,
  fetchTtsVoices,
  synthesizeTts,
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
        Turn text into natural speech with a cloud voice. Add an API key for a provider below, fetch its
        models and voices, then generate audio you can play or download. Keys are stored server-side only.
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
          <ProviderSection
            providers={providers}
            definitionOf={definitionOf}
            onConfigure={setConfiguringId}
            onAddCustom={() => setCreatingCustom(true)}
            onReload={reload}
          />

          <Studio
            providers={providers}
            definitionOf={definitionOf}
            onConfigure={setConfiguringId}
          />
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
function Studio({
  providers,
  definitionOf,
  onConfigure,
}: {
  providers: TtsProvider[];
  definitionOf: (kind: TtsProvider["kind"]) => TtsProviderDefinition | undefined;
  onConfigure: (id: string) => void;
}) {
  const usable = useMemo(
    () =>
      providers.filter((p) => {
        if (!p.enabled) return false;
        const def = definitionOf(p.kind);
        return p.kind === "custom" || !def?.requiresApiKey || p.hasApiKey;
      }),
    [providers, definitionOf],
  );

  const [providerId, setProviderId] = useState("");
  const [models, setModels] = useState<TtsModel[]>([]);
  const [voices, setVoices] = useState<TtsVoice[]>([]);
  const [model, setModel] = useState("");
  const [voice, setVoice] = useState("");
  const [text, setText] = useState("");
  const [format, setFormat] = useState<TtsOutputFormat | "">("");
  const [speed, setSpeed] = useState("");
  const [instructions, setInstructions] = useState("");
  const [loadingModels, setLoadingModels] = useState(false);
  const [loadingVoices, setLoadingVoices] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState<TtsAudioResult | null>(null);
  const [engineError, setEngineError] = useState<string | null>(null);

  // Default the selection to the first usable provider without an effect.
  const effectiveProviderId = providerId || usable[0]?.id || "";
  const provider = usable.find((p) => p.id === effectiveProviderId) ?? null;

  // Derive a playable object URL from the result and revoke it when it changes.
  const resultUrl = useMemo(
    () => (result ? URL.createObjectURL(audioResultToBlob(result)) : ""),
    [result],
  );
  useEffect(() => {
    return () => {
      if (resultUrl) URL.revokeObjectURL(resultUrl);
    };
  }, [resultUrl]);

  // Load models when the provider changes (fetch = synchronizing with a server).
  useEffect(() => {
    if (!provider) return;
    let cancelled = false;
    void (async () => {
      setLoadingModels(true);
      setEngineError(null);
      try {
        const list = await fetchTtsModels(provider.id);
        if (cancelled) return;
        setModels(list);
        setModel((prev) => prev || provider.model || list[0]?.id || "");
      } catch (e) {
        if (cancelled) return;
        setModels(provider.models.map((id) => ({ id, name: id, voices: [], languages: [] })));
        setModel((prev) => prev || provider.model || provider.models[0] || "");
        setEngineError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoadingModels(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [provider]);

  // Load voices when the model changes.
  useEffect(() => {
    if (!provider || !model) return;
    let cancelled = false;
    void (async () => {
      setLoadingVoices(true);
      try {
        const list = await fetchTtsVoices(provider.id, model);
        if (cancelled) return;
        const manual = provider.voices.map((id) => ({ id, name: id, model }));
        const merged = dedupeVoices([...list, ...manual]);
        setVoices(merged);
        setVoice((prev) =>
          prev && merged.some((v) => v.id === prev) ? prev : provider.voice || merged[0]?.id || "",
        );
      } catch {
        if (cancelled) return;
        const manual = provider.voices.map((id) => ({ id, name: id, model }));
        setVoices(manual);
        setVoice((prev) => prev || provider.voice || manual[0]?.id || "");
      } finally {
        if (!cancelled) setLoadingVoices(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [provider, model]);

  const generate = async () => {
    if (!provider) return;
    setGenerating(true);
    setEngineError(null);
    setResult(null);
    try {
      const audio = await synthesizeTts({
        providerId: provider.id,
        text,
        model: model || undefined,
        voice: voice || undefined,
        format: format || undefined,
        speed: speed.trim() !== "" && Number.isFinite(Number(speed)) ? Number(speed) : undefined,
        instructions: instructions.trim() || undefined,
      });
      setResult(audio);
    } catch (e) {
      setEngineError(e instanceof Error ? e.message : String(e));
    } finally {
      setGenerating(false);
    }
  };

  if (usable.length === 0) {
    return (
      <section className="mb-8">
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-[var(--fg)]">
          <Play className="h-4 w-4 text-[var(--subtle)]" /> Generate speech
        </h2>
        <EmptyState icon={<KeyRound className="h-8 w-8" />}>
          Add an API key to a cloud provider (or an endpoint for a custom provider) to start generating speech.
        </EmptyState>
      </section>
    );
  }

  const definition = provider ? definitionOf(provider.kind) : undefined;

  return (
    <section className="mb-4">
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-[var(--fg)]">
        <Play className="h-4 w-4 text-[var(--subtle)]" /> Generate speech
      </h2>

      <div className="rounded-[var(--radius-xl)] border border-[var(--border)] bg-[var(--bg)] p-5" style={{ boxShadow: "var(--shadow-chip)" }}>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Provider">
            <Select value={effectiveProviderId} onChange={(e) => setProviderId(e.target.value)}>
              {usable.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </Field>

          <Field
            label="Model"
            hint={loadingModels ? "loading..." : models.length ? `${models.length}` : undefined}
          >
            {models.length > 0 ? (
              <Select value={model} onChange={(e) => setModel(e.target.value)}>
                {models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </Select>
            ) : (
              <TextInput
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder={provider?.model || "model id"}
              />
            )}
          </Field>

          <Field
            label="Voice"
            hint={loadingVoices ? "loading..." : voices.length ? `${voices.length}` : undefined}
          >
            {voices.length > 0 ? (
              <Select value={voice} onChange={(e) => setVoice(e.target.value)}>
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
                onChange={(e) => setVoice(e.target.value)}
                placeholder={provider?.voice || "voice id"}
              />
            )}
          </Field>

          <Field label="Format" hint="output container">
            <Select value={format} onChange={(e) => setFormat(e.target.value as TtsOutputFormat | "")}>
              <option value="">Provider default</option>
              {OUTPUT_FORMATS.map((f) => (
                <option key={f} value={f}>
                  {f.toUpperCase()}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <div className="mt-4">
          <Field label="Text" hint={`${text.length} chars`}>
            <TextArea
              rows={5}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Type or paste the text you want spoken..."
            />
          </Field>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Speed" hint="optional, provider-dependent">
            <TextInput
              value={speed}
              onChange={(e) => setSpeed(e.target.value)}
              placeholder="1.0"
              inputMode="decimal"
            />
          </Field>
          <Field label="Instructions" hint="optional tone / style">
            <TextInput
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              placeholder="Speak warmly and slowly"
            />
          </Field>
        </div>

        {definition && (
          <p className="mt-3 text-[11px] leading-relaxed text-[var(--subtle)]">
            {provider?.kind === "openrouter"
              ? "OpenRouter bills per character. Voices are per-model; picking a model loads its voices."
              : provider?.kind === "kittenml"
                ? "Kitten TTS 2 supports 170+ voices and 20 languages; the 0.8 models use 8 English voices."
                : "Any OpenAI-compatible /audio/speech endpoint works, including local servers."}
          </p>
        )}

        <div className="mt-4 flex items-center gap-2">
          <Button onClick={() => void generate()} disabled={generating || !text.trim()}>
            {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
            {generating ? "Generating..." : "Generate speech"}
          </Button>
          {provider && (
            <Button variant="ghost" onClick={() => onConfigure(provider.id)}>
              <Settings2 className="h-4 w-4" /> Configure
            </Button>
          )}
        </div>

        {engineError && (
          <div className="mt-3 flex items-start gap-2 rounded-[var(--radius-md)] border border-[color:color-mix(in_oklab,var(--danger)_35%,transparent)] bg-[var(--danger-soft)] p-3 text-xs text-[var(--danger)]">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <span className="break-words">{engineError}</span>
          </div>
        )}

        {result && resultUrl && (
          <div className="mt-4 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--chip)] p-4">
            <div className="mb-2 flex items-center gap-2 text-xs text-[var(--muted)]">
              <AudioLines className="h-4 w-4" />
              <span className="truncate">
                {result.model} · {result.voice || "default"} · {result.format.toUpperCase()} ·{" "}
                {(result.bytes / 1024).toFixed(0)} KB
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

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
