import { Building2, FileHeart, FileLock2, FileSearch, LayoutDashboard, Search, UserCog, Users } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { pagesFor, useUser, type Nav, type PageId } from './auth'
import { useLedger } from './data'

type Result = { key: string; group: string; icon: ReactNode; title: string; sub: string; open: () => void }

const PAGE_WORDS: Record<PageId, { label: string; words: string; icon: ReactNode }> = {
  overview: { label: 'Overview', words: 'overview dashboard home', icon: <LayoutDashboard size={16} /> },
  patients: { label: 'My consent', words: 'consent patients allow revoke grant', icon: <Users size={16} /> },
  requests: { label: 'Access requests', words: 'access requests request verify open', icon: <FileSearch size={16} /> },
  records: { label: 'Records', words: 'records clinical hospital', icon: <FileHeart size={16} /> },
  audit: { label: 'Audit log', words: 'audit log integrity verify tamper', icon: <FileLock2 size={16} /> },
  profile: { label: 'Profile settings', words: 'profile settings password name email phone sign out account', icon: <UserCog size={16} /> },
}

/**
 * Searches everything the signed-in account can see: patients, records,
 * its access requests, audit-log entries (regulator) and app pages.
 */
export function SearchBox({ go }: { go: Nav }) {
  const user = useUser()
  const { dir, requests, auditLog } = useLedger()
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const ref = useRef<HTMLDivElement>(null)
  const allowed = pagesFor(user)

  const results = useMemo<Result[]>(() => {
    const q = query.trim().toLowerCase()
    if (!q || !dir) return []
    const has = (...fields: string[]) => fields.some((f) => f.toLowerCase().includes(q))
    const name = (id: string) => (dir.patients.find((p) => p.patientId === id)?.displayName ?? id).replace(' (synthetic)', '')
    // Where opening a patient or record leads depends on the role.
    const patientPage: PageId = allowed.includes('patients') ? 'patients' : allowed.includes('requests') ? 'requests' : 'records'
    const out: Result[] = []

    for (const p of dir.patients) {
      if (has(p.displayName, p.patientId))
        out.push({
          key: `p-${p.patientId}`,
          group: 'Patients',
          icon: <Users size={16} />,
          title: p.displayName.replace(' (synthetic)', ''),
          sub: p.patientId,
          open: () => go(patientPage, { patientId: p.patientId }),
        })
    }
    // Organisations: a patient manages their consent for each one.
    if (allowed.includes('patients') || allowed.includes('records')) {
      for (const p of dir.providers) {
        if (has(p.organization, p.providerType, p.providerId))
          out.push({
            key: `o-${p.providerId}`,
            group: 'Organisations',
            icon: <Building2 size={16} />,
            title: p.organization.replace('Demo ', ''),
            sub: `${p.providerType}${allowed.includes('patients') ? ' · manage consent' : ''}`,
            open: () => go(allowed.includes('patients') ? 'patients' : 'records'),
          })
      }
    }
    for (const r of dir.records) {
      if (has(r.recordReference, r.recordType, name(r.patientId)))
        out.push({
          key: `r-${r.recordReference}`,
          group: 'Records',
          icon: <FileHeart size={16} />,
          title: r.recordReference,
          sub: `${r.recordType} · ${name(r.patientId)}`,
          open: () => go(patientPage, { patientId: r.patientId, recordRef: r.recordReference }),
        })
    }
    for (const r of requests) {
      if (has(r.requestId, r.recordReference, r.status, name(r.patientId)))
        out.push({
          key: `q-${r.requestId}`,
          group: 'Access requests',
          icon: <FileSearch size={16} />,
          title: r.requestId,
          sub: `${r.status.toLowerCase()} · ${r.recordReference} · ${name(r.patientId)}`,
          open: () => go(allowed.includes('requests') ? 'requests' : patientPage, { patientId: r.patientId }),
        })
    }
    for (const e of auditLog) {
      if (has(e.requestId, e.outcome, e.hash))
        out.push({
          key: `a-${e.requestId}`,
          group: 'Audit log',
          icon: <FileLock2 size={16} />,
          title: e.requestId,
          sub: `#${e.seq} · ${e.outcome.toLowerCase()}`,
          open: () => go('audit'),
        })
    }
    for (const id of allowed) {
      const info = PAGE_WORDS[id]
      if (has(info.label, info.words))
        out.push({ key: `g-${id}`, group: 'Go to', icon: info.icon, title: info.label, sub: 'Page', open: () => go(id) })
    }
    return out.slice(0, 10)
  }, [query, dir, requests, auditLog, allowed, go])

  useEffect(() => setActive(0), [query])

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false)
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  const choose = (r: Result) => {
    r.open()
    setQuery('')
    setOpen(false)
  }

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setOpen(true)
      setActive((a) => Math.min(a + 1, results.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => Math.max(a - 1, 0))
    } else if (e.key === 'Enter' && results[active]) {
      e.preventDefault()
      choose(results[active])
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  const placeholder =
    user.role === 'patient'
      ? 'Search your records and requests'
      : user.role === 'regulator'
        ? 'Search patients, records and the audit log'
        : 'Search patients, records and requests'

  return (
    <div className="search-wrap" ref={ref}>
      <label className="search">
        <Search size={16} aria-hidden="true" />
        <input
          placeholder={placeholder}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKey}
          role="combobox"
          aria-expanded={open && query.trim() !== ''}
          aria-controls="search-results"
          aria-autocomplete="list"
          aria-label="Search"
        />
      </label>
      {open && query.trim() !== '' && (
        <div className="search-pop" id="search-results" role="listbox">
          {results.length === 0 ? (
            <div className="search-empty">No matches for “{query.trim()}”.</div>
          ) : (
            results.map((r, i) => (
              <div key={r.key}>
                {(i === 0 || results[i - 1].group !== r.group) && <div className="search-group">{r.group}</div>}
                <button
                  role="option"
                  aria-selected={i === active}
                  className={`search-item ${i === active ? 'active' : ''}`}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => choose(r)}
                >
                  <span className="search-icon" aria-hidden="true">
                    {r.icon}
                  </span>
                  <span className="list-main">
                    <span className="list-title">{r.title}</span>
                    <span className="list-sub">{r.sub}</span>
                  </span>
                </button>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}
