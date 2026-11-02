import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Check,
  Download,
  ExternalLink,
  Image as ImageIcon,
  ImagePlus,
  KeyRound,
  Loader2,
  Plus,
  RefreshCw,
  Settings2,
  Sparkles,
  Trash2,
  TriangleAlert,
  Wand2,
  X,
} from "lucide-react";
import { useStore } from "@/store/useStore";
import type {
  CustomHeader,
  ImageAspectRatio,
  ImageGenAgentConfig,
  ImageGenModel,
  ImageGenProvider,
  ImageGenProviderDefinition,
  ImageGenResult,
} from "@/types";
import {
  createImageGenProvider,
  deleteImageGenProvider,
  downloadImageResult,
  fetchImageGenAgentConfig,
  fetchImageGenModels,
  fetchImageGenProviders,
  generateImage,
  imageResultToDataUrl,
  updateImageGenAgentConfig,
  updateImageGenProvider,
  type ImageGenProviderInput,
  type ImageGenProvidersPayload,
} from "@/lib/imagegen";
import { Modal } from "@/components/ui/Modal";
import { Button, EmptyState, Field, PanelHeader, Select, TextArea, TextInput, Toggle } from "@/components/ui/primitives";
import { cn } from "@/utils/cn";

const ASPECT_RATIOS: ImageAspectRatio[] = ["1:1", "16:9", "9:16", "4:3", "3:4"];

const KIND_BADGE: Record<ImageGenProvider["kind"], string> = {
  openrouter: "Cloud",
  minimax: "Cloud",
  gemini: "Cloud",
  clipdrop: "Cloud",
  pollinations: "Free",
  nvidia: "Cloud",
  custom: "Custom",
};

/**
 * Image generation workspace.
 *
 * Configure image providers (OpenRouter, MiniMax, Google Gemini, Clipdrop,
 * Pollinations, NVIDIA, or any OpenAI-compatible endpoint), then generate images
 * from text. Models are fetched live where the provider exposes an endpoint; API
 * keys stay server-side.
 */
export function ImageGenPanel() {
  const setImageGenProviders = useStore((s) => s.setImageGenProviders);

  const [providers, setProviders] = useState<ImageGenProvider[]>([]);
  const [catalog, setCatalog] = useState<ImageGenProviderDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [configuringId, setConfiguringId] = useState<string | null>(null);
  const [creatingCustom, setCreatingCustom] = useState(false);

  const applyPayload = useCallback(
    (payload: ImageGenProvidersPayload) => {
      setProviders(payload.providers);
      setCatalog(payload.catalog);
      setImageGenProviders(payload.providers);
      setError(null);
    },
    [setImageGenProviders],
  );

  const reload = useCallback(async () => {
    try {
      applyPayload(await fetchImageGenProviders());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [applyPayload]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const payload = await fetchImageGenProviders();
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
    (kind: ImageGenProvider["kind"]): ImageGenProviderDefinition | undefined =>
      catalog.find((c) => c.kind === kind),
    [catalog],
  );

  const configuring = providers.find((p) => p.id === configuringId) ?? null;

  return (
    <div className="mx-auto w-full max-w-4xl panel-in">
      <PanelHeader kicker="Create images from text" title="Image generation" />
      <p className="mb-6 max-w-2xl text-sm leading-relaxed text-[var(--muted)]">
        Turn a prompt into an image with a cloud model or the free, keyless Pollinations provider.
        Cloud providers need an API key; models are fetched live where the provider supports it.
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
          <PlaygroundCard providers={providers} onRefresh={reload} />
          <ProviderSection
            providers={providers}
            definitionOf={definitionOf}
            onConfigure={setConfiguringId}
            onAddCustom={() => setCreatingCustom(true)}
            onReload={reload}
          />
          <AgentImageSettings providers={providers} />
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
            useStore.getState().upsertImageGenProvider(saved);
            setConfiguringId(null);
          }}
          onDeleted={(id) => {
            setProviders((prev) => prev.filter((p) => p.id !== id));
            useStore.getState().removeImageGenProvider(id);
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
            useStore.getState().upsertImageGenProvider(saved);
            setCreatingCustom(false);
          }}
          onDeleted={() => undefined}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ playground */

/**
 * Quick generation card: pick a connected provider, type a prompt, choose an aspect
 * ratio, and generate. The result is shown inline with a download action.
 */
function PlaygroundCard({
  providers,
  onRefresh,
}: {
  providers: ImageGenProvider[];
  onRefresh: () => void;
}) {
  const enabled = providers.filter((p) => p.enabled);
  const [providerId, setProviderId] = useState("");
  const [prompt, setPrompt] = useState("");
  const [aspectRatio, setAspectRatio] = useState<ImageAspectRatio>("1:1");
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [result, setResult] = useState<ImageGenResult | null>(null);

  // Derive the selected provider during render: keep an explicit choice when it is
  // still connected, otherwise fall back to the first connected provider.
  const activeProviderId = enabled.some((p) => p.id === providerId)
    ? providerId
    : enabled[0]?.id ?? "";
  const selected = enabled.find((p) => p.id === activeProviderId) ?? null;
  const dataUrl = useMemo(() => (result ? imageResultToDataUrl(result) : ""), [result]);

  const generate = async () => {
    if (!selected || !prompt.trim()) return;
    setGenError(null);
    setGenerating(true);
    setResult(null);
    try {
      const image = await generateImage({
        providerId: selected.id,
        prompt: prompt.trim(),
        model: selected.model || undefined,
        aspectRatio,
      });
      setResult(image);
      onRefresh();
    } catch (e) {
      setGenError(e instanceof Error ? e.message : String(e));
    } finally {
      setGenerating(false);
    }
  };

  return (
    <section
      className="mb-6 overflow-hidden rounded-[var(--radius-xl)] border border-[var(--border)] bg-[var(--chip)]"
      style={{ boxShadow: "var(--shadow-card)" }}
    >
      <div className="border-b border-[var(--border)] px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-[var(--radius-md)] bg-[var(--secondary)] text-[var(--secondary-fg)]">
            <Sparkles className="h-4 w-4" />
          </span>
          <div>
            <div className="text-sm font-semibold">Try it</div>
            <div className="text-[11px] text-[var(--muted)]">
              Generate an image with a connected provider
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-4 p-4 md:grid-cols-[1fr_minmax(0,18rem)]">
        <div className="space-y-3">
          <Field label="Prompt">
            <TextArea
              rows={4}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="A cozy bookshop on a rainy evening, warm window light, cinematic"
            />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Provider">
              <Select value={activeProviderId} onChange={(e) => setProviderId(e.target.value)}>
                {enabled.length === 0 && <option value="">No provider connected</option>}
                {enabled.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Aspect ratio">
              <Select
                value={aspectRatio}
                onChange={(e) => setAspectRatio(e.target.value as ImageAspectRatio)}
              >
                {ASPECT_RATIOS.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          {genError && (
            <div className="flex items-start gap-2 rounded-[var(--radius-md)] border border-[color:color-mix(in_oklab,var(--danger)_35%,transparent)] bg-[var(--danger-soft)] p-2.5 text-xs text-[var(--danger)]">
              <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{genError}</span>
            </div>
          )}
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] text-[var(--subtle)]">
              {selected?.model ? `model: ${selected.model}` : "provider default model"}
            </span>
            <Button
              onClick={generate}
              disabled={!selected || !prompt.trim() || generating}
              className="min-w-[7rem]"
            >
              {generating ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Generating
                </>
              ) : (
                <>
                  <Wand2 className="h-4 w-4" /> Generate
                </>
              )}
            </Button>
          </div>
        </div>

        <div className="flex min-h-[12rem] items-center justify-center overflow-hidden rounded-[var(--radius-lg)] border border-dashed border-[var(--border)] bg-[var(--bg)]">
          {generating ? (
            <div className="flex flex-col items-center gap-2 text-xs text-[var(--muted)]">
              <Loader2 className="h-5 w-5 animate-spin" /> Rendering...
            </div>
          ) : dataUrl ? (
            <div className="w-full">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={dataUrl} alt={prompt || "Generated image"} className="w-full object-contain" />
              <div className="flex items-center justify-between gap-2 border-t border-[var(--border)] px-3 py-2">
                <span className="truncate text-[10px] text-[var(--subtle)]">
                  {result?.providerName} · {result?.model} · {result?.aspectRatio}
                </span>
                {result && (
                  <button
                    type="button"
                    onClick={() => downloadImageResult(result)}
                    className="inline-flex items-center gap-1 rounded-[var(--radius-md)] border border-[var(--border)] px-2 py-1 text-[11px] text-[var(--muted)] transition hover:border-[var(--secondary)] hover:text-[var(--fg)]"
                  >
                    <Download className="h-3.5 w-3.5" /> Download
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2 px-6 text-center text-xs text-[var(--muted)]">
              <ImageIcon className="h-6 w-6 opacity-60" />
              <span>Your generated image will appear here.</span>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ providers */

function ProviderSection({
  providers,
  definitionOf,
  onConfigure,
  onAddCustom,
  onReload,
}: {
  providers: ImageGenProvider[];
  definitionOf: (kind: ImageGenProvider["kind"]) => ImageGenProviderDefinition | undefined;
  onConfigure: (id: string) => void;
  onAddCustom: () => void;
  onReload: () => void;
}) {
  return (
    <section className="mb-8">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-[var(--fg)]">Providers</h2>
        <div className="flex items-center gap-2">
          <Button variant="ghost" onClick={onReload} className="px-2 py-1 text-xs">
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </Button>
          <Button variant="outline" onClick={onAddCustom} className="px-3 py-1.5 text-xs">
            <Plus className="h-3.5 w-3.5" /> Custom
          </Button>
        </div>
      </div>

      {providers.length === 0 ? (
        <EmptyState icon={<ImagePlus className="h-6 w-6" />}>
          No image providers configured yet.
        </EmptyState>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {providers.map((provider) => (
            <ProviderCard
              key={provider.id}
              provider={provider}
              definition={definitionOf(provider.kind)}
              onConfigure={() => onConfigure(provider.id)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function ProviderCard({
  provider,
  definition,
  onConfigure,
}: {
  provider: ImageGenProvider;
  definition?: ImageGenProviderDefinition;
  onConfigure: () => void;
}) {
  const badge = KIND_BADGE[provider.kind] ?? "Cloud";
  const keyMissing = definition?.requiresApiKey === true && !provider.hasApiKey;
  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--chip)] p-3.5",
        !provider.enabled && "opacity-60",
      )}
      style={{ boxShadow: "var(--shadow-chip)" }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-semibold">{provider.name}</span>
            <span className="shrink-0 rounded-full border border-[var(--border)] px-1.5 py-0.5 text-[10px] text-[var(--muted)]">
              {badge}
            </span>
          </div>
          <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-[var(--muted)]">
            {definition?.description ?? ""}
          </p>
        </div>
        <span
          className={cn(
            "mt-0.5 inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px]",
            provider.enabled
              ? "bg-[color:color-mix(in_oklab,var(--success)_18%,transparent)] text-[var(--success)]"
              : "bg-[var(--chip)] text-[var(--subtle)]",
          )}
        >
          {provider.enabled ? <Check className="h-2.5 w-2.5" /> : <X className="h-2.5 w-2.5" />}
          {provider.enabled ? "On" : "Off"}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <Pill>{provider.model || "default model"}</Pill>
        <Pill>{provider.aspectRatio}</Pill>
        <Pill>
          <KeyRound className="h-2.5 w-2.5" />
          {provider.hasApiKey ? "Key set" : definition?.requiresApiKey ? "Key needed" : "No key"}
        </Pill>
      </div>

      {keyMissing && (
        <div className="rounded-[var(--radius-sm)] bg-[var(--danger-soft)] px-2 py-1.5 text-[10px] text-[var(--danger)]">
          An API key is required before generating with this provider.
        </div>
      )}

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-[10px] text-[var(--subtle)]">
          {definition?.docsUrl && (
            <a
              href={definition.docsUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 hover:text-[var(--fg)]"
            >
              <ExternalLink className="h-3 w-3" /> Docs
            </a>
          )}
        </div>
        <Button variant="outline" onClick={onConfigure} className="px-3 py-1.5 text-xs">
          <Settings2 className="h-3.5 w-3.5" /> Configure
        </Button>
      </div>
    </div>
  );
}

function Pill({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-[var(--border)] bg-[var(--bg)] px-2 py-0.5 text-[10px] text-[var(--muted)]">
      {children}
    </span>
  );
}

/* ------------------------------------------------------------------ agent settings */

function AgentImageSettings({ providers }: { providers: ImageGenProvider[] }) {
  const [config, setConfig] = useState<ImageGenAgentConfig | null>(null);
  const [autoProviderId, setAutoProviderId] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const payload = await fetchImageGenAgentConfig();
        if (cancelled) return;
        setConfig(payload.config);
        setAutoProviderId(payload.autoProviderId);
      } catch {
        // Best-effort: keep the section usable if the endpoint is unavailable.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const save = async () => {
    if (!config) return;
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const next = await updateImageGenAgentConfig({
        providerId: config.providerId,
        model: config.model,
        aspectRatio: config.aspectRatio,
      });
      setConfig(next);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  if (!config) return null;

  const autoName = autoProviderId
    ? providers.find((p) => p.id === autoProviderId)?.name ?? autoProviderId
    : null;

  return (
    <section className="rounded-[var(--radius-xl)] border border-[var(--border)] bg-[var(--chip)] p-4">
      <div className="mb-3">
        <h2 className="text-sm font-semibold text-[var(--fg)]">Agent image settings</h2>
        <p className="mt-0.5 text-[11px] text-[var(--muted)]">
          Used by the agent&apos;s <code className="font-mono">generate_image</code> tool. Leave the
          provider on Auto to use the best connected one
          {autoName ? ` (currently ${autoName})` : ""}.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Provider">
          <Select
            value={config.providerId}
            onChange={(e) => setConfig({ ...config, providerId: e.target.value })}
          >
            <option value="">Auto{autoName ? ` — ${autoName}` : ""}</option>
            {providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Model override">
          <TextInput
            value={config.model}
            placeholder="provider default"
            onChange={(e) => setConfig({ ...config, model: e.target.value })}
          />
        </Field>
        <Field label="Aspect ratio">
          <Select
            value={config.aspectRatio}
            onChange={(e) =>
              setConfig({ ...config, aspectRatio: e.target.value as ImageAspectRatio })
            }
          >
            {ASPECT_RATIOS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      {error && <div className="mt-3 text-xs text-[var(--danger)]">{error}</div>}

      <div className="mt-3 flex items-center justify-end gap-2">
        {saved && (
          <span className="inline-flex items-center gap-1 text-xs text-[var(--success)]">
            <Check className="h-3.5 w-3.5" /> Saved
          </span>
        )}
        <Button onClick={save} disabled={saving} className="px-4 py-1.5 text-xs">
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} Save
        </Button>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ config modal */

function ProviderConfigModal({
  provider,
  definition,
  custom,
  onClose,
  onSaved,
  onDeleted,
}: {
  provider: ImageGenProvider | null;
  definition?: ImageGenProviderDefinition;
  custom: boolean;
  onClose: () => void;
  onSaved: (provider: ImageGenProvider) => void;
  onDeleted: (id: string) => void;
}) {
  const [name, setName] = useState(provider?.name ?? definition?.name ?? "Custom provider");
  const [baseUrl, setBaseUrl] = useState(provider?.baseUrl ?? definition?.defaultBaseUrl ?? "");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState(provider?.model ?? definition?.defaultModel ?? "");
  const [aspectRatio, setAspectRatio] = useState<ImageAspectRatio>(
    provider?.aspectRatio ?? definition?.defaultAspectRatio ?? "1:1",
  );
  const [enabled, setEnabled] = useState(provider?.enabled ?? true);
  const [headers, setHeaders] = useState<CustomHeader[]>(provider?.headers ?? []);
  const [manualModels, setManualModels] = useState<string>((provider?.models ?? []).join("\n"));

  const [models, setModels] = useState<ImageGenModel[]>([]);
  const [fetchingModels, setFetchingModels] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const required = definition?.requiresApiKey === true;
  const keyPresent = provider?.hasApiKey === true || apiKey.trim().length > 0;

  const buildPatch = (): ImageGenProviderInput => ({
    ...(custom ? { name } : {}),
    baseUrl: baseUrl.trim(),
    apiKey,
    model: model.trim(),
    aspectRatio,
    enabled,
    ...(custom ? { headers, models: splitLines(manualModels) } : {}),
  });

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const saved = provider
        ? await updateImageGenProvider(provider.id, buildPatch())
        : await createImageGenProvider({
            kind: "custom",
            name,
            baseUrl: baseUrl.trim(),
            apiKey,
            model: model.trim(),
            aspectRatio,
            enabled,
            headers,
            models: splitLines(manualModels),
          });
      onSaved(saved);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!provider) return;
    setBusy(true);
    try {
      await deleteImageGenProvider(provider.id);
      onDeleted(provider.id);
    } finally {
      setBusy(false);
    }
  };

  const fetchModels = async () => {
    if (!provider) return;
    setFetchingModels(true);
    setModelsError(null);
    try {
      const list = await fetchImageGenModels(provider.id);
      setModels(list);
      if (list.length === 0) setModelsError("The provider returned no models.");
    } catch (e) {
      setModelsError(e instanceof Error ? e.message : String(e));
    } finally {
      setFetchingModels(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={provider ? `Configure ${provider.name}` : "Add custom provider"}
      icon={<ImageIcon className="h-4 w-4" />}
    >
      <div className="space-y-4">
        {definition && (
          <p className="rounded-[var(--radius-md)] bg-[var(--chip)] p-3 text-xs leading-relaxed text-[var(--muted)]">
            {definition.description}
          </p>
        )}

        {definition && definition.instructions.length > 0 && (
          <ol className="list-decimal space-y-1 pl-5 text-[11px] leading-relaxed text-[var(--muted)]">
            {definition.instructions.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ol>
        )}

        {custom && (
          <Field label="Name">
            <TextInput value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
        )}

        <Field label="Base URL" hint={custom ? "must expose /images/generations" : undefined}>
          <TextInput
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="https://api.example.com/v1"
          />
        </Field>

        <Field
          label="API key"
          hint={provider?.hasApiKey ? "a key is stored — leave blank to keep it" : required ? "required" : "optional"}
          hintError={required && !keyPresent}
        >
          <TextInput
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={provider?.hasApiKey ? "••••••••" : required ? "paste your API key" : "optional"}
            autoComplete="off"
          />
        </Field>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Model">
            <TextInput
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder={definition?.defaultModel || "model id"}
              list={models.length > 0 ? "image-model-options" : undefined}
            />
            {models.length > 0 && (
              <datalist id="image-model-options">
                {models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </datalist>
            )}
          </Field>
          <Field label="Default aspect ratio">
            <Select
              value={aspectRatio}
              onChange={(e) => setAspectRatio(e.target.value as ImageAspectRatio)}
            >
              {ASPECT_RATIOS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        {definition?.supportsModelListing && (
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" onClick={fetchModels} disabled={!provider || fetchingModels} className="px-3 py-1.5 text-xs">
              {fetchingModels ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              Fetch models
            </Button>
            {models.length > 0 && (
              <span className="text-[11px] text-[var(--muted)]">{models.length} model(s) available</span>
            )}
            {modelsError && <span className="text-[11px] text-[var(--danger)]">{modelsError}</span>}
            {!provider && (
              <span className="text-[11px] text-[var(--subtle)]">Save first to fetch models.</span>
            )}
          </div>
        )}

        {custom && (
          <div className="space-y-3 rounded-[var(--radius-md)] border border-[var(--border)] p-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-[var(--muted)]">Custom headers</span>
              <Button
                variant="ghost"
                className="px-2 py-1 text-[11px]"
                onClick={() => setHeaders([...headers, { key: "", value: "" }])}
              >
                <Plus className="h-3 w-3" /> Add
              </Button>
            </div>
            {headers.length === 0 && (
              <p className="text-[11px] text-[var(--subtle)]">No custom headers.</p>
            )}
            {headers.map((header, i) => (
              <div key={i} className="flex items-center gap-2">
                <TextInput
                  placeholder="Header"
                  value={header.key}
                  onChange={(e) => {
                    const next = [...headers];
                    next[i] = { ...header, key: e.target.value };
                    setHeaders(next);
                  }}
                />
                <TextInput
                  placeholder="Value"
                  value={header.value}
                  onChange={(e) => {
                    const next = [...headers];
                    next[i] = { ...header, value: e.target.value };
                    setHeaders(next);
                  }}
                />
                <IconTrash onClick={() => setHeaders(headers.filter((_, j) => j !== i))} />
              </div>
            ))}

            <Field label="Manual models" hint="one per line">
              <TextArea
                rows={3}
                value={manualModels}
                onChange={(e) => setManualModels(e.target.value)}
                placeholder={"sdxl\nflux"}
              />
            </Field>
          </div>
        )}

        <div className="flex items-center justify-between rounded-[var(--radius-md)] border border-[var(--border)] px-3 py-2">
          <span className="text-xs font-medium text-[var(--muted)]">Enabled</span>
          <Toggle checked={enabled} onChange={setEnabled} label="Enabled" />
        </div>

        {error && (
          <div className="flex items-start gap-2 rounded-[var(--radius-md)] bg-[var(--danger-soft)] p-2.5 text-xs text-[var(--danger)]">
            <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="flex items-center justify-between gap-2 pt-1">
          {custom && provider ? (
            <Button variant="danger" onClick={remove} disabled={busy} className="px-3 py-1.5 text-xs">
              <Trash2 className="h-3.5 w-3.5" /> Delete
            </Button>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={onClose} className="px-3 py-1.5 text-xs">
              Cancel
            </Button>
            <Button
              onClick={save}
              disabled={busy || (required && !keyPresent) || !baseUrl.trim()}
              className="px-4 py-1.5 text-xs"
            >
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              {provider ? "Save" : "Add provider"}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

function IconTrash({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Remove header"
      className="grid h-9 w-9 shrink-0 place-items-center rounded-[var(--radius-md)] text-[var(--muted)] transition hover:bg-[var(--danger-soft)] hover:text-[var(--danger)]"
    >
      <Trash2 className="h-3.5 w-3.5" />
    </button>
  );
}

function splitLines(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}
