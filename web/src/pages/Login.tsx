import { Eye, EyeOff, FileLock2, LogIn, ShieldCheck, UserCheck } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { useAuth } from '../auth'
import { Notice, ProviderIcon } from '../components'

// The seeded walkthrough accounts (chaincode/deployment/postgres_auth.sql).
// Usernames only: participants type the password from their task sheet.
const DEMO_ACCOUNTS = [
  { username: 'tunde.adeyemi', label: 'Tunde Adeyemi', role: 'Patient', type: 'patient' },
  { username: 'lab.b', label: 'Diagnostics Laboratory B', role: 'Laboratory', type: 'laboratory' },
  { username: 'hospital.a', label: 'General Hospital A', role: 'Hospital', type: 'hospital' },
  { username: 'regulator.e', label: 'Health Regulator E', role: 'Regulator', type: 'regulator' },
]

// A public deployment builds with VITE_HIDE_DEMO_ACCOUNTS=true, so the
// sign-in page does not advertise the walkthrough usernames.
const SHOW_DEMO_ACCOUNTS = import.meta.env.VITE_HIDE_DEMO_ACCOUNTS !== 'true'

export function Login() {
  const { signIn, lastUsername } = useAuth()
  const [username, setUsername] = useState(lastUsername)
  const [password, setPassword] = useState('')
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!username.trim() || !password) {
      setError('Enter your username and password.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await signIn(username.trim(), password)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(msg.charAt(0).toUpperCase() + msg.slice(1) + (msg.endsWith('.') ? '' : '.'))
      setPassword('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="login">
      <section className="login-brand">
        <div className="brand">
          <span className="brand-mark brand-mark-light" aria-hidden="true">
            <ShieldCheck size={20} />
          </span>
          <div>
            <div className="brand-name">ConsentLedger</div>
            <div className="brand-sub brand-sub-light">Trusted consent. Verifiable access.</div>
          </div>
        </div>
        <div className="login-pitch">
          <h1>Patient consent and access control for shared health records</h1>
          <p>
            Patients decide who may see their records. Every request and every access decision is written to a
            shared ledger that no single organisation can alter.
          </p>
        </div>
        <ul className="login-points">
          <li>
            <UserCheck size={18} aria-hidden="true" />
            Patient-controlled consent
          </li>
          <li>
            <FileLock2 size={18} aria-hidden="true" />
            Tamper-evident audit log
          </li>
          <li>
            <ShieldCheck size={18} aria-hidden="true" />
            Records stay with the hospital
          </li>
        </ul>
        <p className="login-foot">Research prototype on Hyperledger Fabric · synthetic data only</p>
      </section>

      <section className="login-panel">
        <form className="login-card" onSubmit={submit} noValidate>
          <h2>Sign in</h2>
          <p className="muted">Use the account you were given for the walkthrough.</p>

          <label className="field">
            Username
            <input
              className="text-input"
              autoComplete="username"
              autoFocus={!username}
              value={username}
              onChange={(e) => {
                setUsername(e.target.value)
                setError(null)
              }}
              placeholder={SHOW_DEMO_ACCOUNTS ? 'tunde.adeyemi' : 'Your username'}
            />
          </label>
          <label className="field">
            Password
            <span className="password-wrap">
              <input
                className="text-input"
                type={show ? 'text' : 'password'}
                autoComplete="current-password"
                autoFocus={!!username}
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value)
                  setError(null)
                }}
              />
              <button
                type="button"
                className="ghost small password-toggle"
                onClick={() => setShow(!show)}
                aria-label={show ? 'Hide password' : 'Show password'}
              >
                {show ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </span>
          </label>
          {error && <Notice message={{ kind: 'error', text: error }} />}
          <button type="submit" className="primary login-submit" disabled={busy}>
            <LogIn size={16} aria-hidden="true" />
            {busy ? 'Signing in…' : 'Sign in'}
          </button>

          {SHOW_DEMO_ACCOUNTS && (
          <div className="demo-accounts">
            <div className="section-label">Walkthrough accounts</div>
            <ul className="list">
              {DEMO_ACCOUNTS.map((a) => (
                <li key={a.username}>
                  <span className={`icon-tile tone-${a.type === 'patient' ? 'blue' : a.type === 'regulator' ? 'violet' : 'sky'}`} style={{ width: 32, height: 32 }}>
                    {a.type === 'patient' ? <UserCheck size={16} aria-hidden="true" /> : <ProviderIcon type={a.type} size={16} />}
                  </span>
                  <div className="list-main">
                    <div className="list-title">{a.label}</div>
                    <div className="list-sub">
                      {a.role} · <span className="mono">{a.username}</span>
                    </div>
                  </div>
                  <button type="button" className="small" onClick={() => setUsername(a.username)}>
                    Use
                  </button>
                </li>
              ))}
            </ul>
          </div>
          )}
        </form>
      </section>
    </div>
  )
}
