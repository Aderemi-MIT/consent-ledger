// Typed client for the Go REST API (chaincode/cmd/api). The dev server
// forwards /api/... to the API (see vite.config.ts).

export type Patient = { patientId: string; displayName: string }
export type Provider = { providerId: string; organization: string; providerType: string }
export type RecordMeta = { recordReference: string; patientId: string; recordType: string }
export type Directory = { patients: Patient[]; providers: Provider[]; records: RecordMeta[] }

export type Consent = {
  patientId: string
  providerId: string
  scope: string
  expiry: string
  revoked: boolean
  grantedAt: string
}

export type RequestStatus = 'PENDING' | 'GRANTED' | 'DENIED'

export type AccessRequest = {
  requestId: string
  providerId: string
  patientId: string
  recordReference: string
  contentHash: string
  status: RequestStatus
  requestedAt: string
}

export type VerifyResult = { granted: boolean; outcome: 'GRANTED' | 'DENIED'; recordReference: string }

export type LogEntry = {
  requestId: string
  outcome: string
  loggedAt: string
  seq: number
  prevHash: string
  hash: string
}

export type Integrity = { intact: boolean; brokenAt: string }

export type ClinicalRecord = {
  requestId: string
  recordReference: string
  patientId: string
  recordType: string
  content: Record<string, unknown>
  contentHash: string
  hashVerified: boolean
}

export type Status = {
  status: string
  fabric: Record<string, string>
  database: Record<string, string>
}

export type Role = 'patient' | 'provider' | 'regulator'

/** The signed-in account (GET /auth/me). */
export type User = {
  userId: string
  username: string
  role: Role
  patientId?: string
  providerId?: string
  providerType?: string
  organization?: string
  displayName: string
  email: string
  phone: string
}

/** Fired when the API reports that the session has ended. */
export const SIGNED_OUT_EVENT = 'consentledger:signed-out'

/** A committed ledger transaction, from the API's X-Fabric-Tx header. */
export type LedgerTx = { fn: string; txId: string; block: number; status: string }

export type ApiResult<T> = { data: T; txs: LedgerTx[] }

/** An error response from the API, with its HTTP status. */
export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

function parseTxHeader(value: string | null): LedgerTx[] {
  if (!value) return []
  // Multiple headers arrive comma-joined: "Fn tx=.. block=.. status=.., Fn2 ..."
  return value.split(/,\s*/).flatMap((rec) => {
    const [fn, ...rest] = rec.trim().split(/\s+/)
    const f = Object.fromEntries(rest.map((p) => p.split('=') as [string, string]))
    return f.tx ? [{ fn, txId: f.tx, block: Number(f.block), status: f.status }] : []
  })
}

async function call<T>(method: 'GET' | 'POST' | 'PUT', path: string, body?: unknown): Promise<ApiResult<T>> {
  let res: Response
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    throw new ApiError(0, 'Cannot reach the API. Is it running on port 18080?')
  }
  const text = await res.text()
  let data: unknown = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    // Not JSON: for example the dev server's error page when the API is down.
  }
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith('/auth/login')) window.dispatchEvent(new Event(SIGNED_OUT_EVENT))
    const msg =
      data && typeof data === 'object' && 'error' in data
        ? String((data as { error: unknown }).error)
        : res.status === 502 || res.status === 504
          ? 'Cannot reach the API. Is it running on port 18080?'
          : `Request failed (HTTP ${res.status})`
    throw new ApiError(res.status, msg)
  }
  return { data: data as T, txs: parseTxHeader(res.headers.get('X-Fabric-Tx')) }
}

const q = (params: Record<string, string>) => '?' + new URLSearchParams(params).toString()

export const api = {
  login: (username: string, password: string) => call<User>('POST', '/auth/login', { username, password }),
  logout: () => call<{ status: string }>('POST', '/auth/logout'),
  me: () => call<User>('GET', '/auth/me'),
  updateProfile: (displayName: string, email: string, phone: string) =>
    call<User>('PUT', '/auth/profile', { displayName, email, phone }),
  changePassword: (currentPassword: string, newPassword: string) =>
    call<{ status: string }>('POST', '/auth/password', { currentPassword, newPassword }),
  status: () => call<Status>('GET', '/'),
  directory: () => call<Directory>('GET', '/directory'),
  consent: (patientId: string, providerId: string) => call<Consent>('GET', '/consent' + q({ patientId, providerId })),
  grantConsent: (patientId: string, providerId: string, scope: string, expiry: string) =>
    call<{ status: string }>('POST', '/consent/grant', { patientId, providerId, scope, expiry }),
  revokeConsent: (patientId: string, providerId: string) =>
    call<{ status: string }>('POST', '/consent/revoke', { patientId, providerId }),
  requestAccess: (requestId: string, providerId: string, patientId: string, recordReference: string) =>
    call<{ status: string }>('POST', '/access/request', { requestId, providerId, patientId, recordReference }),
  requests: () => call<AccessRequest[]>('GET', '/access/requests'),
  requestStatus: (requestId: string) => call<AccessRequest>('GET', '/access/status' + q({ requestId })),
  verify: (requestId: string) => call<VerifyResult>('POST', '/access/verify', { requestId }),
  record: (requestId: string) => call<ClinicalRecord>('GET', '/access/record' + q({ requestId })),
  auditLog: () => call<LogEntry[]>('GET', '/audit/log'),
  auditVerify: () => call<Integrity>('GET', '/audit/verify'),
}

/** A fresh, readable request ID, e.g. req-20261016T131500-4821. */
export function newRequestId(): string {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)
  return `req-${stamp}-${Math.floor(1000 + Math.random() * 9000)}`
}

export function fmtDate(iso: string): string {
  const d = new Date(iso)
  return isNaN(d.getTime()) ? iso : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

export const short = (h: string, n = 10) => (h.length > n ? h.slice(0, n) + '…' : h)
