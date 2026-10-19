import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AudioLines,
  Check,
  Download,
  ExternalLink,
  Loader2,
  Play,
  RefreshCw,
  Volume2,
  X,
} from "lucide-react";
import { useStore } from "@/store/useStore";
import type { TtsModelInfo, TtsProviderId, TtsProviderInfo, TtsSettings, TtsSpeechFile, TtsVoiceInfo } from "@/types";
import {
  fetchTtsLocalStatus,
  fetchTtsModels,
  fetchTtsPreview,
  fetchTtsProviders,
  fetchTtsVoices,
  ttsRequestConfig,
  ttsStudioWebUiUrl,
  type TtsLocalStatus,
  type TtsRequestConfig,
} from "@/lib/tts";
import { API_ROUTES, routeUrl } from "@/app/api/routes";
import { Button, Field, PanelHeader, Select, TextInput } from "@/components/ui/primitives";

/** Output formats per provider (values are the backend engine's format keys). */
const FORMAT_OPTIONS: Partial<Record<TtsProviderId, Array<{ value: string; label: string }>>> = {
  local: [
    { value: "mp3", label: "MP3" },
    { value: "wav", label: "WAV" },
    { value: "flac", label: "FLAC" },
    { value: "opus", label: "Opus (Ogg)" },
    { value: "aac", label: "AAC" },
    { value: "pcm", label: "PCM (raw)" },
  ],
  custom: [
    { value: "mp3", label: "MP3" },
    { value: "wav", label: "WAV" },
    { value: "flac", label: "FLAC" },
    { value: "opus", label: "Opus (Ogg)" },
    { value: "aac", label: "AAC" },
    { value: "pcm", label: "PCM (raw)" },
  ],
  openrouter: [
    { value: "mp3", label: "MP3" },
    { value: "pcm", label: "PCM (raw)" },
  ],
  azure_speech: [
    { value: "mp3", label: "MP3 24 kHz" },
    { value: "mp3_48k", label: "MP3 48 kHz HQ" },
    { value: "wav", label: "WAV 24 kHz" },
    { value: "wav_48k", label: "WAV 48 kHz" },
    { value: "ogg", label: "Opus (Ogg)" },
  ],
  elevenlabs: [
    { value: "mp3", label: "MP3 128 kbps" },
    { value: "mp3_high", label: "MP3 192 kbps" },
    { value: "wav", label: "WAV" },
    { value: "pcm", label: "PCM 24 kHz" },
  ],
  google: [
    { value: "mp3", label: "MP3" },
    { value: "wav", label: "WAV (LINEAR16)" },
    { value: "ogg", label: "Opus (Ogg)" },
  ],
  gradium: [
    { value: "wav", label: "WAV 48 kHz" },
    { value: "opus", label: "Opus (Ogg)" },
    { value: "pcm", label: "PCM (raw)" },
  ],
  inworld: [
    { value: "mp3", label: "MP3" },
    { value: "wav", label: "WAV (LINEAR16)" },
    { value: "ogg", label: "Opus (Ogg)" },
    { value: "flac", label: "FLAC" },
  ],
  minimax: [
    { value: "mp3", label: "MP3" },
    { value: "wav", label: "WAV" },
    { value: "flac", label: "FLAC" },
    { value: "pcm", label: "PCM (raw)" },
  ],
  volcengine: [
    { value: "mp3", label: "MP3" },
    { value: "wav", label: "WAV" },
    { value: "ogg", label: "Opus (Ogg)" },
    { value: "pcm", label: "PCM (raw)" },
  ],
  xai: [
    { value: "mp3", label: "MP3" },
    { value: "wav", label: "WAV" },
    { value: "pcm", label: "PCM (raw)" },
  ],
  xiaomi_mimo: [
    { value: "wav", label: "WAV" },
    { value: "mp3", label: "MP3" },
    { value: "pcm", label: "PCM (raw)" },
  ],
  kittenml: [
    { value: "mp3", label: "MP3" },
    { value: "wav", label: "WAV" },
    { value: "pcm", label: "PCM (raw)" },
  ],
};

const DEFAULT_BASE_URL: Partial<Record<TtsProviderId, string>> = {
  local: "http://127.0.0.1:8000/v1",
};

/** Defaults for a freshly selected provider. */
function draftFor(provider: TtsProviderId, current: TtsSettings): TtsSettings {
  if (current.provider === provider) return current;
  return {
    ...current,
    provider,
    apiKey: "",
    baseUrl: DEFAULT_BASE_URL[provider] ?? "",
    model: "",
    voice: "",
    language: "",
    speed: null,
    outputFormat: "",
    instructions: "",
    azureRegion: "",
    volcengineAppId: "",
    volcengineCluster: "",
    minimaxGroupId: "",
  };
}

/** A catalog select with a manual "type it yourself" fallback option. */
function CatalogSelect({
  value,
  onChange,
  items,
  placeholder,
  manualLabel,
}: {
  value: string;
  onChange: (next: string) => void;
  items: Array<{ id: string; label?: string }>;
  placeholder: string;
  manualLabel: string;
}) {
  const known = items.some((item) => item.id === value);
  return (
    <Select value={known || value ? (known ? value : "__manual__") : ""} onChange={(e) => {
      const v = e.target.value;
      onChange(v === "__manual__" ? (value || "") : v);
    }}>
      <option value="">{placeholder}</option>
      {value && !known && items.length > 0 && <option value="__manual__">{manualLabel}: {value}</option>}
      {items.map((item) => (
        <option key={item.id} value={item.id}>
          {item.label && item.label !== item.id ? `${item.label} (${item.id})` : item.id}
        </option>
      ))}
    </Select>
  );
}

/**
 * TTS / Voice panel — connect a text-to-speech provider so the agent's
 * generate_speech tool can speak. Local TTS Studio needs no API key: run the
 * service, configure the model + voice in its web UI, paste the base URL.
 * Cloud providers fetch their models/voices live from the provider APIs.
 */
export function TtsPanel() {
  const settings = useStore((s) => s.settings);
  const setSettings = useStore((s) => s.setSettings);
  const setPreview = useStore((s) => s.setPreview);
  const setPreviewOpen = useStore((s) => s.setPreviewOpen);

  const tts = settings.tts;

  const [providers, setProviders] = useState<TtsProviderInfo[]>([]);
  const [providersError, setProvidersError] = useState<string | null>(null);
  const [selected, setSelected] = useState<TtsProviderId | null>(tts.provider);
  const [draft, setDraft] = useState<TtsSettings>(tts);

  const [models, setModels] = useState<TtsModelInfo[]>([]);
  const [voices, setVoices] = useState<TtsVoiceInfo[]>([]);
  const [fetchingModels, setFetchingModels] = useState(false);
  const [fetchingVoices, setFetchingVoices] = useState(false);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [localStatus, setLocalStatus] = useState<TtsLocalStatus | null>(null);
  const [checkingLocal, setCheckingLocal] = useState(false);
  const [previewFile, setPreviewFile] = useState<TtsSpeechFile | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);

  const selectedInfo = useMemo(
    () => providers.find((p) => p.id === selected) ?? null,
    [providers, selected],
  );

  // Load the provider catalog once.
  useEffect(() => {
    const controller = new AbortController();
    fetchTtsProviders()
      .then((list) => setProviders(list))
      .catch((e) => setProvidersError(e instanceof Error ? e.message : String(e)));
    return () => controller.abort();
  }, []);

  // Keep the draft in sync when the user switches providers.
  const selectProvider = useCallback(
    (id: TtsProviderId) => {
      setSelected(id);
      setCatalogError(null);
      setModels([]);
      setVoices([]);
      setLocalStatus(null);
      setPreviewFile(null);
      setPreviewError(null);
      setDraft(draftFor(id, tts));
    },
    [tts],
  );

  const patchDraft = useCallback((patch: Partial<TtsSettings>) => {
    setDraft((d) => ({ ...d, ...patch }));
  }, []);

  const requestConfig = useMemo<TtsRequestConfig>(
    () => ttsRequestConfig(draft, selected ?? undefined),
    [draft, selected],
  );

  const loadModels = useCallback(async () => {
    if (!selectedInfo?.has_model_list) return;
    setFetchingModels(true);
    setCatalogError(null);
    try {
      setModels(await fetchTtsModels(requestConfig));
    } catch (e) {
      setCatalogError(e instanceof Error ? e.message : String(e));
    } finally {
      setFetchingModels(false);
    }
  }, [selectedInfo, requestConfig]);

  const loadVoices = useCallback(async () => {
    if (!selectedInfo?.has_voice_list) return;
    setFetchingVoices(true);
    setCatalogError(null);
    try {
      setVoices(await fetchTtsVoices(requestConfig));
    } catch (e) {
      setCatalogError(e instanceof Error ? e.message : String(e));
    } finally {
      setFetchingVoices(false);
    }
  }, [selectedInfo, requestConfig]);

  const checkLocal = useCallback(async () => {
    setCheckingLocal(true);
    setLocalStatus(null);
    try {
      setLocalStatus(await fetchTtsLocalStatus(requestConfig.baseUrl));
    } catch (e) {
      setLocalStatus({ reachable: false, error: e instanceof Error ? e.message : String(e) });
    } finally {
      setCheckingLocal(false);
    }
  }, [requestConfig.baseUrl]);

  const openStudioWebUi = useCallback(() => {
    const url = ttsStudioWebUiUrl(requestConfig.baseUrl);
    if (!url) return;
    setPreview(url);
    setPreviewOpen(true);
  }, [requestConfig.baseUrl, setPreview, setPreviewOpen]);

  const testVoice = useCallback(async () => {
    setPreviewing(true);
    setPreviewError(null);
    setPreviewFile(null);
    try {
      setPreviewFile(await fetchTtsPreview(requestConfig));
    } catch (e) {
      setPreviewError(e instanceof Error ? e.message : String(e));
    } finally {
      setPreviewing(false);
    }
  }, [requestConfig]);

  const missing: string[] = useMemo(() => {
    if (!selectedInfo) return [];
    const list: string[] = [];
    if (selectedInfo.requires_api_key && !draft.apiKey.trim()) list.push("API key");
    if (selectedInfo.requires_base_url && !draft.baseUrl.trim()) list.push("base URL");
    if (selectedInfo.id === "azure_speech" && !draft.azureRegion.trim()) list.push("region");
    if (selectedInfo.id === "volcengine" && !draft.volcengineAppId.trim()) list.push("App ID");
    if (selectedInfo.requires_voice && !draft.voice.trim()) list.push("voice");
    return list;
  }, [selectedInfo, draft]);

  const connected = tts.provider != null;
  const connectedInfo = providers.find((p) => p.id === tts.provider) ?? null;
  const dirty =
    selected != null &&
    (tts.provider !== selected || JSON.stringify(tts) !== JSON.stringify(draft));

  const connect = () => {
    if (!selected || missing.length > 0) return;
    setSettings({ tts: { ...draft, provider: selected } });
  };

  const disconnect = () => {
    setSettings({ tts: { ...draft, provider: null } });
  };

  const formatOptions = selected ? (FORMAT_OPTIONS[selected] ?? []) : [];

  return (
    <div>
      <PanelHeader kicker="Give your agent a voice" title="TTS / Voice" />
      <p className="mb-4 text-sm leading-relaxed text-[var(--muted)]">
        Connect a text-to-speech provider and the agent gains the{" "}
        <code className="rounded bg-[var(--chip)] px-1 py-0.5 font-mono text-[11px]">generate_speech</code>{" "}
        tool — it can then speak its answers aloud. The tool is available to the Main Agent, Custom
        Agents, and every agent inside a team or CEO system.
      </p>

      {/* Connection status */}
      <div className="mb-4 flex flex-wrap items-center gap-3 rounded-[var(--radius-xl)] border border-[var(--border)] bg-[var(--bg)] p-4" style={{ boxShadow: "var(--shadow-chip)" }}>
        <span className="grid h-9 w-9 place-items-center rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--chip)]">
          <AudioLines className="h-4 w-4 text-[var(--secondary)]" />
        </span>
        <div className="min-w-0 flex-1">
          {connected ? (
            <>
              <p className="text-sm font-medium text-[var(--fg)]">
                Connected — {connectedInfo?.label ?? tts.provider}
                {tts.model ? <span className="ml-1 font-normal text-[var(--muted)]">· {tts.model}</span> : null}
                {tts.voice ? <span className="ml-1 font-normal text-[var(--muted)]">· voice {tts.voice}</span> : null}
              </p>
              <p className="text-xs text-[var(--subtle)]">
                The agent can generate speech with the current configuration.
              </p>
            </>
          ) : (
            <>
              <p className="text-sm font-medium text-[var(--fg)]">No TTS provider connected</p>
              <p className="text-xs text-[var(--subtle)]">
                Pick a provider below, complete its setup, and connect it.
              </p>
            </>
          )}
        </div>
      </div>

      {/* Provider picker */}
      <h2 className="mb-2 text-xs font-medium uppercase tracking-[0.06em] text-[var(--subtle)]">Provider</h2>
      {providersError ? (
        <p className="mb-3 text-sm text-[var(--danger)]">{providersError}</p>
      ) : providers.length === 0 ? (
        <p className="mb-3 flex items-center gap-2 text-sm text-[var(--muted)]">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading providers…
        </p>
      ) : (
        <div className="mb-5 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {providers.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => selectProvider(p.id)}
              className={
                "flex flex-col gap-1 rounded-[var(--radius-md)] border p-3 text-left transition-colors " +
                (selected === p.id
                  ? "border-[var(--secondary)] bg-[var(--chip)]"
                  : "border-[var(--border)] hover:border-[var(--secondary)]")
              }
            >
              <span className="flex items-center gap-2 text-sm font-medium text-[var(--fg)]">
                <Volume2 className="h-3.5 w-3.5 text-[var(--muted)]" />
                {p.label}
                {tts.provider === p.id && (
                  <span className="ml-auto inline-flex items-center gap-1 rounded-full border border-emerald-500/40 px-1.5 py-0.5 text-[10px] text-emerald-600">
                    <Check className="h-3 w-3" /> connected
                  </span>
                )}
              </span>
              <span className="text-[11px] text-[var(--subtle)]">
                {p.requires_api_key ? "API key required" : p.requires_base_url ? "Base URL required" : "No key required"}
              </span>
            </button>
          ))}
        </div>
      )}

      {/* Selected provider configuration */}
      {selected && selectedInfo && (
        <div className="rounded-[var(--radius-xl)] border border-[var(--border)] bg-[var(--bg)] p-5" style={{ boxShadow: "var(--shadow-chip)" }}>
          <div className="mb-3 flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-[var(--fg)]">{selectedInfo.label}</h3>
            <Button variant="ghost" onClick={() => setSelected(null)} className="h-7 px-2 text-xs">
              <X className="h-3.5 w-3.5" /> Close
            </Button>
          </div>
          <p className="mb-4 text-xs leading-relaxed text-[var(--muted)]">{selectedInfo.instructions}</p>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {/* Local TTS Studio card */}
            {selected === "local" && (
              <>
                <Field label="TTS Studio base URL" hint="default http://127.0.0.1:8000/v1">
                  <TextInput
                    value={draft.baseUrl}
                    placeholder="http://127.0.0.1:8000/v1"
                    onChange={(e) => patchDraft({ baseUrl: e.target.value })}
                  />
                </Field>
                <Field label="API key (optional)" hint="only when 'Require an API key' is on in TTS Studio">
                  <TextInput
                    value={draft.apiKey}
                    placeholder="sk-tts-…"
                    onChange={(e) => patchDraft({ apiKey: e.target.value })}
                  />
                </Field>
                <div className="md:col-span-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Button variant="outline" onClick={checkLocal} disabled={checkingLocal || !draft.baseUrl.trim()}>
                      {checkingLocal ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                      Check status
                    </Button>
                    <Button variant="outline" onClick={openStudioWebUi} disabled={!draft.baseUrl.trim()}>
                      <ExternalLink className="h-3.5 w-3.5" /> Open TTS Studio web UI
                    </Button>
                  </div>
                  {localStatus && (
                    <p className={"mt-2 text-xs " + (localStatus.reachable ? "text-emerald-600" : "text-[var(--danger)]")}>
                      {localStatus.reachable
                        ? `Reachable — ${localStatus.info?.service ?? "TTS Studio"} is answering${localStatus.info?.auth_required ? " (API key required)" : ""}. Configure the TTS model + voice on its API page, then connect here.`
                        : `Not reachable: ${localStatus.error ?? "no answer"}. Install and start it: pip install tts-studio, then run tts-studio.`}
                    </p>
                  )}
                  <p className="mt-2 text-[11px] leading-relaxed text-[var(--subtle)]">
                    The model and voice are configured inside TTS Studio's web UI (Models &amp; Config +
                    API pages) — nothing to pick here. Any change you save there applies automatically;
                    this app only needs the base URL.
                  </p>
                </div>
              </>
            )}

            {/* Custom OpenAI-compatible card */}
            {selected === "custom" && (
              <>
                <Field label="Base URL" hint="OpenAI-compatible; localhost allowed">
                  <TextInput
                    value={draft.baseUrl}
                    placeholder="http://localhost:8000/v1"
                    onChange={(e) => patchDraft({ baseUrl: e.target.value })}
                  />
                </Field>
                <Field label="API key (optional)" hint="sent as a Bearer token">
                  <TextInput
                    value={draft.apiKey}
                    placeholder="none"
                    onChange={(e) => patchDraft({ apiKey: e.target.value })}
                  />
                </Field>
                <Field label="Model" hint="id your server expects (e.g. tts-1)">
                  <TextInput
                    value={draft.model}
                    placeholder="tts-1"
                    onChange={(e) => patchDraft({ model: e.target.value })}
                  />
                </Field>
                <Field label="Voice" hint="server-side voice id (may be ignored)">
                  <TextInput
                    value={draft.voice}
                    placeholder="alloy"
                    onChange={(e) => patchDraft({ voice: e.target.value })}
                  />
                </Field>
              </>
            )}

            {/* Cloud provider fields */}
            {selected !== "local" && selected !== "custom" && selectedInfo.requires_api_key && (
              <Field label="API key">
                <TextInput
                  type="password"
                  value={draft.apiKey}
                  placeholder={selected === "inworld" ? "Basic (Base64) credentials" : "API key"}
                  onChange={(e) => patchDraft({ apiKey: e.target.value })}
                />
              </Field>
            )}
            {selected === "azure_speech" && (
              <Field label="Region" hint="e.g. eastus">
                <TextInput
                  value={draft.azureRegion}
                  placeholder="eastus"
                  onChange={(e) => patchDraft({ azureRegion: e.target.value })}
                />
              </Field>
            )}
            {selected === "volcengine" && (
              <>
                <Field label="App ID" hint="from the Volcengine console">
                  <TextInput
                    value={draft.volcengineAppId}
                    onChange={(e) => patchDraft({ volcengineAppId: e.target.value })}
                  />
                </Field>
                <Field label="Cluster" hint="default volcano_tts">
                  <TextInput
                    value={draft.volcengineCluster}
                    placeholder="volcano_tts"
                    onChange={(e) => patchDraft({ volcengineCluster: e.target.value })}
                  />
                </Field>
              </>
            )}
            {selected === "minimax" && (
              <Field label="GroupId (optional)" hint="only for accounts that require it">
                <TextInput
                  value={draft.minimaxGroupId}
                  onChange={(e) => patchDraft({ minimaxGroupId: e.target.value })}
                />
              </Field>
            )}

            {/* Model catalog (live where the provider exposes one) */}
            {selected !== "local" && selectedInfo.has_model_list && (
              <Field
                label="Model"
                hint={
                  fetchingModels ? "loading…" : models.length > 0 ? `${models.length} models` : "fetch from provider"
                }
              >
                <div className="flex gap-2">
                  <div className="min-w-0 flex-1">
                    <CatalogSelect
                      value={draft.model}
                      onChange={(v) => patchDraft({ model: v })}
                      items={models}
                      placeholder="Select a model…"
                      manualLabel="Custom"
                    />
                  </div>
                  <Button variant="outline" onClick={loadModels} disabled={fetchingModels} className="shrink-0 px-2.5">
                    {fetchingModels ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                  </Button>
                </div>
              </Field>
            )}

            {/* Voice catalog (live where the provider exposes one) */}
            {selected !== "local" && selectedInfo.has_voice_list && (
              <Field
                label="Voice"
                hint={
                  fetchingVoices ? "loading…" : voices.length > 0 ? `${voices.length} voices` : "fetch from provider"
                }
              >
                <div className="flex gap-2">
                  <div className="min-w-0 flex-1">
                    <CatalogSelect
                      value={draft.voice}
                      onChange={(v) => patchDraft({ voice: v })}
                      items={voices}
                      placeholder="Select a voice…"
                      manualLabel="Custom"
                    />
                  </div>
                  <Button variant="outline" onClick={loadVoices} disabled={fetchingVoices} className="shrink-0 px-2.5">
                    {fetchingVoices ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                  </Button>
                </div>
              </Field>
            )}

            {/* Free-text voice for providers without a list endpoint */}
            {(selected === "volcengine" || (selected === "openrouter" && voices.length === 0)) && (
              <Field
                label="Voice"
                hint={selected === "volcengine" ? "voice_type from the Volcengine catalog" : "per the model's voice list"}
              >
                <TextInput
                  value={draft.voice}
                  placeholder={selected === "volcengine" ? "zh_female_vv_uranus_bigtts" : "voice id"}
                  onChange={(e) => patchDraft({ voice: e.target.value })}
                />
              </Field>
            )}

            {/* Language */}
            {(selected === "xai" || selected === "google" || selected === "azure_speech") && (
              <Field label="Language" hint="BCP-47 (e.g. en, en-US)">
                <TextInput
                  value={draft.language}
                  placeholder={selected === "xai" ? "en or auto" : "en-US"}
                  onChange={(e) => patchDraft({ language: e.target.value })}
                />
              </Field>
            )}

            {/* Speed */}
            {selected !== "local" && selected !== "custom" && selected !== "kittenml" && selected !== "gradium" && (
              <Field label="Speed" hint="1.0 = normal">
                <TextInput
                  type="number"
                  step="0.05"
                  min="0.5"
                  max="2"
                  value={draft.speed ?? ""}
                  placeholder="1.0"
                  onChange={(e) => patchDraft({ speed: e.target.value === "" ? null : Number(e.target.value) })}
                />
              </Field>
            )}

            {/* Output format */}
            {formatOptions.length > 0 && (
              <Field label="Output format">
                <Select value={draft.outputFormat} onChange={(e) => patchDraft({ outputFormat: e.target.value })}>
                  <option value="">Provider default</option>
                  {formatOptions.map((f) => (
                    <option key={f.value} value={f.value}>{f.label}</option>
                  ))}
                </Select>
              </Field>
            )}

            {/* Instructions (OpenRouter / MiMo style guidance) */}
            {(selected === "openrouter" || selected === "xiaomi_mimo") && (
              <Field label="Delivery instructions (optional)" hint="tone / pacing guidance">
                <TextInput
                  value={draft.instructions}
                  placeholder="Speak in a warm, friendly tone."
                  onChange={(e) => patchDraft({ instructions: e.target.value })}
                />
              </Field>
            )}
          </div>

          {catalogError && (
            <p className="mt-3 text-xs text-[var(--danger)]">{catalogError}</p>
          )}

          {/* Test + connect */}
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Button variant="outline" onClick={testVoice} disabled={previewing || missing.length > 0}>
              {previewing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
              Test voice
            </Button>
            {connected && tts.provider === selected ? (
              <>
                <Button variant="danger" onClick={disconnect}>
                  Disconnect
                </Button>
                {dirty && (
                  <Button onClick={connect}>Save changes</Button>
                )}
              </>
            ) : (
              <Button onClick={connect} disabled={missing.length > 0}>
                <Check className="h-3.5 w-3.5" /> Connect
              </Button>
            )}
            {missing.length > 0 && (
              <span className="text-xs text-[var(--subtle)]">Missing: {missing.join(", ")}</span>
            )}
          </div>

          {previewError && <p className="mt-2 text-xs text-[var(--danger)]">{previewError}</p>}
          {previewFile && (
            <div className="mt-3 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--chip)] p-3">
              <p className="mb-2 text-xs font-medium text-[var(--fg)]">
                Preview — {previewFile.name}
              </p>
              {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
              <audio
                controls
                className="w-full"
                src={routeUrl(API_ROUTES.filesPreview, { query: { path: previewFile.path } })}
              />
              <a
                href={routeUrl(API_ROUTES.filesDownload, { query: { path: previewFile.path } })}
                download={previewFile.name}
                className="mt-2 inline-flex items-center gap-1 text-[11px] text-[var(--muted)] hover:text-[var(--fg)]"
              >
                <Download className="h-3 w-3" /> Download
              </a>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
