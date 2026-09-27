import { Router } from 'express'
import { getDb } from '../db.js'
import { audit, getSubscription, requireAuth } from '../middleware/auth.js'
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

export const launcherRouter = Router()

// ---- Devices -------------------------------------------------------------

launcherRouter.get('/devices', requireAuth, (req, res) => {
  res.json({
    devices: listDevices(req.user.id),
    limit: DEFAULT_DEVICE_LIMIT,
    resetCooldownDays: DEVICE_RESET_COOLDOWN_DAYS,
    nextResetAllowedAt: cooldownEndsAt(req.user.id),
  })
})

launcherRouter.post('/devices', requireAuth, (req, res) => {
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
    audit(req.user.id, 'devices.self_reset', 'user', req.user.id, { cleared: result.cleared })
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

launcherRouter.post('/launch-check', requireAuth, (req, res) => {
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

// Error middleware so thrown deviceError becomes a clean JSON body with `code`.
launcherRouter.use((err, _req, res, _next) => {
  const status = err.status || 500
  if (status >= 500) console.error(err)
  res.status(status).json({ error: err.message, code: err.code || 'ERROR' })
})
