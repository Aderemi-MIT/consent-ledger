import { Building2, FileHeart, FileText, FlaskConical, Pill as PillIcon, ScanLine, Stethoscope } from 'lucide-react'
import type { ReactNode } from 'react'
import { Avatar, Card, IconTile, Pill, type Tone } from '../components'
import { consentState } from '../consent'
import { consentKey, useLedger } from '../data'

const RECORD_TYPE: Record<string, { icon: ReactNode; tone: Tone; label: string }> = {
  'lab-result': { icon: <FlaskConical size={17} />, tone: 'red', label: 'Lab result' },
  prescription: { icon: <PillIcon size={17} />, tone: 'violet', label: 'Prescription' },
  'clinical-note': { icon: <Stethoscope size={17} />, tone: 'blue', label: 'Clinical note' },
  'imaging-report': { icon: <ScanLine size={17} />, tone: 'sky', label: 'Imaging report' },
}

export function Records() {
  const { dir, consents } = useLedger()
  if (!dir) return null
  const patientName = (id: string) =>
    (dir.patients.find((p) => p.patientId === id)?.displayName ?? id).replace(' (synthetic)', '')

  return (
    <>
      <section className="hero">
        <div>
          <div className="hero-kicker">Demo General Hospital A</div>
          <h1>Records held by the hospital</h1>
          <p>
            Clinical records stay in the hospital’s own database and never go on the ledger. Another organisation
            receives a record only after the patient’s consent is checked on the ledger, and only if the record still
            matches the fingerprint saved when it was requested.
          </p>
        </div>
        <div className="hero-art">
          <Building2 size={48} strokeWidth={1.6} aria-hidden="true" />
        </div>
      </section>

      <Card title="Clinical records" icon={<FileHeart size={18} />} sub={`${dir.records.length} synthetic records for ${dir.patients.length} patients`}>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Record</th>
                <th>Patient</th>
                <th>Type</th>
                <th>Who can access it</th>
              </tr>
            </thead>
            <tbody>
              {dir.records.map((r) => {
                const type = RECORD_TYPE[r.recordType] ?? { icon: <FileText size={17} />, tone: 'grey' as Tone, label: r.recordType }
                const allowed = dir.providers.filter(
                  (pr) => consentState(consents[consentKey(r.patientId, pr.providerId)] ?? null).label === 'Active',
                )
                return (
                  <tr key={r.recordReference}>
                    <td>
                      <div className="who">
                        <IconTile tone={type.tone} size={34}>
                          {type.icon}
                        </IconTile>
                        <span className="mono">{r.recordReference}</span>
                      </div>
                    </td>
                    <td>
                      <div className="who">
                        <Avatar name={patientName(r.patientId)} id={r.patientId} size={30} />
                        <div>
                          <div className="who-name">{patientName(r.patientId)}</div>
                          <div className="who-sub mono">{r.patientId}</div>
                        </div>
                      </div>
                    </td>
                    <td>{type.label}</td>
                    <td>
                      {allowed.length === 0 ? (
                        <Pill tone="grey">Hospital only</Pill>
                      ) : (
                        <div className="row" style={{ gap: 6 }}>
                          {allowed.map((pr) => (
                            <Pill key={pr.providerId} tone="green">
                              {pr.organization.replace('Demo ', '')}
                            </Pill>
                          ))}
                        </div>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  )
}
