import { ChevronDown, FileHeart, FileLock2, FileSearch, LayoutDashboard, LogOut, Repeat, ShieldCheck, UserCog, Users } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { pagesFor, roleLabel, useAuth, useUser, AuthProvider, type Nav, type PageId } from './auth'
import { Avatar, Notice } from './components'
import { LedgerProvider, useLedger } from './data'
import { Audit } from './pages/Audit'
import { Login } from './pages/Login'
import { Overview } from './pages/Overview'
import { Patients } from './pages/Patients'
import { Profile } from './pages/Profile'
import { Records } from './pages/Records'
import { Requests } from './pages/Requests'
import { usePersisted } from './persisted'
import { SearchBox } from './search'

const PAGE_INFO: Record<PageId, { label: string; icon: ReactNode }> = {
  overview: { label: 'Overview', icon: <LayoutDashboard size={18} /> },
  patients: { label: 'My consent', icon: <Users size={18} /> },
  requests: { label: 'Access requests', icon: <FileSearch size={18} /> },
  records: { label: 'Records', icon: <FileHeart size={18} /> },
  audit: { label: 'Audit log', icon: <FileLock2 size={18} /> },
  profile: { label: 'Profile settings', icon: <UserCog size={18} /> },
}

function UserMenu({ go }: { go: Nav }) {
  const user = useUser()
  const { signOut } = useAuth()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false)
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', esc)
    }
  }, [open])

  return (
    <div className="menu" ref={ref}>
      <button className="me" onClick={() => setOpen(!open)} aria-expanded={open} aria-haspopup="menu">
        <Avatar name={user.displayName} id={user.userId} size={36} />
        <span className="me-text">
          <span className="me-name">{user.displayName}</span>
          <span className="me-role">{roleLabel(user)}</span>
        </span>
        <ChevronDown size={16} aria-hidden="true" className="muted" />
      </button>
      {open && (
        <div className="menu-pop" role="menu">
          <div className="menu-head">
            <div className="me-name">{user.displayName}</div>
            <div className="me-role mono">{user.username}</div>
          </div>
          <button role="menuitem" className="menu-item" onClick={() => (setOpen(false), go('profile'))}>
            <UserCog size={16} aria-hidden="true" />
            Profile settings
          </button>
          <button role="menuitem" className="menu-item" onClick={signOut}>
            <Repeat size={16} aria-hidden="true" />
            Switch account
          </button>
          <button role="menuitem" className="menu-item menu-danger" onClick={signOut}>
            <LogOut size={16} aria-hidden="true" />
            Sign out
          </button>
        </div>
      )}
    </div>
  )
}

function Shell() {
  const user = useUser()
  const { dir, status, error, loading, lastBlock, refresh } = useLedger()
  const allowed = pagesFor(user)
  const [page, setPage] = useState<PageId>(() => {
    const hash = window.location.hash.slice(1) as PageId
    return allowed.includes(hash) ? hash : 'overview'
  })
  const [patientId, setPatientId] = usePersisted('patient', user.patientId ?? 'patient-002')
  const [recordRef, setRecordRef] = useState<string | undefined>()

  const go: Nav = (id, opts) => {
    if (!allowed.includes(id)) return
    if (opts?.patientId) setPatientId(opts.patientId)
    setRecordRef(opts?.recordRef)
    setPage(id)
    window.history.replaceState(null, '', `#${id}`)
    window.scrollTo(0, 0)
  }

  const online = status?.status === 'ok'
  const ownPatient = user.role === 'patient' ? user.patientId! : patientId

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            <ShieldCheck size={20} />
          </span>
          <div>
            <div className="brand-name">ConsentLedger</div>
            <div className="brand-sub">Trusted consent. Verifiable access.</div>
          </div>
        </div>
        <nav aria-label="Main">
          {allowed.map((id, i) => (
            <div key={id}>
              {i === allowed.length - 1 && <div className="nav-label">Account</div>}
              <button className={`nav-item ${page === id ? 'active' : ''}`} onClick={() => go(id)} aria-current={page === id ? 'page' : undefined}>
                {PAGE_INFO[id].icon}
                {id === 'patients' && user.role !== 'patient' ? 'Patients and consent' : PAGE_INFO[id].label}
              </button>
            </div>
          ))}
        </nav>
        <div className="sidebar-foot">
          <ShieldCheck size={18} style={{ color: 'var(--green)', flexShrink: 0 }} aria-hidden="true" />
          <span>
            <strong style={{ color: 'var(--text)' }}>Patient data protected</strong>
            <br />
            Synthetic records only. Every decision is on a tamper-evident ledger.
          </span>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <SearchBox go={go} />
          <div className="topbar-right">
            <span className={`net-pill ${online ? '' : 'down'}`} title={status ? `Chaincode ${status.fabric.chaincode} via ${status.fabric.peer}` : undefined}>
              <span className="net-dot" aria-hidden="true" />
              {online ? `Ledger online · ${status.fabric.channel}${lastBlock ? ` · block ${lastBlock}` : ''}` : 'Ledger unavailable'}
            </span>
            <UserMenu go={go} />
          </div>
        </header>

        <main className="content">
          {error && (
            <div className="stack">
              <Notice message={{ kind: 'error', text: error }} />
              <div>
                <button onClick={refresh}>Try again</button>
              </div>
            </div>
          )}
          {loading && !dir && <p className="muted">Connecting to the ledger…</p>}
          {dir && page === 'overview' && <Overview go={go} />}
          {dir && page === 'patients' && <Patients patientId={ownPatient} setPatientId={setPatientId} />}
          {dir && page === 'requests' && (
            <Requests providerId={user.providerId!} patientId={patientId} setPatientId={setPatientId} initialRecord={recordRef} />
          )}
          {dir && page === 'records' && <Records />}
          {dir && page === 'audit' && <Audit />}
          {page === 'profile' && <Profile />}
        </main>

        <footer className="footer">
          <span>ConsentLedger · research prototype on Hyperledger Fabric</span>
          <span>Synthetic data only. No real patient information is stored.</span>
        </footer>
      </div>
    </div>
  )
}

function Gate() {
  const { user, checking } = useAuth()
  if (checking) return <p className="muted" style={{ padding: 32 }}>Loading…</p>
  if (!user) return <Login />
  // Keyed by account so switching accounts starts from a clean state.
  return (
    <LedgerProvider user={user} key={user.userId}>
      <Shell />
    </LedgerProvider>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <Gate />
    </AuthProvider>
  )
}
