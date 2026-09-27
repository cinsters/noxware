import { Router } from 'express'
import bcrypt from 'bcryptjs'
import { getDb } from '../db.js'
import { publicUser, signToken, getSubscription } from '../middleware/auth.js'
import {
  checkInviteCode,
  consumeLocalCaptcha,
  createLocalCaptcha,
  getCaptchaMode,
  getTurnstileSiteKey,
  normalizeInviteCode,
  verifyTurnstile,
} from '../services/registration.js'

export const authRouter = Router()

function validateCredentials({ email, username, password }, { requireUsername }) {
  const errors = []
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errors.push('Valid email is required')
  }
  if (requireUsername) {
    if (!username || username.length < 3 || username.length > 24) {
      errors.push('Username must be 3–24 characters')
    } else if (!/^[a-zA-Z0-9_]+$/.test(username)) {
      errors.push('Username can only contain letters, numbers, and underscores')
    }
  }
  if (!password || password.length < 6) {
    errors.push('Password must be at least 6 characters')
  }
  return errors
}

authRouter.get('/config', (_req, res) => {
  const mode = getCaptchaMode()
  res.json({
    captchaMode: mode,
    turnstileSiteKey: mode === 'turnstile' ? getTurnstileSiteKey() : null,
  })
})

authRouter.get('/captcha', (_req, res) => {
  if (getCaptchaMode() !== 'local') {
    return res.status(400).json({ error: 'Local captcha is disabled' })
  }
  res.json(createLocalCaptcha())
})

authRouter.post('/register', async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase()
  const username = String(req.body.username || '').trim()
  const password = String(req.body.password || '')
  const inviteCode = normalizeInviteCode(req.body.inviteCode)
  const acceptedTerms = Boolean(req.body.acceptedTerms)
  const captchaToken = req.body.captchaToken
  const captchaId = req.body.captchaId
  const captchaAnswer = req.body.captchaAnswer

  const errors = validateCredentials({ email, username, password }, { requireUsername: true })
  if (errors.length) {
    return res.status(400).json({ error: errors[0] })
  }

  if (!acceptedTerms) {
    return res.status(400).json({ error: 'You must accept the Terms of Service and Privacy Policy' })
  }

  if (!inviteCode) {
    return res.status(400).json({ error: 'Invitation code is required' })
  }

  try {
    if (getCaptchaMode() === 'turnstile') {
      await verifyTurnstile(captchaToken, req.ip)
    } else {
      consumeLocalCaptcha(captchaId, captchaAnswer)
    }
  } catch (err) {
    return res.status(err.status || 400).json({ error: err.message || 'Captcha failed' })
  }

  const db = getDb()
  const taken = db
    .prepare('SELECT email, username FROM users WHERE email = ? OR username = ?')
    .get(email, username)

  if (taken) {
    const field = taken.email.toLowerCase() === email ? 'Email' : 'Username'
    return res.status(409).json({ error: `${field} already in use` })
  }

  let invite
  try {
    invite = checkInviteCode(inviteCode)
  } catch (err) {
    return res.status(err.status || 400).json({ error: err.message || 'Invalid invitation code' })
  }

  const passwordHash = await bcrypt.hash(password, 12)
  const createdAt = new Date().toISOString()

  let userId
  try {
    const tx = db.transaction(() => {
      const used = db
        .prepare(
          `
          UPDATE invite_codes
          SET uses = uses + 1
          WHERE id = ? AND uses < max_uses
        `,
        )
        .run(invite.id)

      if (used.changes !== 1) {
        const err = new Error('Invitation code has no remaining uses')
        err.status = 400
        throw err
      }

      const result = db
        .prepare(
          `
          INSERT INTO users (email, username, password_hash, invite_code_id, accepted_terms_at, created_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `,
        )
        .run(email, username, passwordHash, invite.id, createdAt, createdAt)

      return Number(result.lastInsertRowid)
    })

    userId = tx()
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message || 'Registration failed' })
  }

  const user = {
    id: userId,
    email,
    username,
    created_at: createdAt,
  }

  const token = signToken(user)
  res.status(201).json({
    token,
    user: publicUser(user),
    subscription: getSubscription(user.id),
  })
})

authRouter.post('/login', async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase()
  const password = String(req.body.password || '')

  const errors = validateCredentials({ email, password }, { requireUsername: false })
  if (errors.length) {
    return res.status(400).json({ error: errors[0] })
  }

  const user = getDb()
    .prepare('SELECT id, email, username, password_hash, banned_at, created_at FROM users WHERE email = ?')
    .get(email)

  if (!user) {
    return res.status(401).json({ error: 'Invalid email or password' })
  }

  const ok = await bcrypt.compare(password, user.password_hash)
  if (!ok) {
    return res.status(401).json({ error: 'Invalid email or password' })
  }

  if (user.banned_at) {
    return res.status(403).json({ error: 'Account banned' })
  }

  const token = signToken(user)
  res.json({
    token,
    user: publicUser(user),
    subscription: getSubscription(user.id),
  })
})
