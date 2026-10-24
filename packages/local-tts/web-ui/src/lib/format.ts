/** Formatting helpers shared across pages. */

export function fmtBytes(bytes: number): string {
  if (!bytes || bytes < 0) return '0 B'
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  const precision = value < 10 && unit > 1 ? 1 : 0
  return `${value.toFixed(precision)} ${units[unit]}`
}

export function fmtPercent(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—'
  return `${value.toFixed(0)}%`
}

export function fmtPctBar(value: number | null | undefined): number {
  if (value === null || value === undefined || Number.isNaN(value)) return 0
  return Math.min(100, Math.max(0, value))
}

export function fmtDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '—'
  const total = Math.floor(seconds)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

export function fmtClock(ts: number): string {
  const d = new Date(ts * 1000)
  const pad = (n: number, width = 2) => String(n).padStart(width, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`
}

export function fmtSpeechSeconds(ms: number): string {
  if (!ms && ms !== 0) return '—'
  return `${(ms / 1000).toFixed(1)}s`
}

/** Turn a piper voice key (en_US-amy-medium) into display fields. */
export function parseVoiceKey(key: string): { name: string; language: string; quality: string } {
  const parts = key.split('-')
  const quality = parts.length >= 2 ? parts[parts.length - 1] : ''
  const language = parts.length >= 2 ? parts[0] : ''
  const name = parts.length >= 2 ? key.slice(language.length + 1, key.length - (quality.length + 1)) : key
  return { name, language, quality }
}

/** Copy text to the clipboard with a fallback for non-secure HTTP contexts. */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    try {
      const area = document.createElement('textarea')
      area.value = text
      area.style.position = 'fixed'
      area.style.opacity = '0'
      document.body.appendChild(area)
      area.select()
      const ok = document.execCommand('copy')
      document.body.removeChild(area)
      return ok
    } catch {
      return false
    }
  }
}
