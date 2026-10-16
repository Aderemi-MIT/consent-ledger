import { Activity, BarChart3, CheckCircle2, Clock3, FileHeart, FileLock2, FileSearch, ShieldCheck, ShieldX, UserCheck, Users, XCircle } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api, fmtDate, type Integrity } from '../api'
import { roleLabel, useUser, type Nav } from '../auth'
import { BarChart, Card, Empty, IconTile, Pill, StatCard } from '../components'
import { consentState } from '../consent'
import { useLedger } from '../data'

function greeting(): string {
  const h = new Date().getHours()
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
}

/** Granted and denied decisions per day for the last `days` days. */
function byDay(items: { at: string; granted: boolean }[], days = 7) {
  const out: { label: string; values: number[] }[] = []
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  for (let i = days - 1; i >= 0; i--) {
    const day = new Date(today)
    day.setDate(today.getDate() - i)
    const next = new Date(day)
    next.setDate(day.getDate() + 1)
    const inDay = items.filter((e) => {
      const t = new Date(e.at)
      return t >= day && t < next
    })
    out.push({
      label: day.toLocaleDateString(undefined, { weekday: 'short' }),
      values: [inDay.filter((e) => e.granted).length, inDay.filter((e) => !e.granted).length],
    })
  }
  return out
}

const STATUS_TONE = { PENDING: 'amber', GRANTED: 'green', DENIED: 'red' } as const

export function Overview({ go }: { go: Nav }) {
  const user = useUser()
  const { dir, consents, auditLog, requests } = useLedger()
  const [integrity, setIntegrity] = useState<Integrity | null>(null)
  const isRegulator = user.role === 'regulator'

  useEffect(() => {
    if (!isRegulator) return
    api
      .auditVerify()
      .then((r) => setIntegrity(r.data))
      .catch(() => setIntegrity(null))
  }, [isRegulator, auditLog.length])

  if (!dir) return null
  const firstName = user.displayName.split(/[\s,]+/)[0]
  const active = Object.values(consents).filter((c) => consentState(c).label === 'Active').length
  const pending = requests.filter((r) => r.status === 'PENDING').length
  const grantedReq = requests.filter((r) => r.status === 'GRANTED').length
  const deniedReq = requests.filter((r) => r.status === 'DENIED').length

  // The regulator sees every decision from the audit log; everyone else
  // sees the requests they made or that concern them.
  const decisions = isRegulator
    ? auditLog.map((e) => ({ at: e.loggedAt, granted: e.outcome === 'GRANTED' }))
    : requests.filter((r) => r.status !== 'PENDING').map((r) => ({ at: r.requestedAt, granted: r.status === 'GRANTED' }))
  const granted = decisions.filter((d) => d.granted).length

  const intro =
    user.role === 'patient'
      ? 'See who may access your records, and every request made for them. You decide who sees what, and every decision is saved where no one can alter it.'
      : isRegulator
        ? 'Oversee every access decision across the network, and confirm that the audit log has not been altered.'
        : 'Request access to patient records and see the outcome of each request. Access is only granted where the patient has given active consent.'

  return (
    <>
      <section className="hero">
        <div>
          <div className="hero-kicker">
            {greeting()}, {firstName}
          </div>
          <h1>{user.role === 'patient' ? 'Your consent overview' : `${roleLabel(user)} overview`}</h1>
          <p>{intro}</p>
        </div>
        <div className="hero-art">
          <ShieldCheck size={48} strokeWidth={1.6} aria-hidden="true" />
        </div>
      </section>

      <div className="grid grid-stats">
        {user.role === 'patient' ? (
          <>
            <StatCard icon={<FileHeart size={20} />} tone="blue" value={dir.records.length} label="Your records" />
            <StatCard icon={<UserCheck size={20} />} tone="green" value={active} label="Organisations with access" />
            <StatCard icon={<FileSearch size={20} />} tone="amber" value={requests.length} label="Requests for your records" />
            <StatCard icon={<CheckCircle2 size={20} />} tone="violet" value={grantedReq} label="Requests granted" />
          </>
        ) : isRegulator ? (
          <>
            <StatCard icon={<Users size={20} />} tone="blue" value={dir.patients.length} label="Patients" note={`${dir.records.length} records held`} />
            <StatCard icon={<UserCheck size={20} />} tone="green" value={active} label="Active consents" />
            <StatCard icon={<FileLock2 size={20} />} tone="amber" value={auditLog.length} label="Logged decisions" />
            <StatCard
              icon={integrity?.intact === false ? <ShieldX size={20} /> : <ShieldCheck size={20} />}
              tone={integrity?.intact === false ? 'red' : 'violet'}
              value={integrity ? (integrity.intact ? '100%' : 'Broken') : '…'}
              label="Audit log integrity"
              note={integrity ? (integrity.intact ? 'Verified now' : 'Tampering detected') : undefined}
              noteTone={integrity?.intact === false ? 'red' : 'green'}
            />
          </>
        ) : (
          <>
            <StatCard icon={<FileSearch size={20} />} tone="blue" value={requests.length} label="Your requests" />
            <StatCard
              icon={<Clock3 size={20} />}
              tone="amber"
              value={pending}
              label="Awaiting verification"
              note={pending ? 'Action needed' : undefined}
              noteTone="amber"
            />
            <StatCard icon={<CheckCircle2 size={20} />} tone="green" value={grantedReq} label="Granted" />
            <StatCard icon={<XCircle size={20} />} tone="red" value={deniedReq} label="Denied" />
          </>
        )}
      </div>

      <div className="grid grid-split">
        <Card
          title="Access decisions"
          icon={<BarChart3 size={18} />}
          sub={isRegulator ? 'All granted and denied requests over the last 7 days' : 'Your granted and denied requests over the last 7 days'}
          actions={
            <div className="chart-legend">
              <span>
                <span className="legend-dot" style={{ background: '#2563eb' }} />
                Granted ({granted})
              </span>
              <span>
                <span className="legend-dot" style={{ background: '#f59e9e' }} />
                Denied ({decisions.length - granted})
              </span>
            </div>
          }
        >
          <BarChart
            data={byDay(decisions)}
            series={[
              { name: 'Granted', color: '#2563eb' },
              { name: 'Denied', color: '#f59e9e' },
            ]}
          />
        </Card>

        {isRegulator ? (
          <Card
            title="Recent ledger activity"
            icon={<Activity size={18} />}
            actions={
              <button className="ghost small" onClick={() => go('audit')}>
                View all
              </button>
            }
          >
            {auditLog.length === 0 ? (
              <Empty icon={<Activity size={28} />}>No access decisions yet.</Empty>
            ) : (
              <ul className="list">
                {auditLog
                  .slice(-6)
                  .reverse()
                  .map((e) => (
                    <li key={e.requestId}>
                      <IconTile tone={e.outcome === 'GRANTED' ? 'green' : 'red'} size={34}>
                        {e.outcome === 'GRANTED' ? <ShieldCheck size={17} /> : <ShieldX size={17} />}
                      </IconTile>
                      <div className="list-main">
                        <div className="list-title">Access {e.outcome === 'GRANTED' ? 'granted' : 'denied'}</div>
                        <div className="list-sub mono">{e.requestId}</div>
                      </div>
                      <div className="small muted">{fmtDate(e.loggedAt)}</div>
                    </li>
                  ))}
              </ul>
            )}
          </Card>
        ) : (
          <Card
            title={user.role === 'patient' ? 'Requests for your records' : 'Your recent requests'}
            icon={<Activity size={18} />}
            actions={
              <button className="ghost small" onClick={() => go(user.role === 'patient' ? 'patients' : 'requests')}>
                {user.role === 'patient' ? 'Manage consent' : 'View all'}
              </button>
            }
          >
            {requests.length === 0 ? (
              <Empty icon={<FileSearch size={28} />}>
                {user.role === 'patient' ? 'No organisation has requested your records yet.' : 'You haven’t made any requests yet.'}
              </Empty>
            ) : (
              <ul className="list">
                {requests.slice(0, 6).map((r) => (
                  <li key={r.requestId}>
                    <IconTile tone={STATUS_TONE[r.status]} size={34}>
                      <FileSearch size={17} />
                    </IconTile>
                    <div className="list-main">
                      <div className="list-title">
                        {r.recordReference}
                        {user.role === 'patient' && (
                          <span className="muted small"> · {dir.providers.find((p) => p.providerId === r.providerId)?.organization.replace('Demo ', '')}</span>
                        )}
                      </div>
                      <div className="list-sub">{fmtDate(r.requestedAt)}</div>
                    </div>
                    <Pill tone={STATUS_TONE[r.status]}>{r.status === 'PENDING' ? 'Pending' : r.status === 'GRANTED' ? 'Granted' : 'Denied'}</Pill>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}
      </div>

      <section className="card">
        <div className="trust">
          <div className="trust-item">
            <IconTile tone="blue">
              <UserCheck size={20} />
            </IconTile>
            <div>
              <div className="trust-title">Patient-controlled consent</div>
              <div className="trust-sub">Only the patient grants or revokes access</div>
            </div>
          </div>
          <div className="trust-item">
            <IconTile tone="violet">
              <FileLock2 size={20} />
            </IconTile>
            <div>
              <div className="trust-title">Tamper-evident audit log</div>
              <div className="trust-sub">Every decision is chained and verifiable</div>
            </div>
          </div>
          <div className="trust-item">
            <IconTile tone="green">
              <ShieldCheck size={20} />
            </IconTile>
            <div>
              <div className="trust-title">Records stay with the hospital</div>
              <div className="trust-sub">
                Synthetic data only <Pill tone="grey">Prototype</Pill>
              </div>
            </div>
          </div>
        </div>
      </section>
    </>
  )
}
