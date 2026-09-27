import crypto from 'node:crypto'
import { getDb } from '../db.js'

const PAID_STATUSES = new Set(['finished', 'confirmed'])

export function normalizeInviteCode(code) {
  return String(code || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '')
}

export function createInviteCode(code, { maxUses = 1, note = null, expiresInDays = null } = {}) {
  const normalized = normalizeInviteCode(code)
  if (!normalized || normalized.length < 4) {
    const err = new Error('Invite code must be at least 4 characters')
    err.status = 400
    throw err
  }

  let expiresAt = null
  if (expiresInDays !== null && expiresInDays !== undefined) {
    const d = Number(expiresInDays)
    if (!Number.isFinite(d) || d <= 0 || d > 3650) {
      const err = new Error('expiresInDays must be between 1 and 3650')
      err.status = 400
      throw err
    }
    expiresAt = new Date(Date.now() + d * 24 * 60 * 60 * 1000).toISOString()
  }

  const db = getDb()
  const createdAt = new Date().toISOString()
  try {
    const result = db
      .prepare(
        `
        INSERT INTO invite_codes (code, max_uses, uses, note, expires_at, created_at)
        VALUES (?, ?, 0, ?, ?, ?)
      `,
      )
      .run(normalized, maxUses, note, expiresAt, createdAt)
    return { id: Number(result.lastInsertRowid), code: normalized, maxUses, expiresAt }
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) {
      const conflict = new Error('Invite code already exists')
      conflict.status = 409
      throw conflict
    }
    throw err
  }
}

export function seedDefaultInvites() {
  const db = getDb()
  const count = db.prepare('SELECT COUNT(*) AS c FROM invite_codes').get().c
  if (count > 0) return

  const fromEnv = String(process.env.INVITE_SEED_CODES || 'NOX-INVITE-2026')
    .split(',')
    .map((c) => normalizeInviteCode(c))
    .filter(Boolean)

  for (const code of fromEnv) {
    try {
      createInviteCode(code, { maxUses: 100, note: 'seed' })
      console.log(`Seeded invite code: ${code}`)
    } catch {
      // ignore duplicates
    }
  }
}

/** Validate an invite exists, is not expired, and has uses left — without consuming it. */
export function checkInviteCode(code) {
  const normalized = normalizeInviteCode(code)
  if (!normalized) {
    const err = new Error('Invitation code is required')
    err.status = 400
    throw err
  }

  const invite = getDb()
    .prepare('SELECT id, code, max_uses, uses, expires_at FROM invite_codes WHERE code = ?')
    .get(normalized)

  if (!invite) {
    const err = new Error('Invalid invitation code')
    err.status = 400
    throw err
  }

  if (invite.expires_at && new Date(invite.expires_at).getTime() < Date.now()) {
    const err = new Error('Invitation code has expired')
    err.status = 400
    throw err
  }

  if (invite.uses >= invite.max_uses) {
    const err = new Error('Invitation code has no remaining uses')
    err.status = 400
    throw err
  }

  return invite
}

/** Consume one use of an invite. Returns invite row. */
export function consumeInviteCode(code) {
  const invite = checkInviteCode(code)
  getDb().prepare('UPDATE invite_codes SET uses = uses + 1 WHERE id = ?').run(invite.id)
  return invite
}

export function createLocalCaptcha() {
  const a = crypto.randomInt(2, 12)
  const b = crypto.randomInt(2, 12)
  const answer = String(a + b)
  const id = crypto.randomBytes(16).toString('hex')
  const answerHash = hashCaptchaAnswer(id, answer)
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString()

  getDb()
    .prepare(
      `INSERT INTO captcha_challenges (id, answer_hash, expires_at, created_at) VALUES (?, ?, ?, ?)`,
    )
    .run(id, answerHash, expiresAt, new Date().toISOString())

  return {
    id,
    question: `What is ${a} + ${b}?`,
    mode: 'local',
  }
}

function hashCaptchaAnswer(id, answer) {
  const secret = process.env.JWT_SECRET || 'dev-captcha'
  return crypto
    .createHmac('sha256', secret)
    .update(`${id}:${String(answer).trim().toLowerCase()}`)
    .digest('hex')
}

export function consumeLocalCaptcha(id, answer) {
  if (!id || answer === undefined || answer === null || String(answer).trim() === '') {
    const err = new Error('Captcha is required')
    err.status = 400
    throw err
  }

  const db = getDb()
  const row = db
    .prepare('SELECT id, answer_hash, expires_at, consumed_at FROM captcha_challenges WHERE id = ?')
    .get(id)

  if (!row || row.consumed_at) {
    const err = new Error('Captcha expired or already used')
    err.status = 400
    throw err
  }

  if (new Date(row.expires_at).getTime() < Date.now()) {
    db.prepare('DELETE FROM captcha_challenges WHERE id = ?').run(id)
    const err = new Error('Captcha expired')
    err.status = 400
    throw err
  }

  const expected = hashCaptchaAnswer(id, answer)
  if (expected !== row.answer_hash) {
    const err = new Error('Incorrect captcha answer')
    err.status = 400
    throw err
  }

  db.prepare('UPDATE captcha_challenges SET consumed_at = ? WHERE id = ?').run(
    new Date().toISOString(),
    id,
  )
}

export async function verifyTurnstile(token, remoteip) {
  const secret = process.env.TURNSTILE_SECRET_KEY
  if (!secret) {
    const err = new Error('Captcha is not configured')
    err.status = 503
    throw err
  }
  if (!token) {
    const err = new Error('Captcha is required')
    err.status = 400
    throw err
  }

  const body = new URLSearchParams()
  body.set('secret', secret)
  body.set('response', token)
  if (remoteip) body.set('remoteip', remoteip)

  const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    body,
  })
  const data = await res.json()
  if (!data.success) {
    const err = new Error('Captcha verification failed')
    err.status = 400
    throw err
  }
}

export function getCaptchaMode() {
  if (process.env.TURNSTILE_SECRET_KEY && getTurnstileSiteKey()) {
    return 'turnstile'
  }
  return 'local'
}

export function getTurnstileSiteKey() {
  return process.env.TURNSTILE_SITE_KEY || process.env.VITE_TURNSTILE_SITE_KEY || ''
}
