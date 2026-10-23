import type { ReactNode } from 'react'
import { fmtPctBar } from '../lib/format'

export function Panel({
  title,
  extra,
  children,
  tight,
}: {
  title?: string
  extra?: ReactNode
  children: ReactNode
  tight?: boolean
}) {
  return (
    <section className="panel">
      {title !== undefined && (
        <header className="panel-head">
          <span className="panel-title">{title}</span>
          {extra && (
            <span style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
              {extra}
            </span>
          )}
        </header>
      )}
      <div className={`panel-body${tight ? ' tight' : ''}`}>{children}</div>
    </section>
  )
}

export function MeterBar({
  value,
  className,
}: {
  value: number | null | undefined
  className?: string
}) {
  const pct = fmtPctBar(value)
  const color = pct > 92 ? 'var(--danger)' : pct > 75 ? 'var(--warn)' : 'var(--accent)'
  return (
    <div className={`meter ${className ?? ''}`}>
      <i style={{ width: `${pct}%`, background: color }} />
    </div>
  )
}

export function Stat({
  name,
  value,
  bar,
  sub,
}: {
  name: string
  value?: string
  bar?: number | null
  sub?: string
}) {
  return (
    <div className="stat">
      <div className="stat-top">
        <span className="stat-name">{name}</span>
        {value !== undefined && <span className="stat-value">{value}</span>}
      </div>
      {bar !== undefined && <MeterBar value={bar} />}
      {sub !== undefined && <div className="stat-sub" title={sub}>{sub}</div>}
    </div>
  )
}

export function EmptyState({
  icon,
  children,
}: {
  icon: ReactNode
  children: ReactNode
}) {
  return (
    <div className="empty-state">
      <div className="ico">{icon}</div>
      {children}
    </div>
  )
}

export function Spinner({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className="spin" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2.5" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  )
}
