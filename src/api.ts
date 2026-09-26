const TOKEN_KEY = 'noxware.token'
const USER_KEY = 'noxware.user'

export type User = {
  id: number
  email: string
  username: string
  createdAt?: string
}

export type Subscription = {
  active: boolean
  planId: string | null
  expiresAt: string | null
  updatedAt?: string | null
}

export type MeResponse = {
  user: User
  subscription: Subscription
  latestLicenseKey: { code: string; planId: string; createdAt: string } | null
}

type ApiError = { error?: string }

async function parseJson<T>(res: Response): Promise<T> {
  const data = (await res.json().catch(() => ({}))) as T & ApiError
  if (!res.ok) {
    throw new Error(data.error || `Request failed (${res.status})`)
  }
  return data
}

export function getToken() {
  return localStorage.getItem(TOKEN_KEY)
}

export function setSession(token: string, user: User) {
  localStorage.setItem(TOKEN_KEY, token)
  localStorage.setItem(USER_KEY, JSON.stringify(user))
}

export function clearSession() {
  localStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem(USER_KEY)
}

export function readStoredUser(): User | null {
  try {
    const raw = localStorage.getItem(USER_KEY)
    return raw ? (JSON.parse(raw) as User) : null
  } catch {
    return null
  }
}

async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers || {})
  if (options.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }
  const token = getToken()
  if (token) headers.set('Authorization', `Bearer ${token}`)

  const res = await fetch(path, { ...options, headers })
  return parseJson<T>(res)
}

export function register(input: {
  username: string
  email: string
  password: string
  inviteCode: string
  acceptedTerms: boolean
  captchaToken?: string
  captchaId?: string
  captchaAnswer?: string
}) {
  return api<{ token: string; user: User; subscription: Subscription }>('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export type AuthConfig = {
  captchaMode: 'local' | 'turnstile'
  turnstileSiteKey: string | null
}

export type LocalCaptcha = {
  id: string
  question: string
  mode: 'local'
}

export function fetchAuthConfig() {
  return api<AuthConfig>('/api/auth/config')
}

export function fetchLocalCaptcha() {
  return api<LocalCaptcha>('/api/auth/captcha')
}

export function login(input: { email: string; password: string }) {
  return api<{ token: string; user: User; subscription: Subscription }>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function fetchMe() {
  return api<MeResponse>('/api/me')
}

export function createCheckoutSession(planId: string) {
  return api<{ url: string; orderId: number; invoiceId: string }>('/api/checkout/session', {
    method: 'POST',
    body: JSON.stringify({ planId }),
  })
}

export function confirmCheckout(orderId: number) {
  return api<{
    ok: boolean
    alreadyProcessed?: boolean
    licenseKey: string | null
    subscription: Subscription
  }>('/api/checkout/confirm', {
    method: 'POST',
    body: JSON.stringify({ orderId }),
  })
}

export function redeemKey(code: string) {
  return api<{ message: string; planId?: string; subscription: Subscription }>('/api/redeem', {
    method: 'POST',
    body: JSON.stringify({ code }),
  })
}
