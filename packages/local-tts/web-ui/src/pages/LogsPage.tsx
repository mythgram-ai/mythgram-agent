import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, type LogEntry } from '../lib/api'
import { fmtClock } from '../lib/format'
import { IconRefresh, IconSpinner } from '../components/icons'
import { Panel } from '../components/ui'

const MAX_KEEP = 2000
const LEVEL_RANK: Record<LogEntry['level'], number> = { debug: 0, info: 1, warning: 2, error: 3 }

type LevelFilter = 'all' | 'info' | 'warning' | 'error'

export default function LogsPage() {
  const [entries, setEntries] = useState<LogEntry[]>([])
  const [level, setLevel] = useState<LevelFilter>('all')
  const [needle, setNeedle] = useState('')
  const [autoScroll, setAutoScroll] = useState(true)
  const [connected, setConnected] = useState(false)
  const [loading, setLoading] = useState(true)

  const listRef = useRef<HTMLDivElement | null>(null)
  const lastIdRef = useRef(0)

  // initial history, then live stream
  useEffect(() => {
    let alive = true
    const boot = async () => {
      try {
        const res = await api.logs(2000)
        if (!alive) return
        setEntries(res.entries)
        lastIdRef.current = res.entries.length ? res.entries[res.entries.length - 1].id : 0
      } catch {
        /* SSE below will still deliver new entries once connected */
      } finally {
        setLoading(false)
      }
    }
    void boot()

    const source = new EventSource('/api/logs/stream')
    source.onopen = () => setConnected(true)
    source.onerror = () => setConnected(false)
    source.onmessage = (ev) => {
      let entry: (LogEntry & { __ping__?: boolean; __snapshot__?: boolean }) | null = null
      try {
        entry = JSON.parse(ev.data)
      } catch {
        return
      }
      if (!entry || entry.__ping__ || entry.__snapshot__) return
      setConnected(true)
      setEntries((current) => {
        // log history was cleared server-side: ids rewound, start over
        if (entry.id < lastIdRef.current && lastIdRef.current - entry.id > 200) {
          lastIdRef.current = entry.id
          return [entry]
        }
        if (entry.id <= lastIdRef.current) return current
        lastIdRef.current = entry.id
        const next = [...current, entry]
        return next.length > MAX_KEEP ? next.slice(next.length - MAX_KEEP) : next
      })
    }
    return () => {
      alive = false
      source.close()
    }
  }, [])

  // keep pinned to bottom while streaming (unless the user scrolled up)
  useEffect(() => {
    if (autoScroll && listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight
    }
  }, [entries, autoScroll])

  const onScroll = useCallback(() => {
    const el = listRef.current
    if (!el) return
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60
    setAutoScroll(nearBottom)
  }, [])

  const filtered = useMemo(() => {
    const rank = level === 'all' ? 0 : LEVEL_RANK[level]
    let list = entries.filter((e) => LEVEL_RANK[e.level] >= rank)
    if (needle.trim()) {
      const q = needle.trim().toLowerCase()
      list = list.filter(
        (e) => e.message.toLowerCase().includes(q) || e.source.toLowerCase().includes(q),
      )
    }
    return list
  }, [entries, level, needle])

  const levelCounts = useMemo(() => {
    const counts = { debug: 0, info: 0, warning: 0, error: 0 }
    for (const e of entries) counts[e.level] += 1
    return counts
  }, [entries])

  const jumpToLatest = () => {
    setAutoScroll(true)
    window.requestAnimationFrame(() => {
      if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight
    })
  }

  const clear = async () => {
    if (!window.confirm('Wipe the in-memory log history?')) return
    await api.clearLogs().catch(() => undefined)
    setEntries([])
    lastIdRef.current = 0
  }

  const writeSamples = async () => {
    await api.testLogs().catch(() => undefined)
  }

  return (
    <div className="content-inner" style={{ maxWidth: 1280 }}>
      <div className="page-head">
        <h1>Logs</h1>
        <p>
          Everything the backend records: installs, downloads, synthesis runs and errors.
          The stream is live — new lines appear as they happen.
        </p>
      </div>

      <Panel
        title="Backend stream"
        extra={
          <span className={`log-live-dot ${connected ? 'on' : ''}`}>
            <span className="dot" />
            {connected ? 'live' : 'reconnecting…'}
          </span>
        }
        tight
      >
        <div
          className="spread"
          style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)', flexWrap: 'wrap' }}
        >
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <select
              value={level}
              onChange={(e) => setLevel(e.target.value as LevelFilter)}
              style={{ width: 'auto' }}
              aria-label="minimum level"
            >
              <option value="all">all levels{levelCounts.debug > 0 ? ` (${entries.length})` : ''}</option>
              <option value="info">info and up ({levelCounts.info + levelCounts.warning + levelCounts.error})</option>
              <option value="warning">warning and up ({levelCounts.warning + levelCounts.error})</option>
              <option value="error">errors ({levelCounts.error})</option>
            </select>
            <input
              type="search"
              placeholder="Filter messages or sources…"
              value={needle}
              onChange={(e) => setNeedle(e.target.value)}
              style={{ width: 260 }}
            />
            <label className="switch" title="follow new lines automatically">
              <input type="checkbox" checked={autoScroll} onChange={(e) => setAutoScroll(e.target.checked)} />
              <span className="track" />
              auto-scroll
            </label>
            {!autoScroll && (
              <button className="btn sm ghost" onClick={jumpToLatest}>
                <IconRefresh size={12} /> Jump to latest
              </button>
            )}
          </div>
          <div className="row">
            <button className="btn sm ghost" onClick={() => void writeSamples()} title="write one entry of every level">
              Sample entries
            </button>
            <button className="btn sm danger" onClick={() => void clear()}>Clear</button>
          </div>
        </div>

        <div ref={listRef} className="log-list" onScroll={onScroll}>
          {loading ? (
            <div className="empty-state">
              <IconSpinner size={16} className="spin" />
              <div className="hint" style={{ marginTop: 8 }}>loading history…</div>
            </div>
          ) : filtered.length === 0 ? (
            <div className="empty-state">
              Nothing to show{entries.length > 0 ? ' for this filter' : ' yet'}.
              <div className="hint">operations like installs, downloads and synthesis will appear here</div>
            </div>
          ) : (
            filtered.map((entry) => <LogRow key={entry.id} entry={entry} />)
          )}
        </div>
        <div
          className="spread mono"
          style={{ padding: '8px 16px', borderTop: '1px solid var(--border)', fontSize: 11, color: 'var(--text-mute)' }}
        >
          <span>
            showing {filtered.length.toLocaleString()} of {entries.length.toLocaleString()} entries
          </span>
          <span>buffer keeps the most recent 2000</span>
        </div>
      </Panel>
    </div>
  )
}

function LogRow({ entry }: { entry: LogEntry }) {
  return (
    <div className={`log-row ${entry.level}`}>
      <span className="lvl">{entry.level.toUpperCase().slice(0, 5)}</span>
      <span className="log-time">{fmtClock(entry.ts)}</span>
      <span className="log-src" title={entry.source}>{entry.source}</span>
      <span className="log-msg">{entry.message}</span>
    </div>
  )
}
