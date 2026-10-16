import { FileLock2, Link2, RefreshCw, ShieldCheck, ShieldQuestion, ShieldX } from 'lucide-react'
import { useState } from 'react'
import { api, fmtDate, short, type Integrity } from '../api'
import { Card, IconTile, Notice, Pill, StatCard, type Message } from '../components'
import { useLedger } from '../data'

export function Audit() {
  const { auditLog, refresh } = useLedger()
  const [integrity, setIntegrity] = useState<Integrity | null>(null)
  const [checking, setChecking] = useState(false)
  const [message, setMessage] = useState<Message | null>(null)
  const entries = auditLog.slice().reverse()
  const granted = auditLog.filter((e) => e.outcome === 'GRANTED').length

  async function check() {
    setChecking(true)
    setIntegrity(null)
    setMessage(null)
    try {
      await refresh()
      setIntegrity((await api.auditVerify()).data)
    } catch (e) {
      setMessage({ kind: 'error', text: e instanceof Error ? e.message : String(e) })
    } finally {
      setChecking(false)
    }
  }

  return (
    <>
      <section className="hero">
        <div>
          <div className="hero-kicker">Demo Health Regulator E</div>
          <h1>Audit log</h1>
          <p>
            Every access decision is written to a shared log. Each entry is chained to the one before it by a
            cryptographic fingerprint, so altering any past entry would break the chain at exactly that point.
          </p>
        </div>
        <div className="hero-art">
          <FileLock2 size={48} strokeWidth={1.6} aria-hidden="true" />
        </div>
      </section>

      <div className="grid grid-stats">
        <StatCard icon={<FileLock2 size={20} />} tone="blue" value={auditLog.length} label="Logged decisions" />
        <StatCard icon={<ShieldCheck size={20} />} tone="green" value={granted} label="Access granted" />
        <StatCard icon={<ShieldX size={20} />} tone="red" value={auditLog.length - granted} label="Access denied" />
        <div className="card stat">
          <div className="stat-top">
            <IconTile tone={integrity ? (integrity.intact ? 'green' : 'red') : 'violet'}>
              {integrity ? integrity.intact ? <ShieldCheck size={20} /> : <ShieldX size={20} /> : <ShieldQuestion size={20} />}
            </IconTile>
          </div>
          <div>
            <div className="stat-value" style={{ fontSize: 20 }}>
              {integrity ? (integrity.intact ? 'Intact' : 'Tampered') : 'Not checked'}
            </div>
            <button className="primary small" style={{ marginTop: 8 }} disabled={checking} onClick={check}>
              <RefreshCw size={14} aria-hidden="true" />
              {checking ? 'Checking…' : 'Verify integrity'}
            </button>
          </div>
        </div>
      </div>

      <Notice message={message} />
      {integrity &&
        (integrity.intact ? (
          <Notice message={{ kind: 'ok', text: `The audit log is intact. All ${auditLog.length} entries match their fingerprints and are correctly chained.` }} />
        ) : (
          <Notice
            message={{ kind: 'error', text: `The audit log has been tampered with. The chain breaks at request ${integrity.brokenAt}.` }}
          />
        ))}

      <Card title="Access decisions" icon={<Link2 size={18} />} sub="Newest first. Each fingerprint is chained to the entry below it.">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Request</th>
                <th>Decision</th>
                <th>Logged</th>
                <th>Fingerprint</th>
                <th>Chained to</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.requestId} className={integrity && integrity.brokenAt === e.requestId ? 'row-broken' : ''}>
                  <td className="muted">{e.seq}</td>
                  <td className="mono">{e.requestId}</td>
                  <td>
                    <Pill tone={e.outcome === 'GRANTED' ? 'green' : 'red'}>{e.outcome === 'GRANTED' ? 'Granted' : 'Denied'}</Pill>
                  </td>
                  <td className="small muted">{fmtDate(e.loggedAt)}</td>
                  <td className="mono small" title={e.hash}>
                    {short(e.hash, 12)}
                  </td>
                  <td className="mono small muted" title={e.prevHash || 'First entry'}>
                    {e.prevHash ? short(e.prevHash, 12) : 'First entry'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  )
}
