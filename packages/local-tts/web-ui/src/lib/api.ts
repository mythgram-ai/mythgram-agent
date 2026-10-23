/** Typed client for the Python backend. All calls go through the /api proxy. */

export class ApiError extends Error {
  status: number
  code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

const BASE = '/api'

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${BASE}${path}`, init)
  } catch (err) {
    throw new ApiError(0, 'network', `cannot reach the backend (${(err as Error).message})`)
  }
  if (res.status === 204) return undefined as T
  const text = await res.text()
  let body: unknown = undefined
  if (text) {
    try {
      body = JSON.parse(text)
    } catch {
      body = { detail: { code: 'bad_response', message: text.slice(0, 400) } }
    }
  }
  if (!res.ok) {
    const detail = (body as { detail?: { code?: string; message?: string } | string })?.detail
    if (typeof detail === 'string')
      throw new ApiError(res.status, 'error', detail)
    throw new ApiError(res.status, detail?.code ?? 'error', detail?.message ?? res.statusText)
  }
  return body as T
}

const json = (method: string, payload?: unknown): RequestInit | undefined =>
  payload === undefined
    ? { method }
    : { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }

// ── types ────────────────────────────────────────────────────────────

export type DeviceSetting = 'auto' | 'cpu' | 'cuda'

export interface OrtSummary {
  installed: boolean
  providers: string[]
  cuda_ok: boolean
}

export interface PiperStatus {
  installed: boolean
  version: string | null
  ort: OrtSummary
  device: { setting: DeviceSetting; resolved: string; choices: string[] }
}

export interface CatalogVoice {
  key: string
  name: string
  language: string
  language_english: string
  country_english: string
  language_native: string
  quality: string
  num_speakers: number
  size_bytes: number
  installed: boolean
}

export interface CatalogResponse {
  voices: CatalogVoice[]
  error: string | null
  fresh: boolean
}

export interface InstalledVoice {
  key: string
  file: string
  size_bytes: number
  mtime: number
  name: string
  language: string
  language_english: string
  country_english: string
  quality: string
  num_speakers: number
  speaker_id_map: Record<string, number>
  sample_rate: number | null
}

export interface DownloadState {
  key: string
  state: 'queued' | 'downloading' | 'done' | 'failed' | 'cancelled'
  received_bytes: number
  total_bytes: number
  progress: number | null
  error: string | null
  started_at: number | null
  finished_at: number | null
}

export interface Settings {
  voices_dir: string
  device: DeviceSetting
}

export interface SystemSnapshot {
  platform: {
    system: string
    release: string
    machine: string
    python: string
    python_home: string
  }
  cpu: {
    model: string
    cores_physical: number
    cores_logical: number
    percent_total: number
    percent_per_core: number[]
    load_avg_relative: number[]
    freq_mhz: number | null
  }
  memory: {
    total_bytes: number
    used_bytes: number
    available_bytes: number
    percent: number
    swap_total_bytes: number
    swap_used_bytes: number
    swap_percent: number
  }
  disk: {
    path: string
    total_bytes: number
    used_bytes: number
    free_bytes: number
    percent: number
  }
  uptime_seconds: number
}

export interface LogEntry {
  id: number
  ts: number
  level: 'debug' | 'info' | 'warning' | 'error'
  source: string
  message: string
}

export interface TtsMeta {
  voiceKey: string
  sampleRate: number
  channels: number
  durationMs: number
  elapsedMs: number
  device: string
  sizeBytes: number
  text: string
  blobUrl: string
}

export interface SynthesisParams {
  key: string
  text: string
  speed: number
  volume: number
  noise_scale?: number
  noise_w_scale?: number
  normalize?: boolean
  speaker_id?: number
}

// ── endpoints ────────────────────────────────────────────────────────

export const api = {
  health: () => request<{ ok: boolean; app: string; python: string }>('/health'),

  piperStatus: () => request<PiperStatus>('/piper/status'),

  piperInstall: (extras: string[]) =>
    request<{ ok: boolean; version: string | null; status: PiperStatus }>('/piper/install', json('POST', { extras })),

  settings: () => request<Settings>('/settings'),

  saveSettings: (patch: Partial<Settings>) => request<Settings>('/settings', json('POST', patch)),

  catalog: (force = false) => request<CatalogResponse>(`/voices/catalog${force ? '?force=1' : ''}`),

  installed: () => request<{ voices: InstalledVoice[]; voices_dir: string }>('/voices/installed'),

  downloads: () => request<{ downloads: Record<string, DownloadState> }>('/voices/downloads'),

  installVoice: (key: string) => request<{ queued: boolean; key: string }>('/voices/install', json('POST', { key })),

  cancelVoice: (key: string) => request<{ cancelled: boolean; key: string }>('/voices/cancel', json('POST', { key })),

  deleteVoice: (key: string) => request<{ deleted: boolean; key: string }>(`/voices/${encodeURIComponent(key)}`, { method: 'DELETE' }),

  logs: (limit = 1000) => request<{ entries: LogEntry[]; latest_id: number }>(`/logs?limit=${limit}`),

  clearLogs: () => request<{ cleared: boolean }>('/logs/clear', { method: 'POST' }),

  testLogs: () => request<{ written: string[] }>('/logs/test', { method: 'POST' }),

  system: () => request<SystemSnapshot>('/system'),

  /** Run synthesis and read result metadata from the response headers. */
  synthesize: async (params: SynthesisParams, signal?: AbortSignal): Promise<TtsMeta> => {
    const res = await fetch(`${BASE}/tts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
      signal,
    })
    if (!res.ok) {
      let code = 'error'
      let message = res.statusText
      try {
        const body = await res.json()
        const detail = body?.detail
        if (typeof detail === 'string') message = detail
        else if (detail?.code) {
          code = detail.code
          message = detail.message
        }
      } catch {
        /* keep defaults */
      }
      throw new ApiError(res.status, code, message)
    }
    const blob = await res.blob()
    return {
      voiceKey: res.headers.get('x-voice-key') ?? params.key,
      sampleRate: Number(res.headers.get('x-sample-rate') ?? 0),
      channels: 1,
      durationMs: Number(res.headers.get('x-duration-ms') ?? 0),
      elapsedMs: Number(res.headers.get('x-elapsed-ms') ?? 0),
      device: res.headers.get('x-device') ?? 'cpu',
      sizeBytes: blob.size,
      text: params.text,
      blobUrl: URL.createObjectURL(blob),
    }
  },
}
