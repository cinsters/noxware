import crypto from 'node:crypto'
import { getDb } from '../db.js'

export const DEFAULT_DEVICE_LIMIT = Number(process.env.DEVICE_LIMIT_PER_USER || 2)
export const DEVICE_RESET_COOLDOWN_DAYS = 7
const HWID_RE = /^[A-Za-z0-9_-]{16,128}$/

export function deviceError(status, code, message, extra = {}) {
  const err = new Error(message)
  err.status = status
  err.code = code
  Object.assign(err, extra)
  return err
}

/** Server-side pepper so a stolen DB cannot be brute-forced back to raw HWIDs. */
function hwidPepper() {
  return process.env.HWID_SALT || `nox-hwid:${process.env.JWT_SECRET || 'dev-only-change-me'}`
}

export function hashHwid(hwid) {
  return crypto.createHmac('sha256', hwidPepper()).update(String(hwid)).digest('hex')
}

export function validateHwid(hwid) {
  return typeof hwid === 'string' && HWID_RE.test(hwid)
}

export function deviceLimitFor(userId) {
  // Per-user override may arrive later (e.g. lifetime slots); env default for now.
  void userId
  return DEFAULT_DEVICE_LIMIT
}

function rowToDevice(row) {
  return {
    id: `ld_${row.id}`,
    label: row.device_label || null,
    platform: row.platform,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
  }
}

export function listDevices(userId) {
  const rows = getDb()
    .prepare('SELECT * FROM launcher_devices WHERE user_id = ? ORDER BY last_seen_at DESC')
    .all(userId)
  return rows.map(rowToDevice)
}

/** Register or refresh a device. Throws deviceError(409, 'DEVICE_LIMIT') beyond the cap. */
export function registerDevice(userId, { hwid, deviceLabel = null, platform = 'windows' }) {
  if (!validateHwid(hwid)) {
    throw deviceError(400, 'HWID_INVALID', 'hwid must be 16-128 characters of [A-Za-z0-9_-]')
  }
  if (!['windows', 'linux'].includes(platform)) {
    throw deviceError(400, 'PLATFORM_INVALID', 'platform must be windows or linux')
  }
  const label = deviceLabel ? String(deviceLabel).slice(0, 64) : null
  const now = new Date().toISOString()
  const db = getDb()
  const hwidHash = hashHwid(hwid)

  const existing = db
    .prepare('SELECT id FROM launcher_devices WHERE user_id = ? AND hwid_hash = ?')
    .get(userId, hwidHash)

  if (existing) {
    db.prepare('UPDATE launcher_devices SET last_seen_at = ?, device_label = COALESCE(?, device_label), platform = ? WHERE id = ?').run(
      now,
      label,
      platform,
      existing.id,
    )
    return { existing: true, limit: deviceLimitFor(userId), devices: listDevices(userId) }
  }

  const count = db.prepare('SELECT COUNT(*) AS c FROM launcher_devices WHERE user_id = ?').get(userId).c
  const limit = deviceLimitFor(userId)
  if (count >= limit) {
    throw deviceError(409, 'DEVICE_LIMIT', `Device limit reached (${limit})`, { devices: listDevices(userId) })
  }

  db.prepare(
    `INSERT INTO launcher_devices (user_id, hwid_hash, device_label, platform, created_at, last_seen_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(userId, hwidHash, label, platform, now, now)

  return { existing: false, limit, devices: listDevices(userId) }
}

export function findDeviceByHwid(userId, hwid) {
  return getDb()
    .prepare('SELECT * FROM launcher_devices WHERE user_id = ? AND hwid_hash = ?')
    .get(userId, hashHwid(hwid))
}

export function lastDeviceResetAt(userId) {
  const row = getDb().prepare('SELECT devices_reset_at FROM users WHERE id = ?').get(userId)
  return row?.devices_reset_at || null
}

export function cooldownEndsAt(userId) {
  const last = lastDeviceResetAt(userId)
  if (!last) return null
  return new Date(new Date(last).getTime() + DEVICE_RESET_COOLDOWN_DAYS * 24 * 60 * 60 * 1000).toISOString()
}

/** Wipe all devices for a user. force=true bypasses the self-serve cooldown (admin path). */
export function resetDevices(userId, { force = false } = {}) {
  const ends = cooldownEndsAt(userId)
  if (!force && ends && new Date(ends).getTime() > Date.now()) {
    throw deviceError(429, 'DEVICE_RESET_COOLDOWN', 'Device reset was used recently', { nextAllowedAt: ends })
  }
  const db = getDb()
  const result = db.prepare('DELETE FROM launcher_devices WHERE user_id = ?').run(userId)
  db.prepare('UPDATE users SET devices_reset_at = ? WHERE id = ?').run(new Date().toISOString(), userId)
  return { cleared: result.changes, nextAllowedAt: cooldownEndsAt(userId) }
}
