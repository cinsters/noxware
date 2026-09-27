const TOKEN_KEY = 'noxware.token'
const USER_KEY = 'noxware.user'

export type User = {
  id: number
  email: string
  username: string
  role?: 'customer' | 'support' | 'admin'
  banned?: boolean
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

/* ---------------- Customer support ---------------- */

export type TicketMessage = {
  id: number
  ticketId: number
  authorId: number | null
  authorRole: 'customer' | 'staff'
  body: string
  internal: boolean
  createdAt: string
}

export type Ticket = {
  id: number
  userId: number
  username?: string | null
  email?: string | null
  subject: string
  status: 'open' | 'pending' | 'closed'
  priority: 'low' | 'normal' | 'high'
  createdVia: 'web' | 'email'
  createdAt: string
  updatedAt: string
  messages?: TicketMessage[]
}

export function listMyTickets() {
  return api<{ tickets: Ticket[]; total: number }>('/api/support/tickets')
}

export function createTicket(subject: string, body: string) {
  return api<{ ticket: Ticket }>('/api/support/tickets', {
    method: 'POST',
    body: JSON.stringify({ subject, body }),
  })
}

export function getMyTicket(id: number) {
  return api<{ ticket: Ticket }>(`/api/support/tickets/${id}`)
}

export function replyTicket(id: number, body: string) {
  return api<{ message: TicketMessage }>(`/api/support/tickets/${id}/replies`, {
    method: 'POST',
    body: JSON.stringify({ body }),
  })
}

/* ---------------- Staff (support + admin) ---------------- */

export function listStaffTickets(status?: string) {
  const qs = status && status !== 'all' ? `?status=${encodeURIComponent(status)}` : ''
  return api<{ tickets: Ticket[]; total: number }>(`/api/support/staff/tickets${qs}`)
}

export function getStaffTicket(id: number) {
  return api<{ ticket: Ticket }>(`/api/support/staff/tickets/${id}`)
}

export function replyStaffTicket(id: number, body: string, internal = false, reopen = false) {
  return api<{ message: TicketMessage }>(`/api/support/staff/tickets/${id}/replies`, {
    method: 'POST',
    body: JSON.stringify({ body, internal, reopen }),
  })
}

export function updateStaffTicket(id: number, patch: { status?: string; priority?: string }) {
  return api<{ ticket: Ticket }>(`/api/support/staff/tickets/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  })
}

export function isStaff(user: User | null): boolean {
  return user?.role === 'support' || user?.role === 'admin'
}

export function isAdmin(user: User | null): boolean {
  return user?.role === 'admin'
}

/* ---------------- Admin only ---------------- */

export type AdminUser = {
  id: number
  email: string
  username: string
  role: 'customer' | 'support' | 'admin'
  banned: boolean
  banReason: string | null
  bannedAt: string | null
  createdAt: string
  subscription: { planId: string; expiresAt: string; active: boolean } | null
  ticketCount: number
  inviteCode: string | null
}

export function listUsers(search = '') {
  const qs = search ? `?search=${encodeURIComponent(search)}` : ''
  return api<{ users: AdminUser[]; total: number }>(`/api/admin/users${qs}`)
}

export function patchUser(
  id: number,
  patch: { role?: string; ban?: boolean; banReason?: string },
) {
  return api<{ user: User }>(`/api/admin/users/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  })
}

export function grantUser(id: number, grant: { days?: number; lifetime?: boolean }) {
  return api<{ subscription: { planId: string; expiresAt: string; lifetime?: boolean } }>(
    `/api/admin/users/${id}/grant`,
    { method: 'POST', body: JSON.stringify(grant) },
  )
}

export function revokeUserInvites(id: number) {
  return api<{ ok: boolean; revoked: string[] }>(`/api/admin/users/${id}/revoke-invites`, {
    method: 'POST',
  })
}

export function generateKeys(count: number, planId: string) {
  return api<{ keys: string[] }>('/api/admin/license-keys', {
    method: 'POST',
    body: JSON.stringify({ count, planId }),
  })
}

export type AuditEntry = {
  id: number
  actor: { id: number; username: string; email: string } | null
  action: string
  targetType: string | null
  targetId: number | null
  details: Record<string, unknown> | null
  createdAt: string
}

export function fetchAuditLog() {
  return api<{ entries: AuditEntry[]; total: number }>('/api/admin/audit-log')
}

/* ---------------- Invites ---------------- */

export type Invite = {
  id: number
  code: string
  maxUses: number
  uses: number
  signups: number
  note: string | null
  expiresAt: string | null
  expired: boolean
  exhausted: boolean
  createdAt: string
}

export function listInvites() {
  return api<{ invites: Invite[] }>('/api/admin/invites')
}

export function createInvite(input: {
  code: string
  maxUses?: number
  expiresInDays?: number | null
  note?: string | null
}) {
  return api<{ invite: Invite }>('/api/admin/invites', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function revokeInvite(id: number) {
  return api<{ ok: boolean }>(`/api/admin/invites/${id}`, { method: 'DELETE' })
}
