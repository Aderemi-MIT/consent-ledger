import { KeyRound, LogOut, Repeat, Save, UserCog } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { api } from '../api'
import { roleLabel, useAuth, useUser } from '../auth'
import { Avatar, Card, Notice, Pill, type Message } from '../components'

export function Profile() {
  const user = useUser()
  const { setUser, signOut } = useAuth()

  const [name, setName] = useState(user.displayName)
  const [email, setEmail] = useState(user.email)
  const [phone, setPhone] = useState(user.phone)
  const [savingProfile, setSavingProfile] = useState(false)
  const [profileMsg, setProfileMsg] = useState<Message | null>(null)

  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [savingPassword, setSavingPassword] = useState(false)
  const [passwordMsg, setPasswordMsg] = useState<Message | null>(null)

  const cap = (m: string) => m.charAt(0).toUpperCase() + m.slice(1) + (m.endsWith('.') ? '' : '.')

  async function saveProfile(e: FormEvent) {
    e.preventDefault()
    if (!name.trim()) {
      setProfileMsg({ kind: 'error', text: 'Enter your name.' })
      return
    }
    setSavingProfile(true)
    setProfileMsg(null)
    try {
      const res = await api.updateProfile(name.trim(), email.trim(), phone.trim())
      setUser(res.data)
      setProfileMsg({ kind: 'ok', text: 'Profile saved.' })
    } catch (err) {
      setProfileMsg({ kind: 'error', text: cap(err instanceof Error ? err.message : String(err)) })
    } finally {
      setSavingProfile(false)
    }
  }

  async function savePassword(e: FormEvent) {
    e.preventDefault()
    if (!current || !next) {
      setPasswordMsg({ kind: 'error', text: 'Enter your current and new password.' })
      return
    }
    if (next.length < 8) {
      setPasswordMsg({ kind: 'error', text: 'Choose a new password of at least 8 characters.' })
      return
    }
    if (next !== confirm) {
      setPasswordMsg({ kind: 'error', text: 'The new passwords don’t match.' })
      return
    }
    setSavingPassword(true)
    setPasswordMsg(null)
    try {
      await api.changePassword(current, next)
      setCurrent('')
      setNext('')
      setConfirm('')
      setPasswordMsg({ kind: 'ok', text: 'Password changed. Your other sessions have been signed out.' })
    } catch (err) {
      setPasswordMsg({ kind: 'error', text: cap(err instanceof Error ? err.message : String(err)) })
    } finally {
      setSavingPassword(false)
    }
  }

  const actsFor = user.role === 'patient' ? user.patientId : user.organization

  return (
    <>
      <section className="hero">
        <div className="profile-head" style={{ marginBottom: 0 }}>
          <Avatar name={user.displayName} id={user.userId} size={64} />
          <div>
            <div className="hero-kicker">Profile settings</div>
            <h1 style={{ margin: '2px 0 4px' }}>{user.displayName}</h1>
            <div className="row" style={{ gap: 8 }}>
              <Pill tone="blue">{roleLabel(user)}</Pill>
              <span className="small muted">
                Signed in as <span className="mono">{user.username}</span>
                {actsFor ? ` · acts for ${actsFor}` : ''}
              </span>
            </div>
          </div>
        </div>
      </section>

      <div className="grid grid-2">
        <Card title="Personal details" icon={<UserCog size={18} />} sub="How you appear in the app">
          <form className="stack" onSubmit={saveProfile} noValidate>
            <label className="field">
              Display name
              <input className="text-input" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
            </label>
            <label className="field">
              Email
              <input className="text-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.test" />
            </label>
            <label className="field">
              Phone
              <input className="text-input" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+234 800 000 0000" />
            </label>
            <label className="field">
              Username
              <input className="text-input" value={user.username} disabled />
            </label>
            <Notice message={profileMsg} />
            <div>
              <button type="submit" className="primary" disabled={savingProfile}>
                <Save size={16} aria-hidden="true" />
                {savingProfile ? 'Saving…' : 'Save changes'}
              </button>
            </div>
          </form>
        </Card>

        <div className="stack">
          <Card title="Change password" icon={<KeyRound size={18} />} sub="At least 8 characters">
            <form className="stack" onSubmit={savePassword} noValidate>
              <label className="field">
                Current password
                <input className="text-input" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
              </label>
              <label className="field">
                New password
                <input className="text-input" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
              </label>
              <label className="field">
                Confirm new password
                <input className="text-input" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
              </label>
              <Notice message={passwordMsg} />
              <div>
                <button type="submit" disabled={savingPassword}>
                  <KeyRound size={16} aria-hidden="true" />
                  {savingPassword ? 'Changing…' : 'Change password'}
                </button>
              </div>
            </form>
          </Card>

          <Card title="Session" icon={<LogOut size={18} />}>
            <p className="small muted" style={{ marginBottom: 12 }}>
              Sign out when you’re finished. During the walkthrough, use “Switch account” to sign in as the next role.
            </p>
            <div className="row">
              <button onClick={signOut}>
                <Repeat size={16} aria-hidden="true" />
                Switch account
              </button>
              <button className="danger" onClick={signOut}>
                <LogOut size={16} aria-hidden="true" />
                Sign out
              </button>
            </div>
          </Card>
        </div>
      </div>
    </>
  )
}
