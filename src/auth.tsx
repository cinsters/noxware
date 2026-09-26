import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import {
  clearSession,
  fetchMe,
  getToken,
  login as apiLogin,
  readStoredUser,
  register as apiRegister,
  setSession,
  type Subscription,
  type User,
} from './api'

type RegisterInput = {
  username: string
  email: string
  password: string
  inviteCode: string
  acceptedTerms: boolean
  captchaToken?: string
  captchaId?: string
  captchaAnswer?: string
}

type AuthContextValue = {
  user: User | null
  subscription: Subscription | null
  latestLicenseKey: { code: string; planId: string; createdAt: string } | null
  loading: boolean
  login: (email: string, password: string) => Promise<void>
  register: (input: RegisterInput) => Promise<void>
  logout: () => void
  refresh: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

const emptySub: Subscription = { active: false, planId: null, expiresAt: null }

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(() => readStoredUser())
  const [subscription, setSubscription] = useState<Subscription | null>(null)
  const [latestLicenseKey, setLatestLicenseKey] = useState<{
    code: string
    planId: string
    createdAt: string
  } | null>(null)
  const [loading, setLoading] = useState(Boolean(getToken()))

  const applyMe = useCallback(async () => {
    const me = await fetchMe()
    setSession(getToken()!, me.user)
    setUser(me.user)
    setSubscription(me.subscription)
    setLatestLicenseKey(me.latestLicenseKey)
  }, [])

  const refresh = useCallback(async () => {
    if (!getToken()) {
      setUser(null)
      setSubscription(null)
      setLatestLicenseKey(null)
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      await applyMe()
    } catch {
      clearSession()
      setUser(null)
      setSubscription(null)
      setLatestLicenseKey(null)
    } finally {
      setLoading(false)
    }
  }, [applyMe])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      subscription: subscription ?? (user ? emptySub : null),
      latestLicenseKey,
      loading,
      login: async (email, password) => {
        const result = await apiLogin({ email, password })
        setSession(result.token, result.user)
        setUser(result.user)
        setSubscription(result.subscription)
        await applyMe()
      },
      register: async (input) => {
        const result = await apiRegister(input)
        setSession(result.token, result.user)
        setUser(result.user)
        setSubscription(result.subscription)
        await applyMe()
      },
      logout: () => {
        clearSession()
        setUser(null)
        setSubscription(null)
        setLatestLicenseKey(null)
      },
      refresh,
    }),
    [user, subscription, latestLicenseKey, loading, applyMe, refresh],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
