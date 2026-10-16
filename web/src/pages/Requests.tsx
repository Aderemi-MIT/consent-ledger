import { CheckCircle2, ClipboardList, FileSearch, FileText, Fingerprint, LockKeyhole, Send, ShieldCheck, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api, fmtDate, newRequestId, short, type ClinicalRecord, type LedgerTx } from '../api'
import { Avatar, Card, Empty, IconTile, LedgerReceipt, Notice, Pill, type Message, type Tone } from '../components'
import { useLedger } from '../data'
import { fieldLabel, friendlyError } from '../labels'

const STATUS_TONE: Record<string, Tone> = { PENDING: 'amber', GRANTED: 'green', DENIED: 'red' }
const STATUS_LABEL: Record<string, string> = { PENDING: 'Awaiting verification', GRANTED: 'Granted', DENIED: 'Denied' }

export function Requests({
  providerId,
  patientId,
  setPatientId,
  initialRecord,
}: {
  providerId: string
  patientId: string
  setPatientId: (id: string) => void
  /** Record to preselect, e.g. when arriving from search. */
  initialRecord?: string
}) {
  const { dir, requests, refresh, noteBlock } = useLedger()
  const [recordRef, setRecordRef] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState<Message | null>(null)
  const [txs, setTxs] = useState<LedgerTx[]>([])
  const [opened, setOpened] = useState<ClinicalRecord | null>(null)

  useEffect(() => {
    const forPatient = dir?.records.filter((r) => r.patientId === patientId) ?? []
    setRecordRef(forPatient.find((r) => r.recordReference === initialRecord)?.recordReference ?? forPatient[0]?.recordReference ?? '')
  }, [patientId, dir, initialRecord])

  if (!dir) return null
  const patientRecords = dir.records.filter((r) => r.patientId === patientId)
  const mine = requests.filter((r) => r.providerId === providerId)
  const patientName = (id: string) =>
    (dir.patients.find((p) => p.patientId === id)?.displayName ?? id).replace(' (synthetic)', '')

  const run = async (key: string, info: string, action: () => Promise<void>) => {
    setBusy(key)
    setTxs([])
    setMessage({ kind: 'info', text: info })
    try {
      await action()
    } catch (e) {
      setMessage({ kind: 'error', text: friendlyError(e) })
    } finally {
      setBusy(null)
    }
  }

  const submit = () =>
    run('new', 'Saving the request to the ledger…', async () => {
      const id = newRequestId()
      const res = await api.requestAccess(id, providerId, patientId, recordRef)
      setTxs(res.txs)
      res.txs.forEach((t) => noteBlock(t.block))
      setOpened(null)
      setMessage({ kind: 'ok', text: 'Request submitted. Next, verify it against the patient’s consent.' })
      await refresh()
    })

  const verify = (id: string) =>
    run(id, 'Checking the patient’s consent and logging the decision…', async () => {
      const res = await api.verify(id)
      setTxs(res.txs)
      res.txs.forEach((t) => noteBlock(t.block))
      setMessage(
        res.data.granted
          ? { kind: 'ok', text: 'Access granted. You can now open the record.' }
          : { kind: 'error', text: 'Access denied: the patient has not given this organisation active consent.' },
      )
      await refresh()
    })

  const open = (id: string) =>
    run(id, 'Fetching the record from the hospital and checking it against the ledger…', async () => {
      setOpened((await api.record(id)).data)
      setMessage(null)
    })

  return (
    <>
      <section className="hero">
        <div>
          <div className="hero-kicker">Laboratory</div>
          <h1>Request access to a patient record</h1>
          <p>
            Submit a request, then verify it. The network checks the patient’s current consent and logs the
            decision either way. A record can only be opened if access was granted.
          </p>
        </div>
        <div className="hero-art">
          <FileSearch size={48} strokeWidth={1.6} aria-hidden="true" />
        </div>
      </section>

      <div className="grid grid-split">
        <div className="stack">
          <Card title="New access request" icon={<Send size={18} />}>
            <div className="form-row">
              <label className="field">
                Patient
                <select value={patientId} onChange={(e) => setPatientId(e.target.value)}>
                  {dir.patients.map((p) => (
                    <option key={p.patientId} value={p.patientId}>
                      {p.displayName.replace(' (synthetic)', '')}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                Record
                <select value={recordRef} onChange={(e) => setRecordRef(e.target.value)}>
                  {patientRecords.map((r) => (
                    <option key={r.recordReference} value={r.recordReference}>
                      {r.recordReference} · {r.recordType}
                    </option>
                  ))}
                </select>
              </label>
              <button className="primary" disabled={busy !== null || !recordRef} onClick={submit} style={{ justifyContent: 'center' }}>
                <Send size={16} aria-hidden="true" />
                {busy === 'new' ? 'Submitting…' : 'Request access'}
              </button>
            </div>
            <div className="stack" style={{ gap: 10, marginTop: 14 }}>
              <Notice message={message} />
              <LedgerReceipt txs={txs} />
            </div>
          </Card>

          <Card
            title="Your access requests"
            icon={<ClipboardList size={18} />}
            sub={`${mine.length} request${mine.length === 1 ? '' : 's'} from ${dir.providers.find((p) => p.providerId === providerId)?.organization ?? providerId}`}
          >
            {mine.length === 0 ? (
              <Empty icon={<ClipboardList size={28} />}>Requests you submit appear here.</Empty>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Patient</th>
                      <th>Record</th>
                      <th>Requested</th>
                      <th>Status</th>
                      <th className="right">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {mine.map((r) => (
                      <tr key={r.requestId}>
                        <td>
                          <div className="who">
                            <Avatar name={patientName(r.patientId)} id={r.patientId} size={32} />
                            <div>
                              <div className="who-name">{patientName(r.patientId)}</div>
                              <div className="who-sub mono">{r.requestId}</div>
                            </div>
                          </div>
                        </td>
                        <td className="mono">{r.recordReference}</td>
                        <td className="small muted">{fmtDate(r.requestedAt)}</td>
                        <td>
                          <Pill tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Pill>
                        </td>
                        <td className="right">
                          {r.status === 'PENDING' && (
                            <button className="small" disabled={busy !== null} onClick={() => verify(r.requestId)}>
                              <ShieldCheck size={15} aria-hidden="true" />
                              {busy === r.requestId ? 'Verifying…' : 'Verify'}
                            </button>
                          )}
                          {r.status === 'GRANTED' && (
                            <button className="primary small" disabled={busy !== null} onClick={() => open(r.requestId)}>
                              <FileText size={15} aria-hidden="true" />
                              {busy === r.requestId ? 'Opening…' : 'Open record'}
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>

        {opened ? (
          <Card
            title={`Record ${opened.recordReference}`}
            icon={<FileText size={18} />}
            sub={`${patientName(opened.patientId)} · ${opened.recordType}`}
            actions={
              <button className="ghost small" onClick={() => setOpened(null)} aria-label="Close record">
                <X size={16} />
              </button>
            }
          >
            <div className="notice notice-ok" style={{ marginBottom: 14 }}>
              <Fingerprint size={17} aria-hidden="true" />
              <span>
                Verified against the ledger. The record’s fingerprint matches the one saved when access was requested{' '}
                <span className="mono" title={opened.contentHash}>
                  ({short(opened.contentHash, 10)})
                </span>
                , so it has not been altered.
              </span>
            </div>
            <div className="record-grid">
              {Object.entries(opened.content).flatMap(([k, v]) =>
                v !== null && typeof v === 'object'
                  ? Object.entries(v as Record<string, unknown>).map(([k2, v2]) => (
                      <div className="record-cell" key={`${k}.${k2}`}>
                        <div className="fact-label">{fieldLabel(k2)}</div>
                        <div className="fact-value">{String(v2)}</div>
                      </div>
                    ))
                  : [
                      <div className="record-cell" key={k}>
                        <div className="fact-label">{fieldLabel(k)}</div>
                        <div className="fact-value">{String(v)}</div>
                      </div>,
                    ],
              )}
            </div>
          </Card>
        ) : (
          <Card title="How access works" icon={<LockKeyhole size={18} />}>
            <ul className="list">
              {[
                { icon: <Send size={17} />, tone: 'blue' as Tone, t: 'Request', s: 'Ask for a specific record. Its fingerprint is saved to the ledger.' },
                { icon: <ShieldCheck size={17} />, tone: 'violet' as Tone, t: 'Verify', s: 'The network checks the patient’s current consent and logs the decision.' },
                { icon: <CheckCircle2 size={17} />, tone: 'green' as Tone, t: 'Open', s: 'If granted, the hospital releases the record, after checking its fingerprint.' },
              ].map((step) => (
                <li key={step.t}>
                  <IconTile tone={step.tone} size={34}>
                    {step.icon}
                  </IconTile>
                  <div className="list-main">
                    <div className="list-title">{step.t}</div>
                    <div className="list-sub">{step.s}</div>
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </>
  )
}
