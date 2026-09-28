import crypto from 'node:crypto'
import { getDb } from '../db.js'
import { signLauncherToken } from '../middleware/auth.js'

export const LAUNCHER_CLIENT_ID = 'nox-launcher'
export const AUTH_CODE_TTL_MS = 120 * 1000
export const ACCESS_TOKEN_TTL_S = 3600
const REFRESH_TTL_DAYS = 30
const AUTHZ_LIMIT_PER_MIN = 5
const TOKEN_LIMIT_PER_MIN = 10

const LOOPBACK_RE = /^http:\/\/127\.0\.0\.1:(\d{1,5})\/callback$/
const VERIFIER_RE = /^[A-Za-z0-9\-._~]{43,128}$/

export function launcherError(status, code, message, extra = {}) {
  const err = new Error(message)
  err.status = status
  err.code = code
  Object.assign(err, extra)
  return err
}

function sha256b64url(value) {
  return crypto.createHash('sha256').update(value).digest('base64url')
}

function randomB64url(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url')
}

function nowIso() {
  return new Date().toISOString()
}

const oauthLim = new Map()
function hitLimit(key, max) {
  const now = Date.now()
  const entry = oauthLim.get(key)
  if (entry && now < entry.resetAt) return entry.count < max
  if (oauthLim.size > 5000) sweepLimits()
  oauthLim.set(key, { count: 1, resetAt: now + 60_000 })
  return true
}
function sweepLimits() {
  const now = Date.now()
  for (const [key, entry] of oauthLim) {
    if (now >= entry.resetAt) oauthLim.delete(key)
  }
}

export function validateRedirectUri(redirectUri) {
  return typeof redirectUri === 'string' && LOOPBACK_RE.test(redirectUri)
}

export function assertAuthorizeParams({ clientId, redirectUri, scope, state }) {
  if (clientId !== LAUNCHER_CLIENT_ID) {
    throw launcherError(400, 'CLIENT_ID_INVALID', 'Unknown client_id — expected nox-launcher')
  }
  if (!validateRedirectUri(redirectUri)) {
    throw launcherError(400, 'REDIRECT_URI_INVALID', 'redirect_uri must be http://127.0.0.1:<port>/callback')
  }
  if ((scope || 'launch') !== 'launch') {
    throw launcherError(400, 'SCOPE_INVALID', 'scope must be "launch"')
  }
  if (typeof state !== 'string' || state.length < 8 || state.length > 512) {
    throw launcherError(400, 'STATE_INVALID', 'state must be 8-512 characters')
  }
}

/** Browser-side (website JWT) mints a single-use auth code bound to the PKCE challenge. */
export function createAuthCode(userId, { clientId, redirectUri, challenge, sessionHint }) {
  const db = getDb()
  if (!hitLimit(`authz:${userId}`, AUTHZ_LIMIT_PER_MIN)) {
    throw launcherError(429, 'RATE_LIMITED', 'Too many authorize attempts — retry in a minute')
  }
  const code = randomB64url(32)
  db.prepare(
    `INSERT INTO launcher_auth_codes (code_hash, user_id, client_id, challenge, redirect_uri, session_hint, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    sha256b64url(code),
    userId,
    clientId,
    challenge,
    redirectUri,
    sessionHint ?? null,
    new Date(Date.now() + AUTH_CODE_TTL_MS).toISOString(),
  )
  return code
}

/** Build the redirect URL for approve/deny outcomes. */
export function buildRedirect(redirectUri, params) {
  const url = new URL(redirectUri)
  for (const [key, value] of Object.entries(params)) {
    if (value != null) url.searchParams.set(key, String(value))
  }
  return url.toString()
}

function consumeAuthCode(rawCode) {
  const db = getDb()
  const row = db
    .prepare('SELECT * FROM launcher_auth_codes WHERE code_hash = ?')
    .get(sha256b64url(rawCode))
  if (!row) return null

  if (row.consumed_at) {
    // Reuse of an already-consumed code is treated as theft: kill the whole family.
    if (row.session_hint) {
      db.prepare('UPDATE launcher_sessions SET revoked_at = ? WHERE refresh_family = ? AND revoked_at IS NULL').run(
        nowIso(),
        row.session_hint,
      )
    }
    db.prepare('DELETE FROM launcher_auth_codes WHERE expires_at < ?').run(nowIso())
    return { replayed: true, row }
  }

  const result = db
    .prepare('UPDATE launcher_auth_codes SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL')
    .run(nowIso(), row.id)
  if (result.changes === 0) return null // lost race between SELECT and UPDATE

  db.prepare('DELETE FROM launcher_auth_codes WHERE expires_at < ?').run(nowIso())
  return { replayed: false, row }
}

function createSession(userId, { deviceLabel = null, platform = 'windows' }) {
  const db = getDb()
  const family = `lsf_${randomB64url(12)}`
  const refresh = `nxr_${randomB64url(32)}`
  const now = nowIso()
  const expiresAt = new Date(Date.now() + REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString()

  db.prepare(
    `INSERT INTO launcher_sessions
       (user_id, refresh_hash, refresh_family, previous_hash, device_label, platform, created_at, last_seen_at, revoked_at, expires_at)
     VALUES (?, ?, ?, NULL, ?, ?, ?, ?, NULL, ?)`,
  ).run(userId, sha256b64url(refresh), family, deviceLabel, platform, now, now, expiresAt)

  return { refresh, family }
}

function issueTokensForSession(userId, session, deviceLabel, platform) {
  const user = getDb()
    .prepare('SELECT id, username, role FROM users WHERE id = ?')
    .get(userId)
  return {
    access_token: signLauncherToken({ id: user.id, username: user.username }),
    refresh_token: session.refresh,
    token_type: 'Bearer',
    expires_in: ACCESS_TOKEN_TTL_S,
    user: { id: user.id, username: user.username, role: user.role || 'customer' },
    ...(deviceLabel !== undefined ? { session: { id: session.id ?? null, deviceLabel, platform } } : {}),
  }
}

function grantAuthorizationCode(body, ip) {
  const { code, code_verifier: verifier, redirect_uri: redirectUri, client_id: clientId } = body || {}
  if (!hitLimit(`token:${ip}`, TOKEN_LIMIT_PER_MIN)) {
    throw launcherError(429, 'RATE_LIMITED', 'Too many token requests — retry in a minute')
  }
  if (clientId !== LAUNCHER_CLIENT_ID) {
    throw launcherError(400, 'CLIENT_ID_INVALID', 'Unknown client_id')
  }
  if (!validateRedirectUri(redirectUri)) {
    throw launcherError(400, 'REDIRECT_URI_INVALID', 'redirect_uri must be http://127.0.0.1:<port>/callback')
  }
  if (typeof code !== 'string' || code.length === 0) {
    throw launcherError(400, 'CODE_INVALID', 'code is required')
  }
  if (typeof verifier !== 'string' || !VERIFIER_RE.test(verifier)) {
    throw launcherError(400, 'VERIFIER_INVALID', 'code_verifier must be 43-128 chars of [A-Za-z0-9-._~]')
  }

  const consumed = consumeAuthCode(code)
  if (!consumed) {
    throw launcherError(400, 'CODE_INVALID', 'Authorization code is invalid or expired')
  }
  if (consumed.replayed) {
    throw launcherError(400, 'CODE_REUSED', 'Authorization code was already used — session revoked')
  }

  const row = consumed.row
  if (row.client_id !== clientId || row.redirect_uri !== redirectUri) {
    throw launcherError(400, 'CODE_INVALID', 'Authorization code binding mismatch')
  }
  const expected = Buffer.from(row.challenge, 'base64url')
  const actual = crypto.createHash('sha256').update(verifier).digest()
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
    throw launcherError(400, 'PKCE_FAILED', 'code_verifier does not match code_challenge')
  }

  if (new Date(row.expires_at).getTime() <= Date.now()) {
    throw launcherError(400, 'CODE_EXPIRED', 'Authorization code expired (120s TTL)')
  }

  const banned = getDb().prepare('SELECT banned_at FROM users WHERE id = ?').get(row.user_id)
  if (banned?.banned_at) {
    throw launcherError(403, 'ACCOUNT_BANNED', 'Account banned')
  }

  const { refresh, family } = createSession(row.user_id, {})
  const sessionRow = getDb()
    .prepare('SELECT id, device_label, platform FROM launcher_sessions WHERE refresh_family = ?')
    .get(family)
  return issueTokensForSession(row.user_id, { id: sessionRow.id, refresh }, sessionRow.device_label, sessionRow.platform)
}

function grantRefreshToken(body, ip) {
  const presented = body?.refresh_token
  if (!hitLimit(`token:${ip}`, TOKEN_LIMIT_PER_MIN)) {
    throw launcherError(429, 'RATE_LIMITED', 'Too many token requests — retry in a minute')
  }
  if (typeof presented !== 'string' || presented.length < 20) {
    throw launcherError(400, 'REFRESH_INVALID', 'refresh_token is required')
  }

  const db = getDb()
  const hash = sha256b64url(presented)
  const current = db
    .prepare('SELECT * FROM launcher_sessions WHERE refresh_hash = ?')
    .get(hash)
  if (current && current.revoked_at) {
    throw launcherError(401, 'SESSION_REVOKED', 'Session revoked')
  }
  if (!current) {
    const prior = db
      .prepare('SELECT id, refresh_family, user_id, revoked_at FROM launcher_sessions WHERE previous_hash = ?')
      .get(hash)
    if (prior) {
      // Presenting a rotated refresh token = theft: revoke the whole family.
      db.prepare('UPDATE launcher_sessions SET revoked_at = ? WHERE refresh_family = ? AND revoked_at IS NULL').run(
        nowIso(),
        prior.refresh_family,
      )
      return { stolen: true }
    }
    throw launcherError(401, 'SESSION_REVOKED', 'Session revoked or expired')
  }
  if (current.expires_at && new Date(current.expires_at).getTime() <= Date.now()) {
    db.prepare('UPDATE launcher_sessions SET revoked_at = ? WHERE id = ?').run(nowIso(), current.id)
    throw launcherError(401, 'SESSION_REVOKED', 'Session expired — sign in again')
  }

  const nextRefresh = `nxr_${randomB64url(32)}`
  const now = nowIso()
  db.prepare(
    'UPDATE launcher_sessions SET refresh_hash = ?, previous_hash = ?, rotated_at = ?, last_seen_at = ? WHERE id = ?',
  ).run(sha256b64url(nextRefresh), hash, now, now, current.id)

  return issueTokensForSession(current.user_id, { id: current.id, refresh: nextRefresh }, current.device_label, current.platform)
}

export function tokenRequest(body, ip) {
  if (body?.grant_type === 'authorization_code') return grantAuthorizationCode(body, ip)
  if (body?.grant_type === 'refresh_token') return grantRefreshToken(body, ip)
  throw launcherError(400, 'GRANT_INVALID', 'grant_type must be authorization_code or refresh_token')
}

export function listSessions(userId) {
  const rows = getDb()
    .prepare('SELECT * FROM launcher_sessions WHERE user_id = ? ORDER BY created_at DESC')
    .all(userId)
  return rows.map((row) => ({
    id: `ls_${row.id}`,
    deviceLabel: row.device_label || null,
    platform: row.platform,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
    revoked: Boolean(row.revoked_at),
  }))
}

export function findSessionForUser(userId, sessionId) {
  const row = getDb()
    .prepare('SELECT * FROM launcher_sessions WHERE user_id = ? AND id = ?')
    .get(userId, sessionId)
  return row || null
}

export function revokeSession(userId, sessionId) {
  const result = getDb()
    .prepare('UPDATE launcher_sessions SET revoked_at = ? WHERE user_id = ? AND id = ? AND revoked_at IS NULL')
    .run(nowIso(), userId, sessionId)
  return result.changes > 0
}

export function revokeAllSessions(userId, { exceptSessionId = null } = {}) {
  if (exceptSessionId) {
    const result = getDb()
      .prepare(
        'UPDATE launcher_sessions SET revoked_at = ? WHERE user_id = ? AND id != ? AND revoked_at IS NULL',
      )
      .run(nowIso(), userId, exceptSessionId)
    return result.changes
  }
  const result = getDb()
    .prepare('UPDATE launcher_sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL')
    .run(nowIso(), userId)
  return result.changes
}
