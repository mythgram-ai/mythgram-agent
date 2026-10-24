import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  ApiError,
  api,
  type InstalledVoice,
  type OpenAIApiSettings,
} from '../lib/api'
import { copyToClipboard } from '../lib/format'
import { useOnce, usePoll } from '../lib/hooks'
import {
  IconAlert,
  IconCopy,
  IconKey,
  IconRefresh,
  IconWave,
} from '../components/icons'
import { EmptyState, Panel, Spinner } from '../components/ui'

const LS_BASE_URL = 'piperstudio.apiBaseUrl'
const DEFAULT_BACKEND_PORT = 7878

function guessBaseUrl(basePath: string): string {
  const host = location.hostname || 'localhost'
  return `http://${host}:${DEFAULT_BACKEND_PORT}${basePath || '/v1'}`
}

export default function ApiPage() {
  const navigate = useNavigate()
  const { data: cfg, refresh: refreshCfg } = useOnce(() => api.openaiSettings())
  const { data: installed } = useOnce(() => api.installed())
  const { data: status } = usePoll(() => api.piperStatus(), 10000)

  // ── drafts, synced from the server once loaded ────────────────────
  const [baseUrl, setBaseUrl] = useState(() => localStorage.getItem(LS_BASE_URL) ?? '')
  const [keyDraft, setKeyDraft] = useState('')
  const [authOn, setAuthOn] = useState(false)
  const [voiceKey, setVoiceKey] = useState('')
  const [speakerId, setSpeakerId] = useState(0)
  const [speed, setSpeed] = useState(1.0)
  const [volume, setVolume] = useState(1.0)
  const [noiseScale, setNoiseScale] = useState(0.8)
  const [noiseWScale, setNoiseWScale] = useState(1.0)
  const [normalize, setNormalize] = useState(true)
  const [advanced, setAdvanced] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [pageError, setPageError] = useState<string | null>(null)

  useEffect(() => {
    if (!cfg) return
    setKeyDraft(cfg.api_key)
    setAuthOn(cfg.api_key_enabled)
    setVoiceKey(cfg.default_voice)
    setSpeakerId(cfg.speaker_id ?? 0)
    setSpeed(cfg.speed)
    setVolume(cfg.volume)
    setNoiseScale(cfg.noise_scale ?? 0.8)
    setNoiseWScale(cfg.noise_w_scale ?? 1.0)
    setNormalize(cfg.normalize)
  }, [cfg])

  useEffect(() => {
    if (!baseUrl) setBaseUrl(guessBaseUrl(cfg?.base_path ?? '/v1'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg?.base_path])

  const busy = useRef(false)
  const saveAuth = async (patch: { api_key_enabled?: boolean; api_key?: string | null }) => {
    if (busy.current) return
    busy.current = true
    setNote(null)
    setPageError(null)
    try {
      const res = await api.saveOpenAIAuth({
        ...(patch.api_key_enabled !== undefined ? { api_key_enabled: patch.api_key_enabled } : {}),
        ...(patch.api_key !== undefined && patch.api_key !== null ? { api_key: patch.api_key } : {}),
      })
      syncAll(res)
    } catch (err) {
      setPageError((err as ApiError).message)
    } finally {
      busy.current = false
    }
  }

  const saveDefaults = async (patch: Record<string, unknown>) => {
    if (busy.current) return
    busy.current = true
    setNote(null)
    setPageError(null)
    try {
      const res = await api.saveSpeechDefaults(patch)
      syncAll(res)
    } catch (err) {
      setPageError((err as ApiError).message)
      refreshCfg()
    } finally {
      busy.current = false
    }
  }

  const syncAll = (res: OpenAIApiSettings) => {
    setKeyDraft(res.api_key)
    setAuthOn(res.api_key_enabled)
    setVoiceKey(res.default_voice)
    setSpeakerId(res.speaker_id ?? 0)
    setSpeed(res.speed)
    setVolume(res.volume)
    setNoiseScale(res.noise_scale ?? 0.8)
    setNoiseWScale(res.noise_w_scale ?? 1.0)
    setNormalize(res.normalize)
    setNote('saved ✓')
    window.setTimeout(() => setNote(null), 2200)
  }

  const voice: InstalledVoice | null = useMemo(
    () => installed?.voices.find((v) => v.key === voiceKey) ?? null,
    [installed, voiceKey],
  )

  const speechUrl = useMemo(() => `${baseUrl.replace(/\/+$/, '')}/audio/speech`, [baseUrl])
  const modelsUrl = useMemo(() => `${baseUrl.replace(/\/+$/, '')}/models`, [baseUrl])

  const [copied, setCopied] = useState<string | null>(null)
  const copy = async (tag: string, text: string) => {
    const ok = await copyToClipboard(text)
    setCopied(ok ? tag : null)
    if (ok) window.setTimeout(() => setCopied((c) => (c === tag ? null : c)), 1800)
  }

  // ── local preview (uses the internal API directly) ─────────────────
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [ktur, setKtur] = useState(0)
  const [previewBusy, setPreviewBusy] = useState(false)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const lastPreview = useRef<string | null>(null)

  const previewVoice = async () => {
    if (!voiceKey || previewBusy) return
    setPreviewBusy(true)
    setPreviewError(null)
    try {
      const meta = await api.synthesize({
        key: voiceKey,
        text: 'This is a preview of the voice that API clients will hear.',
        speed,
        volume,
        noise_scale: advanced ? noiseScale : undefined,
        noise_w_scale: advanced ? noiseWScale : undefined,
        normalize: advanced && normalize ? true : undefined,
        speaker_id: voice && voice.num_speakers > 1 ? Math.min(speakerId, voice.num_speakers - 1) : undefined,
      })
      if (lastPreview.current) URL.revokeObjectURL(lastPreview.current)
      lastPreview.current = meta.blobUrl
      setPreviewUrl(meta.blobUrl)
      setKtur((n) => n + 1)
    } catch (err) {
      setPreviewError((err as ApiError).message)
    } finally {
      setPreviewBusy(false)
    }
  }

  const engineReady = status?.installed ?? false
  const noVoices = !installed || installed.voices.length === 0
  const formats = cfg?.formats ?? []
  const nativeFormats = cfg?.native_formats ?? []

  if (!cfg) {
    return (
      <div className="content-inner">
        <div className="page-head"><h1>API access</h1></div>
        <div className="empty-state"><Spinner size={18} /></div>
      </div>
    )
  }

  return (
    <div className="content-inner">
      <div className="page-head">
        <h1>API access</h1>
        <p>
          Expose this studio over an OpenAI-compatible speech API. Clients only ever need the
          base URL (plus the API key when auth is turned on) — model, voice and prosody stay
          configured here on the server.
        </p>
      </div>

      {pageError && (
        <div className="banner error">
          <span className="ico"><IconAlert size={15} /></span>
          <span>{pageError}</span>
        </div>
      )}

      {status && !engineReady && (
        <div className="banner">
          <span className="ico"><IconAlert size={15} /></span>
          <span>
            The synthesis engine is not installed, so API speech calls will fail until{' '}
            <Link to="/voices">piper-tts is installed</Link>.
          </span>
        </div>
      )}
      {engineReady && !voiceKey && !noVoices && (
        <div className="banner">
          <span className="ico"><IconAlert size={15} /></span>
          <span>
            No default voice is chosen yet — API speech calls return a “no_default_voice” error.
            Pick one below under <b>Default voice for API clients</b>.
          </span>
        </div>
      )}

      <div className="stack gap-16">
        {/* ── base url ────────────────────────────────────────────── */}
        <Panel
          title="OpenAI-compatible endpoint"
          extra={
            <span className="pill ok big"><span className="dot" />server-side configured</span>
          }
        >
          <div className="field-name">Base URL — the only thing clients need</div>
          <div className="row api-url-row">
            <input
              type="text"
              className="mono"
              value={baseUrl}
              spellCheck={false}
              onChange={(e) => {
                setBaseUrl(e.target.value)
                localStorage.setItem(LS_BASE_URL, e.target.value)
              }}
            />
            <button className="btn sm" onClick={() => void copy('baseurl', baseUrl)}>
              <IconCopy size={12} /> {copied === 'baseurl' ? 'Copied ✓' : 'Copy'}
            </button>
            <button
              className="btn sm ghost"
              title="reset to this machine's default"
              onClick={() => {
                const next = guessBaseUrl(cfg.base_path)
                setBaseUrl(next)
                localStorage.setItem(LS_BASE_URL, next)
              }}
            >
              <IconRefresh size={12} />
            </button>
          </div>
          <div className="field-hint">
            Edit the host when clients connect from another device on this network (the UI
            guesses it from where you opened this page). Endpoints:{' '}
            <code className="inline">POST {speechUrl}</code> ·{' '}
            <code className="inline">GET {modelsUrl}</code>
          </div>

          <hr className="hr" />
          <div className="field-hint">
            Defaults to WAV audio, no rate limits.{' '}
            <Link to="/voice-api/docs">Full documentation with client examples →</Link>
          </div>
        </Panel>

        {/* ── auth ───────────────────────────────────────────────── */}
        <Panel
          title="Authentication"
          extra={
            <span className={`pill big ${authOn ? 'ok' : 'plain'}`}>
              <span className="dot" />{authOn ? 'key required' : 'open access'}
            </span>
          }
        >
          <div className="row-wrap" style={{ alignItems: 'flex-start' }}>
            <label className="switch" style={{ marginTop: 4 }}>
              <input
                type="checkbox"
                checked={authOn}
                onChange={(e) => void saveAuth({ api_key_enabled: e.target.checked })}
              />
              <span className="track" />
              Require an API key
            </label>
            <div style={{ flex: 1, minWidth: 260 }}>
              <div className="row">
                <input
                  type="text"
                  className="mono"
                  placeholder={authOn ? 'key required by clients' : 'key (optional while auth is off)'}
                  value={keyDraft}
                  spellCheck={false}
                  disabled={!authOn && !keyDraft}
                  onChange={(e) => setKeyDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void saveAuth({ api_key: keyDraft })
                  }}
                />
                <button
                  className="btn sm"
                  disabled={!authOn}
                  onClick={() => void saveAuth({ api_key: keyDraft })}
                  title="store this key server-side"
                >
                  <IconKey size={12} /> Save key
                </button>
                <button
                  className="btn sm ghost"
                  disabled={!authOn}
                  title="replace the current key with a random one and use it immediately"
                  onClick={() => {
                    const next = Array.from(crypto.getRandomValues(new Uint8Array(16)))
                      .map((b) => b.toString(16).padStart(2, '0'))
                      .join('')
                    setKeyDraft(next)
                    void saveAuth({ api_key: next })
                  }}
                >
                  Generate
                </button>
                <button
                  className="btn sm ghost"
                  disabled={!keyDraft}
                  onClick={() => void copy('key', keyDraft)}
                >
                  <IconCopy size={12} /> {copied === 'key' ? 'Copied ✓' : 'Copy key'}
                </button>
              </div>
              <div className="field-hint">
                Clients send it once per call as{' '}
                <code className="inline">Authorization: Bearer &lt;key&gt;</code> (or{' '}
                <code className="inline">X-Api-Key</code>). Turning it on without a key
                auto-generates one. The key is stored plain in{' '}
                <code className="inline">data/settings.json</code> — no encryption, so keep
                this app on a trusted network.
              </div>
            </div>
          </div>
        </Panel>

        {/* ── default voice ──────────────────────────────────────── */}
        <Panel
          title="Default voice for API clients"
          extra={voice ? <span className="pill big"><span className="dot" />{voice.language}</span> : null}
        >
          {noVoices ? (
            <EmptyState icon={<IconWave size={22} />}>
              No voices downloaded yet — API speech calls need at least one.
              <div className="hint">
                <button className="btn sm" onClick={() => navigate('/voices')}>
                  Open voices &amp; setup
                </button>
              </div>
            </EmptyState>
          ) : (
            <div className="grid-2">
              <div>
                <div className="field-name">Voice</div>
                <select
                  value={voiceKey}
                  onChange={(e) => void saveDefaults({ default_voice: e.target.value })}
                >
                  <option value="">— none (API returns no_default_voice) —</option>
                  {installed!.voices.map((v) => (
                    <option key={v.key} value={v.key}>
                      {v.name} · {v.language} · {v.quality}
                    </option>
                  ))}
                </select>
                <div className="field-hint">
                  {voice
                    ? `${voice.sample_rate ?? '?'} Hz · ${voice.num_speakers > 1 ? `${voice.num_speakers} speakers` : 'single speaker'}`
                    : 'pick a downloaded voice for /v1/audio/speech'}
                </div>
                <div className="row" style={{ marginTop: 12, alignItems: 'flex-start' }}>
                  <button className="btn" disabled={!voiceKey || previewBusy} onClick={() => void previewVoice()}>
                    {previewBusy ? <Spinner size={13} /> : <IconWave size={13} />}
                    Preview with current settings
                  </button>
                </div>
                {previewError && <div className="field-hint" style={{ color: '#f09186' }}>{previewError}</div>}
                {previewUrl && (
                  <div key={ktur} style={{ marginTop: 10 }}>
                    <audio src={previewUrl} className="player" controls autoPlay preload="auto" />
                  </div>
                )}
              </div>
              <div>
                {voice && voice.num_speakers > 1 ? (
                  <>
                    <div className="field-name">Speaker</div>
                    <select
                      value={speakerId}
                      onChange={(e) => void saveDefaults({ speaker_id: Number(e.target.value) })}
                    >
                      {Array.from({ length: voice.num_speakers }, (_, i) => (
                        <option key={i} value={i}>Speaker {i}</option>
                      ))}
                    </select>
                    <div className="field-hint">
                      this model carries {voice.num_speakers} speakers; API calls use this one
                    </div>
                  </>
                ) : (
                  <>
                    <div className="field-name">Response formats</div>
                    <div className="row-wrap">
                      {formats.map((f) => {
                        const native = nativeFormats.includes(f)
                        const needsFfmpeg = !native && !cfg.ffmpeg_available
                        return (
                          <span key={f} className={`pill ${needsFfmpeg ? 'plain' : 'ok'}`}>
                            <span className={`dot ${needsFfmpeg ? 'off' : 'ok'}`} />
                            {f}
                            {native && <span className="meta">native</span>}
                          </span>
                        )
                      })}
                    </div>
                    <div className="field-hint">
                      <code className="inline">wav</code> is the default. Compressed formats need
                      ffmpeg on the server host ({cfg.ffmpeg_available ? 'found ✓' : 'not installed'}).
                    </div>
                  </>
                )}
              </div>
            </div>
          )}
        </Panel>

        {/* ── prosody ────────────────────────────────────────────── */}
        <Panel
          title="Voice parameters for API calls"
          extra={
            note && <span className="pill ok big"><span className="dot" />{note}</span>
          }
        >
          <div className="grid-2">
            <div>
              <ParamSlider
                label="Speed"
                min={0.25}
                max={4}
                step={0.05}
                value={speed}
                format={(v) => `${v.toFixed(2)}×`}
                onCommit={(v) => void saveDefaults({ speed: v })}
              />
              <ParamSlider
                label="Volume"
                min={0.05}
                max={2}
                step={0.05}
                value={volume}
                format={(v) => v.toFixed(2)}
                onCommit={(v) => void saveDefaults({ volume: v })}
              />
            </div>
            <div>
              <div className="param-row">
                <label className="switch">
                  <input type="checkbox" checked={advanced} onChange={(e) => setAdvanced(e.target.checked)} />
                  <span className="track" />
                  Show advanced prosody controls
                </label>
              </div>
              {advanced && (
                <div style={{ paddingTop: 2 }}>
                  <ParamSlider
                    label="Phoneme noise (noise_scale)"
                    min={0}
                    max={2}
                    step={0.05}
                    value={noiseScale}
                    format={(v) => v.toFixed(2)}
                    onCommit={(v) => void saveDefaults({ noise_scale: v })}
                  />
                  <ParamSlider
                    label="Cadence variation (noise_w_scale)"
                    min={0}
                    max={2}
                    step={0.05}
                    value={noiseWScale}
                    format={(v) => v.toFixed(2)}
                    onCommit={(v) => void saveDefaults({ noise_w_scale: v })}
                  />
                  <div className="param-row">
                    <label className="switch">
                      <input
                        type="checkbox"
                        checked={normalize}
                        onChange={(e) => {
                          setNormalize(e.target.checked)
                          void saveDefaults({ normalize: e.target.checked })
                        }}
                      />
                      <span className="track" />
                      Normalize output loudness
                    </label>
                  </div>
                </div>
              )}
            </div>
          </div>
          <hr className="hr" />
          <div className="row">
            <span className="dotline">
              <span className={`dot ${engineReady ? 'ok' : 'warn'}`} />
              engine {status ? (engineReady ? 'ready' : 'not installed') : '…'}
            </span>
            <span className="dotline">
              <span className={`dot ${voiceKey ? 'ok' : 'warn'}`} />
              voice {voiceKey ? voiceKey : 'not chosen'}
            </span>
            <span className="dotline">
              <span className="dot ok" />
              no rate limits by design
            </span>
          </div>
          <div className="field-hint" style={{ marginTop: 10 }}>
            Everything here is applied server-side to every API call — clients never send
            voice or prosody settings. Sliders save automatically on release.
          </div>
        </Panel>
      </div>
    </div>
  )
}

function ParamSlider({
  label,
  min,
  max,
  step,
  value,
  format,
  onCommit,
}: {
  label: string
  min: number
  max: number
  step: number
  value: number
  format: (v: number) => string
  onCommit: (v: number) => void
}) {
  // commit only when the user lets go; live drafting keeps the UI snappy
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  return (
    <div className="param-row">
      <div className="param-head">
        <label className="field-name" style={{ marginBottom: 0 }}>{label}</label>
        <span className="param-val">{format(draft)}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={draft}
        onChange={(e) => setDraft(Number(e.target.value))}
        onMouseUp={() => onCommit(draft)}
        onTouchEnd={() => onCommit(draft)}
        onKeyUp={() => onCommit(draft)}
      />
    </div>
  )
}
