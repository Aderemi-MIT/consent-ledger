import type { Consent } from './api'

/** Plain-language state of a consent record, as of now. */
export function consentState(c: Consent | null): { label: string; tone: 'green' | 'red' | 'amber' | 'grey' } {
  if (!c) return { label: 'No consent', tone: 'grey' }
  if (c.revoked) return { label: 'Revoked', tone: 'red' }
  if (new Date(c.expiry) <= new Date()) return { label: 'Expired', tone: 'amber' }
  return { label: 'Active', tone: 'green' }
}
