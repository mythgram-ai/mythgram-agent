import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ApiError,
  api,
  type CatalogVoice,
  type DeviceSetting,
  type DownloadState,
  type InstalledVoice,
} from '../lib/api'
import { fmtBytes, fmtDuration, fmtPercent } from '../lib/format'
import { useOnce, usePoll } from '../lib/hooks'
import {
  IconAlert,
  IconDownload,
  IconRefresh,
  IconTrash,
  IconX,
} from '../components/icons'
import { EmptyState, Panel, Spinner, Stat } from '../components/ui'

const QUALITY_ORDER = ['x_low', 'low', 'medium', 'high']

export default function VoicesPage() {
  // ── piper runtime ────────────────────────────────────────────────
  const { data: status, refresh: refreshStatus } = usePoll(() => api.piperStatus(), 8000)
  const [installBusy, setInstallBusy] = useState(false)
  const [installNote, setInstallNote] = useState<string | null>(null)
  const [gpuExtra, setGpuExtra] = useState(false)
  const [rowError, setRowError] = useState<string | null>(null)

  // ── settings ─────────────────────────────────────────────────────
  const { data: saved } = useOnce(() => api.settings())
  const [voicesDirDraft, setVoicesDirDraft] = useState('')
  const [deviceDraft, setDeviceDraft] = useState<DeviceSetting>('auto')
  const [settingsNote, setSettingsNote] = useState<string | null>(null)

  useEffect(() => {
    if (saved) {
      setVoicesDirDraft(saved.voices_dir)
      setDeviceDraft(saved.device)
    }
  }, [saved])

  // ── catalog + installed registry ─────────────────────────────────
  const { data: catalog, refresh: refreshCatalog } = useOnce(() => api.catalog())
  const { data: installed, refresh: refreshInstalled } = useOnce(() => api.installed())
  const [refreshingCatalog, setRefreshingCatalog] = useState(false)

  const hardRefreshCatalog = async () => {
    setRefreshingCatalog(true)
    try {
      await api.catalog(true)
      refreshCatalog()
    } catch (err) {
      setRowError((err as ApiError).message)
    } finally {
      setRefreshingCatalog(false)
    }
  }

  // ── filters ──────────────────────────────────────────────────────
  const [search, setSearch] = useState('')
  const [langFilter, setLangFilter] = useState('all')
  const [qualityFilter, setQualityFilter] = useState('all')
  const [onlyInstalled, setOnlyInstalled] = useState(false)

  // ── download tracking ────────────────────────────────────────────
  const { data: dlSnapshot, refresh: refreshDownloads } = usePoll(() => api.downloads(), 1200)
  const prevStates = useRef<Record<string, string>>({})

  useEffect(() => {
    if (!dlSnapshot) return
    const prev = prevStates.current
    const next: Record<string, string> = {}
    let settled = false
    for (const [key, state] of Object.entries(dlSnapshot.downloads)) {
      next[key] = state.state
      if (prev[key] && prev[key] !== state.state && ['done', 'failed', 'cancelled'].includes(state.state)) {
        settled = true
      }
    }
    prevStates.current = next
    if (settled) {
      refreshInstalled()
      refreshCatalog()
      refreshStatus()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dlSnapshot])

  // ── hardware monitor ─────────────────────────────────────────────
  const { data: sys } = usePoll(() => api.system(), 3000)

  // ── actions ──────────────────────────────────────────────────────
  const installPiper = async () => {
    if (status?.installed && !window.confirm('Piper TTS is already installed. Reinstall/refresh it?')) return
    setInstallBusy(true)
    setInstallNote(null)
    try {
      const res = await api.piperInstall(gpuExtra ? ['onnxruntime-gpu'] : [])
      setInstallNote(`installed piper-tts${res.version ? ` ${res.version}` : ''} — ready for synthesis`)
      refreshStatus()
    } catch (err) {
      setInstallNote(`install failed — details on the Logs page (${(err as ApiError).message})`)
    } finally {
      setInstallBusy(false)
    }
  }

  const saveDevice = async (next: DeviceSetting) => {
    setDeviceDraft(next)
    try {
      await api.saveSettings({ device: next })
      setSettingsNote(`compute device: ${next} (saved)`)
      refreshStatus()
      window.setTimeout(() => setSettingsNote(null), 2500)
    } catch (err) {
      setSettingsNote((err as ApiError).message)
    }
  }

  const saveVoicesDir = async () => {
    const next = voicesDirDraft.trim()
    if (!next || next === saved?.voices_dir) return
    try {
      const res = await api.saveSettings({ voices_dir: next })
      setVoicesDirDraft(res.voices_dir)
      setSettingsNote('voices directory saved')
      void refreshInstalled()
      void refreshCatalog()
      window.setTimeout(() => setSettingsNote(null), 2500)
    } catch (err) {
      setSettingsNote((err as ApiError).message)
    }
  }

  const downloadVoice = async (key: string) => {
    setRowError(null)
    try {
      await api.installVoice(key)
      refreshDownloads()
    } catch (err) {
      setRowError((err as ApiError).message)
    }
  }

  const cancelVoice = async (key: string) => {
    try {
      await api.cancelVoice(key)
      refreshDownloads()
    } catch (err) {
      setRowError((err as ApiError).message)
    }
  }

  const deleteVoice = async (key: string) => {
    if (!window.confirm(`Delete the local files for ${key}?`)) return
    setRowError(null)
    try {
      await api.deleteVoice(key)
      refreshInstalled()
      refreshCatalog()
    } catch (err) {
      setRowError((err as ApiError).message)
    }
  }

  // ── view data ────────────────────────────────────────────────────
  const languages = useMemo(
    () => Array.from(new Set((catalog?.voices ?? []).map((v) => v.language))).sort(),
    [catalog],
  )

  const rows = useMemo(() => {
    let list = catalog?.voices ?? []
    if (search.trim()) {
      const needle = search.trim().toLowerCase()
      list = list.filter((v) =>
        `${v.key} ${v.name} ${v.language} ${v.language_english} ${v.language_native}`
          .toLowerCase()
          .includes(needle),
      )
    }
    if (langFilter !== 'all') list = list.filter((v) => v.language === langFilter)
    if (qualityFilter !== 'all') list = list.filter((v) => v.quality === qualityFilter)
    if (onlyInstalled) list = list.filter((v) => v.installed)
    return [...list].sort(
      (a, b) =>
        QUALITY_ORDER.indexOf(a.quality) - QUALITY_ORDER.indexOf(b.quality) ||
        a.language.localeCompare(b.language) ||
        a.key.localeCompare(b.key),
    )
  }, [catalog, search, langFilter, qualityFilter, onlyInstalled])

  const activeDownloads = dlSnapshot?.downloads ?? {}

  return (
    <div className="content-inner">
      <div className="page-head">
        <h1>Voices &amp; setup</h1>
        <p>
          Keep the synthesis engine healthy, pick where voices live and how they run,
          and download models from the public piper voice repository.
        </p>
      </div>

      {rowError && (
        <div className="banner error">
          <span className="ico"><IconAlert size={15} /></span>
          <span>{rowError}</span>
        </div>
      )}

      <div className="stack gap-16">
        {/* ── engine ─────────────────────────────────────────────── */}
        <Panel
          title="Piper runtime"
          extra={
            status && (
              <span className={`pill big ${status.installed ? 'ok' : 'warn'}`}>
                <span className="dot" />
                {status.installed ? `installed · v${status.version ?? '?'}` : 'not installed'}
              </span>
            )
          }
        >
          {status && !status.installed && (
            <div className="banner" style={{ marginBottom: 14 }}>
              <span className="ico"><IconAlert size={15} /></span>
              <span>
                The synthesis engine is not installed. “Install piper-tts” runs pip inside the
                backend environment — internet is needed once.
              </span>
            </div>
          )}
          <div className="grid-2">
            <div>
              <div className="field-name">Engine management</div>
              <div className="row" style={{ flexWrap: 'wrap' }}>
                <button className="btn primary" disabled={installBusy} onClick={() => void installPiper()}>
                  {installBusy ? <Spinner size={13} /> : <IconDownload size={13} />}
                  {status?.installed ? 'Reinstall piper-tts' : 'Install piper-tts'}
                </button>
                <label className="switch" title="adds onnxruntime-gpu — only for NVIDIA machines">
                  <input type="checkbox" checked={gpuExtra} onChange={(e) => setGpuExtra(e.target.checked)} />
                  <span className="track" />
                  include onnxruntime-gpu
                </label>
              </div>
              {installNote && <div className="field-hint mono">{installNote}</div>}
              <div className="field-hint">
                wheel <code className="inline">piper-tts</code> · providers{' '}
                <code className="inline">{status?.ort.providers.join(', ') || 'none detected yet'}</code>
              </div>
            </div>
            <div>
              <div className="field-name">Compute device</div>
              <select
                value={status?.device.setting ?? deviceDraft}
                onChange={(e) => void saveDevice(e.target.value as DeviceSetting)}
              >
                {['auto', 'cpu', 'cuda'].map((d) => (
                  <option key={d} value={d}>
                    {d}{d === 'auto' ? ' (recommended)' : ''}
                  </option>
                ))}
              </select>
              <div className="field-hint">
                auto resolves to <span className="mono">{status?.device.resolved ?? 'cpu'}</span>;
                loaded voices stay cached so switching back is instant
              </div>
            </div>
          </div>
          <hr className="hr" />
          <div className="field-name">Voices directory</div>
          <div className="row">
            <input
              type="text"
              value={voicesDirDraft}
              spellCheck={false}
              onChange={(e) => setVoicesDirDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void saveVoicesDir()
              }}
            />
            <button className="btn sm" onClick={() => void saveVoicesDir()} disabled={!voicesDirDraft.trim()}>
              Save path
            </button>
          </div>
          <div className="field-hint">
            models download here; the disk monitor above follows this path
            {settingsNote && <span style={{ color: 'var(--accent-strong)' }}> · {settingsNote}</span>}
          </div>
        </Panel>

        {/* ── machine ────────────────────────────────────────────── */}
        <Panel
          title="This machine — live"
          extra={
            sys && (
              <span className="mono mute small">
                {sys.platform.system} {sys.platform.machine} · python {sys.platform.python} · up {fmtDuration(sys.uptime_seconds)}
              </span>
            )
          }
        >
          {sys ? (
            <>
              <div className="stats" style={{ borderTop: 0 }}>
                <Stat
                  name="CPU"
                  value={fmtPercent(sys.cpu.percent_total)}
                  bar={sys.cpu.percent_total}
                  sub={`${sys.cpu.cores_physical}c/${sys.cpu.cores_logical}t${sys.cpu.freq_mhz ? ` · ${(sys.cpu.freq_mhz / 1000).toFixed(2)} GHz` : ''} · ${sys.cpu.model.slice(0, 40)}`}
                />
                <Stat
                  name="Memory"
                  value={fmtPercent(sys.memory.percent)}
                  bar={sys.memory.percent}
                  sub={`${fmtBytes(sys.memory.used_bytes)} / ${fmtBytes(sys.memory.total_bytes)} used`}
                />
                <Stat
                  name="Disk (voices)"
                  value={`${fmtBytes(sys.disk.free_bytes)} free`}
                  bar={sys.disk.percent}
                  sub={`${fmtBytes(sys.disk.used_bytes)} of ${fmtBytes(sys.disk.total_bytes)} used · ${sys.disk.path.length > 38 ? '…' + sys.disk.path.slice(-37) : sys.disk.path}`}
                />
                <Stat
                  name="Load average"
                  value={sys.cpu.load_avg_relative.map((x) => x.toFixed(2)).join(' / ')}
                  bar={Math.min(100, Math.max(...sys.cpu.load_avg_relative, 0) * 100)}
                  sub="relative to logical cores"
                />
              </div>
              <div className="row-wrap" style={{ marginTop: 12, flexWrap: 'wrap' }}>
                <span className="dotline">
                  <span className={`dot ${status?.ort.installed ? 'ok' : 'off'}`} />
                  onnxruntime {status?.ort.installed ? `present (${status.ort.providers.length})` : 'absent'}
                </span>
                <span className="dotline">
                  <span className={`dot ${status?.ort.cuda_ok ? 'ok' : 'off'}`} />
                  CUDA {status?.ort.cuda_ok ? 'available' : 'unavailable'}
                </span>
                <span className="dotline">
                  <span className={`dot ${catalog?.fresh === false ? 'warn' : 'ok'}`} />
                  voice repository {catalog?.fresh === false ? 'using cached copy' : 'reachable'}
                </span>
              </div>
            </>
          ) : (
            <div className="empty-state"><Spinner size={16} /></div>
          )}
        </Panel>

        {/* ── catalog ────────────────────────────────────────────── */}
        <Panel
          title={`Voice repository${catalog && !catalogErrorFree(catalog) ? ` · ${catalog.voices.length} available` : ''}`}
          extra={
            <button className="btn sm ghost" onClick={() => void hardRefreshCatalog()} disabled={refreshingCatalog}>
              {refreshingCatalog ? <Spinner size={12} /> : <IconRefresh size={12} />}
              Refresh from repository
            </button>
          }
        >
          {catalog && catalog.error && (
            <div className="banner error" style={{ marginBottom: 12 }}>
              <span className="ico"><IconAlert size={15} /></span>
              <span>{catalog.error}</span>
            </div>
          )}
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
            <input
              type="search"
              placeholder="Search name, language…"
              value={search}
              style={{ flex: 1, minWidth: 200 }}
              onChange={(e) => setSearch(e.target.value)}
            />
            <select value={langFilter} onChange={(e) => setLangFilter(e.target.value)} style={{ width: 'auto' }}>
              <option value="all">all languages</option>
              {languages.map((lang) => {
                const sample = catalog?.voices.find((v) => v.language === lang)
                return (
                  <option key={lang} value={lang}>
                    {lang}{sample?.language_english ? ` — ${sample.language_english}` : ''}
                  </option>
                )
              })}
            </select>
            <select value={qualityFilter} onChange={(e) => setQualityFilter(e.target.value)} style={{ width: 'auto' }}>
              <option value="all">all qualities</option>
              {QUALITY_ORDER.map((q) => (
                <option key={q} value={q}>{q}</option>
              ))}
            </select>
            <label className="switch">
              <input type="checkbox" checked={onlyInstalled} onChange={(e) => setOnlyInstalled(e.target.checked)} />
              <span className="track" />
              downloaded only
            </label>
          </div>
          {catalog ? (
            rows.length === 0 ? (
              <EmptyState icon={<IconDownload size={22} />}>
                No voices match this filter.
                <div className="hint">try a shorter search, or clear the quality/language filters</div>
              </EmptyState>
            ) : (
              <div style={{ margin: '-16px -16px -16px', maxHeight: 560, overflowY: 'auto' }}>
                {rows.map((voice) => (
                  <CatalogRow
                    key={voice.key}
                    voice={voice}
                    installedVoice={installed?.voices.find((v) => v.key === voice.key) ?? null}
                    download={activeDownloads[voice.key] ?? null}
                    onDownload={() => void downloadVoice(voice.key)}
                    onCancel={() => void cancelVoice(voice.key)}
                    onDelete={() => void deleteVoice(voice.key)}
                  />
                ))}
              </div>
            )
          ) : (
            <div className="empty-state">
              <Spinner size={16} />
              <div className="hint" style={{ marginTop: 8 }}>fetching the public voice catalog…</div>
            </div>
          )}
        </Panel>
      </div>
    </div>
  )
}

/** tiny guard so we only show the count when the catalog object is sane */
function catalogErrorFree(catalog: { voices: unknown[]; error: string | null }): boolean {
  return catalog.error === null && Array.isArray(catalog.voices)
}

function CatalogRow({
  voice,
  installedVoice,
  download,
  onDownload,
  onCancel,
  onDelete,
}: {
  voice: CatalogVoice
  installedVoice: InstalledVoice | null
  download: DownloadState | null
  onDownload: () => void
  onCancel: () => void
  onDelete: () => void
}) {
  const active = Boolean(download && (download.state === 'queued' || download.state === 'downloading'))
  const downloaded = Boolean(voice.installed || installedVoice || download?.state === 'done')

  return (
    <div className="voice-row">
      <span className="lang-flag">{voice.language}</span>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <span className="voice-name">{voice.name}</span>
          <span className="tag">{voice.quality}</span>
          {voice.num_speakers > 1 && <span className="tag">{voice.num_speakers} speakers</span>}
          {voice.language_native && <span className="dim small mono">{voice.language_native}</span>}
        </div>
        <div className="voice-meta">
          {voice.language_english}
          {voice.country_english ? ` · ${voice.country_english}` : ''} · {fmtBytes(voice.size_bytes)} ·{' '}
          <span className="mono">{voice.key}</span>
        </div>
        {download && active && (
          <div style={{ marginTop: 6 }}>
            <div className="meter" style={{ maxWidth: 340 }}>
              <i style={{ width: `${Math.round((download.progress ?? 0) * 100)}%` }} />
            </div>
            <div className="voice-meta mono" style={{ marginTop: 3 }}>
              {fmtBytes(download.received_bytes)} / {fmtBytes(download.total_bytes)}
              {download.state === 'queued' && ' · queued…'}
            </div>
          </div>
        )}
        {download?.state === 'failed' && (
          <div className="voice-meta" style={{ color: '#f09186' }}>{download.error}</div>
        )}
      </div>
      <div className="row" style={{ flex: 'none' }}>
        {downloaded && !active && <span className="pill ok"><span className="dot" />ready</span>}
        {active && (
          <button className="btn sm ghost" onClick={onCancel} title="cancel this download">
            <IconX size={12} /> Cancel
          </button>
        )}
        {!downloaded && !active && (
          <button className="btn sm" onClick={onDownload}>
            <IconDownload size={12} /> Download
          </button>
        )}
        {downloaded && !active && (
          <button className="icon-btn danger" title="delete local files" onClick={onDelete}>
            <IconTrash size={13} />
          </button>
        )}
      </div>
    </div>
  )
}
