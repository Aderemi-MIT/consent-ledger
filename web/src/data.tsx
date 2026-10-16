/* eslint-disable react-refresh/only-export-components -- the provider, hook and small helpers belong together */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { api, ApiError, type AccessRequest, type Consent, type Directory, type LogEntry, type Status, type User } from './api'

export const consentKey = (patientId: string, providerId: string) => `${patientId}|${providerId}`

type Ledger = {
  dir: Directory | null
  status: Status | null
  consents: Record<string, Consent | null>
  auditLog: LogEntry[]
  requests: AccessRequest[]
  loading: boolean
  error: string | null
  /** Re-reads consents, the audit log, requests and network status. */
  refresh: () => Promise<void>
  /** Latest block number reported by a transaction in this session. */
  lastBlock: number | null
  noteBlock: (block: number) => void
}

const LedgerContext = createContext<Ledger | null>(null)

/** The patient/provider consent pairs an account is allowed to read. */
function consentPairs(d: Directory, user: User): (readonly [string, string])[] {
  const all = d.patients.flatMap((pt) => d.providers.map((pr) => [pt.patientId, pr.providerId] as const))
  if (user.role === 'patient') return all.filter(([pt]) => pt === user.patientId)
  if (user.role === 'provider' && user.providerType !== 'hospital') return all.filter(([, pr]) => pr === user.providerId)
  return all
}

export function LedgerProvider({ user, children }: { user: User; children: ReactNode }) {
  const [dir, setDir] = useState<Directory | null>(null)
  const [status, setStatus] = useState<Status | null>(null)
  const [consents, setConsents] = useState<Record<string, Consent | null>>({})
  const [auditLog, setAuditLog] = useState<LogEntry[]>([])
  const [requests, setRequests] = useState<AccessRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [lastBlock, setLastBlock] = useState<number | null>(null)

  const loadState = useCallback(async (d: Directory) => {
    const pairs = consentPairs(d, user)
    const [consentEntries, log, reqs, st] = await Promise.all([
      Promise.all(
        pairs.map(async ([pt, pr]) => {
          try {
            return [consentKey(pt, pr), (await api.consent(pt, pr)).data] as const
          } catch (e) {
            if (e instanceof ApiError && e.status === 404) return [consentKey(pt, pr), null] as const
            throw e
          }
        }),
      ),
      // Only the regulator may read the whole audit log.
      user.role === 'regulator' ? api.auditLog().then((r) => r.data) : Promise.resolve([] as LogEntry[]),
      // Read from the ledger; the API returns only the requests this account may see.
      api.requests().then((r) => r.data),
      api.status().then((r) => r.data).catch(() => null),
    ])
    setConsents(Object.fromEntries(consentEntries))
    setAuditLog(log)
    setRequests(reqs) // newest first
    setStatus(st)
  }, [user])

  const refresh = useCallback(async () => {
    setError(null)
    try {
      let d = dir
      if (!d) {
        d = (await api.directory()).data
        setDir(d)
      }
      await loadState(d)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [dir, loadState])

  useEffect(() => {
    refresh()
    // Load once on start; pages call refresh() after their own actions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const noteBlock = useCallback((block: number) => setLastBlock((b) => (b === null || block > b ? block : b)), [])

  const value = useMemo(
    () => ({ dir, status, consents, auditLog, requests, loading, error, refresh, lastBlock, noteBlock }),
    [dir, status, consents, auditLog, requests, loading, error, refresh, lastBlock, noteBlock],
  )
  return <LedgerContext.Provider value={value}>{children}</LedgerContext.Provider>
}

export function useLedger(): Ledger {
  const ctx = useContext(LedgerContext)
  if (!ctx) throw new Error('useLedger must be used inside LedgerProvider')
  return ctx
}
