import { History, ShieldCheck, Users } from 'lucide-react'
import { useState } from 'react'
import { api, fmtDate, type LedgerTx } from '../api'
import { Avatar, Card, Empty, IconTile, LedgerReceipt, Notice, Pill, ProviderIcon, Timeline, type Message, type TimelineItem } from '../components'
import { consentState } from '../consent'
import { consentKey, useLedger } from '../data'
import { friendlyError } from '../labels'

const SCOPES = [
  { value: 'full-record', label: 'Full record' },
  { value: 'lab-results', label: 'Lab results' },
  { value: 'prescriptions', label: 'Prescriptions' },
  { value: 'clinical-notes', label: 'Clinical notes' },
]

function defaultExpiry(): string {
  const d = new Date()
  d.setDate(d.getDate() + 30)
  return d.toISOString().slice(0, 10)
}

export function Patients({ patientId, setPatientId }: { patientId: string; setPatientId: (id: string) => void }) {
  const { dir, consents, requests, refresh, noteBlock } = useLedger()
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState<Message | null>(null)
  const [txs, setTxs] = useState<LedgerTx[]>([])
  const [form, setForm] = useState<{ providerId: string; scope: string; expiry: string } | null>(null)

  if (!dir) return null
  const patient = dir.patients.find((p) => p.patientId === patientId) ?? dir.patients[0]
  const providerName = (id: string) => dir.providers.find((p) => p.providerId === id)?.organization ?? id
  const activeFor = (ptId: string) =>
    dir.providers.filter((pr) => consentState(consents[consentKey(ptId, pr.providerId)] ?? null).label === 'Active')

  const select = (id: string) => {
    setPatientId(id)
    setMessage(null)
    setTxs([])
    setForm(null)
  }

  const act = async (key: string, info: string, action: () => Promise<{ txs: LedgerTx[] }>, done: string) => {
    setBusy(key)
    setTxs([])
    setMessage({ kind: 'info', text: info })
    try {
      const res = await action()
      setTxs(res.txs)
      res.txs.forEach((t) => noteBlock(t.block))
      setMessage({ kind: 'ok', text: done })
      setForm(null)
      await refresh()
    } catch (e) {
      setMessage({ kind: 'error', text: friendlyError(e) })
    } finally {
      setBusy(null)
    }
  }

  const grant = () => {
    if (!form) return
    // End of the chosen day in the participant's own time zone.
    const expiry = new Date(`${form.expiry}T23:59:59`).toISOString()
    act(
      form.providerId,
      'Saving the consent to the ledger. This takes a few seconds…',
      () => api.grantConsent(patient.patientId, form.providerId, form.scope, expiry),
      `${providerName(form.providerId)} can now access the record until ${fmtDate(expiry)}.`,
    )
  }

  const revoke = (providerId: string) =>
    act(
      providerId,
      'Saving the revocation to the ledger…',
      () => api.revokeConsent(patient.patientId, providerId),
      `${providerName(providerId)} can no longer open these records, including any it was already granted.`,
    )

  const records = dir.records.filter((r) => r.patientId === patient.patientId)
  const patientRequests = requests.filter((r) => r.patientId === patient.patientId)
  const history: TimelineItem[] = dir.providers
    .map((pr) => ({ pr, c: consents[consentKey(patient.patientId, pr.providerId)] ?? null }))
    .filter((x) => x.c)
    .sort((a, b) => (a.c!.grantedAt < b.c!.grantedAt ? 1 : -1))
    .flatMap(({ pr, c }) => {
      const st = consentState(c)
      return [
        {
          key: pr.providerId,
          tone: st.label === 'Active' ? 'green' : st.label === 'Revoked' ? 'red' : 'amber',
          date: fmtDate(c!.grantedAt),
          title: `${st.label === 'Active' ? 'Consent granted' : st.label === 'Revoked' ? 'Consent granted, later revoked' : 'Consent expired'}`,
          sub: `${pr.organization} · ${SCOPES.find((s) => s.value === c!.scope)?.label ?? c!.scope}`,
        } satisfies TimelineItem,
      ]
    })

  const historyCard = <HistoryCard history={history} />

  return (
    <>
      <section className="hero">
        <div>
          <div className="hero-kicker">Patient</div>
          <h1>Who can see your health records</h1>
          <p>
            Choose which organisations may look at your records and for how long. You can change your mind at any
            time, and every change is saved to the ledger, where nobody can alter it later.
          </p>
        </div>
        <div className="hero-art">
          <Users size={48} strokeWidth={1.6} aria-hidden="true" />
        </div>
      </section>

      <div className={dir.patients.length > 1 ? 'grid grid-split' : 'grid grid-2'}>
        {dir.patients.length > 1 && (
        <Card title="Patient directory" icon={<Users size={18} />} sub="Select a patient to manage their consent">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Patient</th>
                  <th>Patient ID</th>
                  <th>Records</th>
                  <th>Sharing with</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {dir.patients.map((p) => {
                  const act = activeFor(p.patientId)
                  return (
                    <tr
                      key={p.patientId}
                      className={`clickable ${p.patientId === patient.patientId ? 'selected' : ''}`}
                      onClick={() => select(p.patientId)}
                      tabIndex={0}
                      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && select(p.patientId)}
                      aria-selected={p.patientId === patient.patientId}
                    >
                      <td>
                        <div className="who">
                          <Avatar name={p.displayName} id={p.patientId} />
                          <div className="who-name">{p.displayName.replace(' (synthetic)', '')}</div>
                        </div>
                      </td>
                      <td className="mono muted">{p.patientId}</td>
                      <td>{dir.records.filter((r) => r.patientId === p.patientId).length}</td>
                      <td>{act.length === 0 ? <span className="muted">Nobody</span> : act.map((a) => a.organization.replace('Demo ', '')).join(', ')}</td>
                      <td>{act.length > 0 ? <Pill tone="green">Sharing</Pill> : <Pill tone="grey">Private</Pill>}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Card>
        )}

        <div className="stack">
          <Card>
            <div className="profile-head">
              <Avatar name={patient.displayName} id={patient.patientId} size={56} />
              <div>
                <div className="profile-name">{patient.displayName.replace(' (synthetic)', '')}</div>
                <div className="small muted">
                  Patient ID: <span className="mono">{patient.patientId}</span>
                </div>
              </div>
            </div>
            <div className="facts">
              <div>
                <div className="fact-label">Records</div>
                <div className="fact-value">{records.length}</div>
              </div>
              <div>
                <div className="fact-label">Active consents</div>
                <div className="fact-value">{activeFor(patient.patientId).length}</div>
              </div>
              <div>
                <div className="fact-label">Requests</div>
                <div className="fact-value">{patientRequests.length}</div>
              </div>
            </div>

            <div className="section-label">Who can see these records</div>
            <div className="stack" style={{ gap: 10 }}>
              <Notice message={message} />
              <LedgerReceipt txs={txs} />
            </div>
            <ul className="list">
              {dir.providers.map((pr) => {
                const c = consents[consentKey(patient.patientId, pr.providerId)] ?? null
                const st = consentState(c)
                const active = st.label === 'Active'
                return (
                  <li key={pr.providerId}>
                    <IconTile tone={active ? 'blue' : 'grey'} size={34}>
                      <ProviderIcon type={pr.providerType} />
                    </IconTile>
                    <div className="list-main">
                      <div className="list-title">{pr.organization.replace('Demo ', '')}</div>
                      <div className="list-sub">
                        {active ? `Until ${fmtDate(c!.expiry)}` : st.label === 'Revoked' ? 'Access stopped' : st.label === 'Expired' ? 'Consent expired' : 'No access'}
                      </div>
                    </div>
                    {active ? (
                      <button className="danger small" disabled={busy !== null} onClick={() => revoke(pr.providerId)}>
                        {busy === pr.providerId ? 'Revoking…' : 'Revoke'}
                      </button>
                    ) : (
                      <button
                        className="small"
                        disabled={busy !== null}
                        onClick={() => setForm({ providerId: pr.providerId, scope: SCOPES[0].value, expiry: defaultExpiry() })}
                      >
                        Allow
                      </button>
                    )}
                  </li>
                )
              })}
            </ul>

            {form && (
              <div className="receipt" style={{ marginTop: 12, borderStyle: 'solid', gap: 12 }}>
                <div className="list-title">Allow {providerName(form.providerId)}</div>
                <label className="field">
                  What they may see
                  <select value={form.scope} onChange={(e) => setForm({ ...form, scope: e.target.value })}>
                    {SCOPES.map((s) => (
                      <option key={s.value} value={s.value}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  Allow until
                  <input
                    type="date"
                    value={form.expiry}
                    min={new Date().toISOString().slice(0, 10)}
                    onChange={(e) => setForm({ ...form, expiry: e.target.value })}
                  />
                </label>
                <div className="row">
                  <button className="primary" disabled={busy !== null || !form.expiry} onClick={grant}>
                    <ShieldCheck size={16} aria-hidden="true" />
                    {busy ? 'Saving…' : 'Allow access'}
                  </button>
                  <button disabled={busy !== null} onClick={() => setForm(null)}>
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </Card>
          {dir.patients.length > 1 && historyCard}
        </div>
        {dir.patients.length === 1 && historyCard}
      </div>
    </>
  )
}

function HistoryCard({ history }: { history: TimelineItem[] }) {
  return (
          <Card title="Consent history" icon={<History size={18} />}>
            {history.length === 0 ? (
              <Empty icon={<History size={28} />}>No consent has been granted yet.</Empty>
            ) : (
              <Timeline items={history} />
            )}
          </Card>
  )
}
