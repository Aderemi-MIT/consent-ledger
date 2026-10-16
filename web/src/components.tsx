import type { ReactNode } from 'react'
import { AlertCircle, Building2, CheckCircle2, Info, Landmark, Link2, Microscope, Pill as PillIcon, Umbrella } from 'lucide-react'
import { short, type LedgerTx } from './api'

export type Tone = 'blue' | 'green' | 'red' | 'amber' | 'violet' | 'sky' | 'grey'

const AVATAR_TONES: Tone[] = ['blue', 'violet', 'sky', 'green', 'amber']

function initials(name: string): string {
  const words = name.replace(/\(.*?\)/g, '').trim().split(/\s+/)
  return (words[0]?.[0] ?? '') + (words.length > 1 ? words[words.length - 1][0] : '')
}

/** Initials avatar, coloured consistently for the same ID. */
export function Avatar({ name, id, size = 36 }: { name: string; id: string; size?: number }) {
  const tone = AVATAR_TONES[[...id].reduce((a, c) => a + c.charCodeAt(0), 0) % AVATAR_TONES.length]
  return (
    <span className={`avatar tone-${tone}`} style={{ width: size, height: size, fontSize: size * 0.38 }} aria-hidden="true">
      {initials(name).toUpperCase()}
    </span>
  )
}

/** Icon for a provider organisation type. */
export function ProviderIcon({ type, size = 18 }: { type: string; size?: number }) {
  const Icon =
    { hospital: Building2, laboratory: Microscope, pharmacy: PillIcon, insurer: Umbrella, regulator: Landmark }[type] ??
    Building2
  return <Icon size={size} aria-hidden="true" />
}

export function Pill({ tone, children }: { tone: Tone; children: ReactNode }) {
  return <span className={`pill tone-${tone}`}>{children}</span>
}

export function IconTile({ tone, children, size = 40 }: { tone: Tone; children: ReactNode; size?: number }) {
  return (
    <span className={`icon-tile tone-${tone}`} style={{ width: size, height: size }} aria-hidden="true">
      {children}
    </span>
  )
}

export function Card({
  title,
  icon,
  sub,
  actions,
  children,
  className = '',
}: {
  title?: string
  icon?: ReactNode
  sub?: string
  actions?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={`card ${className}`}>
      {title && (
        <div className="card-head">
          <div>
            <h2 className="card-title">
              {icon}
              {title}
            </h2>
            {sub && <p className="card-sub">{sub}</p>}
          </div>
          {actions}
        </div>
      )}
      {children}
    </section>
  )
}

export function StatCard({
  icon,
  tone,
  value,
  label,
  note,
  noteTone,
}: {
  icon: ReactNode
  tone: Tone
  value: ReactNode
  label: string
  note?: string
  noteTone?: Tone
}) {
  return (
    <div className="card stat">
      <div className="stat-top">
        <IconTile tone={tone}>{icon}</IconTile>
        {note && (
          <span className={`stat-note`} style={{ color: `var(--${noteTone === 'red' ? 'red' : noteTone === 'amber' ? 'amber' : 'green'})` }}>
            {note}
          </span>
        )}
      </div>
      <div>
        <div className="stat-value">{value}</div>
        <div className="stat-label">{label}</div>
      </div>
    </div>
  )
}

export type Message = { kind: 'ok' | 'error' | 'info'; text: string }

export function Notice({ message }: { message: Message | null }) {
  if (!message) return null
  const Icon = message.kind === 'ok' ? CheckCircle2 : message.kind === 'error' ? AlertCircle : Info
  return (
    <p className={`notice notice-${message.kind}`} role={message.kind === 'error' ? 'alert' : 'status'}>
      <Icon size={17} aria-hidden="true" />
      <span>{message.text}</span>
    </p>
  )
}

const TX_LABELS: Record<string, string> = {
  GrantConsent: 'Consent granted',
  RevokeConsent: 'Consent revoked',
  RequestAccess: 'Access requested',
  VerifyAndGrantAccess: 'Request checked against consent',
  LogAccessEvent: 'Decision written to the audit log',
}

/** The ledger transactions an action produced. */
export function LedgerReceipt({ txs }: { txs: LedgerTx[] }) {
  if (txs.length === 0) return null
  return (
    <div className="receipt" aria-label="Recorded on the ledger">
      {txs.map((t) => (
        <div className="receipt-row" key={t.txId}>
          <CheckCircle2 size={16} aria-hidden="true" />
          <strong>{TX_LABELS[t.fn] ?? t.fn}</strong>
          <span className="muted">· saved to the ledger in block {t.block}</span>
          <span className="muted small mono" title={t.txId}>
            <Link2 size={12} aria-hidden="true" style={{ verticalAlign: -2 }} /> {short(t.txId, 12)}
          </span>
        </div>
      ))}
    </div>
  )
}

export type TimelineItem = { key: string; tone: Tone; date: string; title: string; sub?: string }

export function Timeline({ items }: { items: TimelineItem[] }) {
  return (
    <ol className="timeline">
      {items.map((i) => (
        <li key={i.key}>
          <span className="tl-dot" style={{ color: `var(--${toneVar(i.tone)})` }} aria-hidden="true" />
          <div className="tl-date">{i.date}</div>
          <div className="tl-title">{i.title}</div>
          {i.sub && <div className="tl-sub">{i.sub}</div>}
        </li>
      ))}
    </ol>
  )
}

const toneVar = (t: Tone) => (t === 'blue' ? 'primary' : t === 'grey' ? 'faint' : t)

export function Empty({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <div className="empty">
      {icon}
      <div>{children}</div>
    </div>
  )
}

/** Grouped bar chart: two series per category, drawn as plain SVG. */
export function BarChart({
  data,
  series,
  height = 180,
}: {
  data: { label: string; values: number[] }[]
  series: { name: string; color: string }[]
  height?: number
}) {
  const max = Math.max(1, ...data.flatMap((d) => d.values))
  const ticks = Array.from(new Set([0, Math.ceil(max / 2), max]))
  const w = 560
  const padL = 28
  const padB = 24
  const plotH = height - padB - 8
  const groupW = (w - padL) / Math.max(1, data.length)
  const barW = Math.min(18, (groupW - 12) / series.length)
  return (
    <svg viewBox={`0 0 ${w} ${height}`} width="100%" role="img" aria-label="Access decisions per day">
      {ticks.map((t) => {
        const y = 8 + plotH - (t / max) * plotH
        return (
          <g key={t}>
            <line x1={padL} x2={w} y1={y} y2={y} stroke="#e4ebf5" />
            <text x={padL - 8} y={y + 4} textAnchor="end" fontSize="11" fill="#94a3b8">
              {t}
            </text>
          </g>
        )
      })}
      {data.map((d, i) => {
        const gx = padL + i * groupW + (groupW - barW * series.length - 4 * (series.length - 1)) / 2
        return (
          <g key={d.label}>
            {d.values.map((v, s) => {
              const h = (v / max) * plotH
              return (
                <rect
                  key={s}
                  x={gx + s * (barW + 4)}
                  y={8 + plotH - h}
                  width={barW}
                  height={Math.max(h, v > 0 ? 2 : 0)}
                  rx={4}
                  fill={series[s].color}
                >
                  <title>{`${d.label}: ${v} ${series[s].name.toLowerCase()}`}</title>
                </rect>
              )
            })}
            <text x={padL + i * groupW + groupW / 2} y={height - 6} textAnchor="middle" fontSize="11" fill="#64748b">
              {d.label}
            </text>
          </g>
        )
      })}
    </svg>
  )
}
