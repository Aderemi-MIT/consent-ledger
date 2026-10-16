/* eslint-disable react-refresh/only-export-components -- the provider, hook and role helpers belong together */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { api, SIGNED_OUT_EVENT, type User } from './api'

export type PageId = 'overview' | 'patients' | 'requests' | 'records' | 'audit' | 'profile'

/** Navigates to a page, optionally preselecting a patient or record. */
export type Nav = (page: PageId, opts?: { patientId?: string; recordRef?: string }) => void

/** Pages each kind of account can open, in sidebar order. */
export function pagesFor(user: User): PageId[] {
  if (user.role === 'patient') return ['overview', 'patients', 'profile']
  if (user.role === 'regulator') return ['overview', 'audit', 'records', 'profile']
  if (user.providerType === 'hospital') return ['overview', 'records', 'requests', 'profile']
  return ['overview', 'requests', 'profile']
}

/** Plain-language description of the account's role. */
export function roleLabel(user: User): string {
  if (user.role === 'patient') return 'Patient'
  if (user.role === 'regulator') return 'Regulator / auditor'
  return (
    { hospital: 'Hospital', laboratory: 'Laboratory', pharmacy: 'Pharmacy', insurer: 'Insurer' }[user.providerType ?? ''] ??
    'Provider'
  )
}

type Auth = {
  user: User | null
  checking: boolean
  /** Username to prefill on the sign-in page, e.g. after "switch account". */
  lastUsername: string
  signIn: (username: string, password: string) => Promise<void>
  signOut: () => Promise<void>
  setUser: (u: User) => void
}

const AuthContext = createContext<Auth | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [checking, setChecking] = useState(true)
  const [lastUsername, setLastUsername] = useState('')

  useEffect(() => {
    api
      .me()
      .then((r) => setUser(r.data))
      .catch(() => setUser(null))
      .finally(() => setChecking(false))
    const onSignedOut = () => setUser(null)
    window.addEventListener(SIGNED_OUT_EVENT, onSignedOut)
    return () => window.removeEventListener(SIGNED_OUT_EVENT, onSignedOut)
  }, [])

  const signIn = useCallback(async (username: string, password: string) => {
    const res = await api.login(username, password)
    setLastUsername(res.data.username)
    try {
      // A new account starts from its own overview, not the last user's page.
      sessionStorage.clear()
    } catch {
      // Storage unavailable: nothing to clear.
    }
    window.history.replaceState(null, '', '#overview')
    setUser(res.data)
  }, [])

  const signOut = useCallback(async () => {
    await api.logout().catch(() => undefined)
    setUser(null)
  }, [])

  const value = useMemo(
    () => ({ user, checking, lastUsername, signIn, signOut, setUser }),
    [user, checking, lastUsername, signIn, signOut],
  )
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): Auth {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}

/** The signed-in account; only call inside pages shown after sign-in. */
export function useUser(): User {
  const { user } = useAuth()
  if (!user) throw new Error('useUser called while signed out')
  return user
}
