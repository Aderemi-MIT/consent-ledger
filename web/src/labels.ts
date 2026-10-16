import { ApiError } from './api'

// Readable labels for the fields in the synthetic seed records
// (chaincode/deployment/postgres_seed.sql). Unknown fields fall back to
// their name with underscores replaced.
const FIELD_LABELS: Record<string, string> = {
  test: 'Test',
  collected: 'Collected',
  results: 'Results',
  flag: 'Flag',
  issued_by: 'Issued by',
  medication: 'Medication',
  dose: 'Dose',
  frequency: 'Frequency',
  duration_days: 'Duration (days)',
  prescribed: 'Prescribed',
  prescriber: 'Prescriber',
  visit: 'Visit date',
  complaint: 'Reason for visit',
  blood_pressure: 'Blood pressure',
  plan: 'Plan',
  author: 'Author',
  study: 'Study',
  performed: 'Performed',
  findings: 'Findings',
  impression: 'Impression',
  reported_by: 'Reported by',
  haemoglobin_g_dl: 'Haemoglobin (g/dL)',
  wbc_10e9_l: 'White cell count (×10⁹/L)',
  platelets_10e9_l: 'Platelets (×10⁹/L)',
  glucose_mmol_l: 'Glucose (mmol/L)',
  p_falciparum: 'P. falciparum',
  total_cholesterol_mmol_l: 'Total cholesterol (mmol/L)',
  ldl_mmol_l: 'LDL (mmol/L)',
  hdl_mmol_l: 'HDL (mmol/L)',
}

export const fieldLabel = (name: string) => FIELD_LABELS[name] ?? name.replace(/_/g, ' ')

/** Plain-language version of an API error, for walkthrough participants. */
export function friendlyError(e: unknown): string {
  if (!(e instanceof ApiError)) return e instanceof Error ? e.message : String(e)
  const m = e.message
  if (/has been revoked/.test(m)) return 'The patient has revoked consent, so this record can no longer be opened.'
  if (/has expired/.test(m)) return 'The patient’s consent has expired, so this record can no longer be opened.'
  if (/access was not granted/.test(m))
    return /DENIED/.test(m)
      ? 'Access to this record was denied, so it cannot be opened.'
      : 'This request has not been verified yet. Verify it first.'
  if (/has changed since access was requested/.test(m))
    return 'The record no longer matches the fingerprint on the ledger. It may have been altered, so it was not released.'
  if (/does not belong to patient/.test(m)) return 'That record does not belong to the selected patient.'
  if (/already exists/.test(m)) return 'A request with this ID already exists. Please try again.'
  return m.charAt(0).toUpperCase() + m.slice(1)
}
