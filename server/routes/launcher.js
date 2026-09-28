import { Router } from 'express'
import { getDb } from '../db.js'
import { audit, getSubscription, requireAnyAuth, requireAuth, requireLauncherAuth } from '../middleware/auth.js'
import { getActiveBuild, buildDownloadUrl } from '../services/builds.js'
import {
  DEFAULT_DEVICE_LIMIT,
  DEVICE_RESET_COOLDOWN_DAYS,
  cooldownEndsAt,
  deviceError,
  findDeviceByHwid,
  listDevices,
  registerDevice,
  resetDevices,
} from '../services/devices.js'
import {
  LAUNCHER_CLIENT_ID,
  ACCESS_TOKEN_TTL_S,
  assertAuthorizeParams,
  buildRedirect,
  createAuthCode,
  findSessionForUser,
  launcherError,
  listSessions,
  revokeAllSessions,
  revokeSession,
  tokenRequest,
  validateRedirectUri,
} from '../services/launcher-auth.js'

export const launcherRouter = Router()

// ---- PKCE browser sign-in --------------------------------------------------

// Called by the consent page with the WEBSITE token after the user approves.
launcherRouter.post('/authorize', requireAuth, (req, res) => {
  const { clientId, redirectUri, codeChallenge, scope, state, sessionHint } = req.body || {}
  assertAuthorizeParams({ clientId, redirectUri, scope, state })

  if (typeof codeChallenge !== 'string' || !/^[A-Za-z0-9_-]{43,128}$/.test(codeChallenge)) {
    throw launcherError(400, 'CHALLENGE_INVALID', 'codeChallenge must be base64url(SHA256(verifier))')
  }

  const code = createAuthCode(req.user.id, {
    clientId,
    redirectUri,
    challenge: codeChallenge,
    sessionHint: typeof sessionHint === 'string' ? sessionHint : null,
  })

  audit(req.user.id, 'launcher.authorize', 'user', req.user.id, { clientId, redirectUri })
  res.json({ code, redirect: buildRedirect(redirectUri, { code, state }), expiresIn: 120 })
})

launcherRouter.post('/token', (req, res) => {
  const ip = req.ip || 'unknown'
  const result = tokenRequest(req.body, ip)
  if (result?.stolen) {
    res.status(401).json({ error: 'Session revoked', code: 'SESSION_REVOKED' })
    return
  }
  res.json(result)
})

// ---- Sessions ---------------------------------------------------------------

launcherRouter.get('/sessions', requireLauncherAuth, (req, res) => {
  res.json({ sessions: listSessions(req.user.id) })
})

launcherRouter.post('/sessions/current/revoke', requireLauncherAuth, (req, res) => {
  const sessionId = typeof req.body?.sessionId === 'string' ? Number(req.body.sessionId.replace(/^ls_/, '')) : null
  if (!sessionId || !findSessionForUser(req.user.id, sessionId)) {
    throw launcherError(404, 'SESSION_NOT_FOUND', 'Session not found for this account')
  }
  revokeSession(req.user.id, sessionId)
  audit(req.user.id, 'launcher.session_revoke', 'user', req.user.id, { sessionId })
  res.json({ ok: true })
})

launcherRouter.post('/sessions/revoke-all', requireLauncherAuth, (req, res) => {
  const exceptId = typeof req.body?.exceptSessionId === 'string'
    ? Number(req.body.exceptSessionId.replace(/^ls_/, ''))
    : null
  const revoked = revokeAllSessions(req.user.id, { exceptSessionId: exceptId })
  audit(req.user.id, 'launcher.sessions_revoke_all', 'user', req.user.id, { revoked })
  res.json({ ok: true, revoked })
})

// ---- Devices -------------------------------------------------------------

launcherRouter.get('/devices', requireAnyAuth, (req, res) => {
  res.json({
    devices: listDevices(req.user.id),
    limit: DEFAULT_DEVICE_LIMIT,
    resetCooldownDays: DEVICE_RESET_COOLDOWN_DAYS,
    nextResetAllowedAt: cooldownEndsAt(req.user.id),
  })
})

launcherRouter.post('/devices', requireAnyAuth, (req, res) => {
  const { hwid, deviceLabel, platform } = req.body || {}
  try {
    const result = registerDevice(req.user.id, { hwid, deviceLabel, platform })
    res.json({
      existing: result.existing,
      deviceId: result.devices[0]?.id ?? null,
      limit: result.limit,
      devices: result.devices,
    })
  } catch (err) {
    const status = err.status || 500
    const body = { error: err.message, code: err.code || 'ERROR' }
    if (err.devices) body.devices = err.devices
    res.status(status).json(body)
  }
})

launcherRouter.post('/devices/reset', requireAuth, (req, res) => {
  try {
    const result = resetDevices(req.user.id, { force: false })
    // A device reset also kills every launcher session for the account.
    const sessions = revokeAllSessions(req.user.id)
    audit(req.user.id, 'devices.self_reset', 'user', req.user.id, { cleared: result.cleared, sessions })
    res.json(result)
  } catch (err) {
    res.status(err.status || 500).json({
      error: err.message,
      code: err.code || 'ERROR',
      nextAllowedAt: err.nextAllowedAt || null,
    })
  }
})

// ---- Launch eligibility ---------------------------------------------------

launcherRouter.post('/launch-check', requireAnyAuth, (req, res) => {
  const hwid = req.body?.hwid

  if (req.user.banned_at) {
    throw deviceError(403, 'ACCOUNT_BANNED', 'Account banned')
  }
  if (!getSubscription(req.user.id).active) {
    throw deviceError(403, 'SUB_INACTIVE', 'No active subscription — buy a plan or redeem a key')
  }

  const platform = ['windows', 'linux'].includes(req.body?.platform) ? req.body.platform : 'windows'
  const build = getActiveBuild(platform)
  if (!build) {
    throw deviceError(404, 'BUILD_MISSING', `No ${platform} build is currently available`)
  }

  const device = hwid ? findDeviceByHwid(req.user.id, hwid) : null
  if (hwid && !device) {
    const count = getDb().prepare('SELECT COUNT(*) AS c FROM launcher_devices WHERE user_id = ?').get(req.user.id).c
    const limit = DEFAULT_DEVICE_LIMIT
    const code = count >= limit ? 'DEVICE_LIMIT' : 'DEVICE_UNREGISTERED'
    throw deviceError(409, code, code === 'DEVICE_LIMIT' ? `Device limit reached (${limit})` : 'Device not registered — call POST /api/launcher/devices first', { devices: listDevices(req.user.id) })
  }

  if (device) {
    getDb().prepare('UPDATE launcher_devices SET last_seen_at = ? WHERE id = ?').run(new Date().toISOString(), device.id)
  }

  const { url, urlExpiresIn } = buildDownloadUrl(build)
  res.json({
    allowed: true,
    user: {
      id: req.user.id,
      username: req.user.username,
      planId: getSubscription(req.user.id).planId,
      expiresAt: getSubscription(req.user.id).expiresAt,
    },
    device: device ? { id: `ld_${device.id}`, label: device.device_label } : null,
    build: {
      platform,
      version: build.version,
      sha256: build.sha256,
      sizeBytes: build.size_bytes,
      url,
      urlExpiresIn,
    },
  })
})

// Error middleware so thrown deviceError/launcherError become clean JSON bodies with `code`.
launcherRouter.use((err, _req, res, _next) => {
  const status = err.status || 500
  if (status >= 500) console.error(err)
  res.status(status).json({ error: err.message, code: err.code || 'ERROR' })
})

export { LAUNCHER_CLIENT_ID, ACCESS_TOKEN_TTL_S, validateRedirectUri }
