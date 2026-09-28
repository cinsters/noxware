import jwt from 'jsonwebtoken'
import { getDb } from '../db.js'

const JWT_SECRET = () => process.env.JWT_SECRET || 'dev-only-change-me'

export function signToken(user) {
  return jwt.sign(
    { sub: user.id, email: user.email, username: user.username },
    JWT_SECRET(),
    { expiresIn: '14d' },
  )
}

/** Short-lived JWT for the launcher (aud "launcher"). Accepted only by /api/launcher/*. */
export function signLauncherToken(user) {
  return jwt.sign(
    { sub: user.id, username: user.username },
    JWT_SECRET(),
    { expiresIn: '1h', audience: 'launcher' },
  )
}

function readBearer(req) {
  const header = req.headers.authorization || ''
  return header.startsWith('Bearer ') ? header.slice(7) : null
}

/** Shared verify+DB-load: payload aud must match `audience` (null = website token, no aud). */
function verifyFor(req, res, audience) {
  const token = readBearer(req)
  if (!token) {
    res.status(401).json({ error: 'Authentication required' })
    return null
  }

  try {
    const opts = audience ? { audience } : {}
    const payload = jwt.verify(token, JWT_SECRET(), opts)
    const tokenAud = Array.isArray(payload.aud) ? payload.aud[0] : payload.aud
    if ((audience || null) !== (tokenAud || null)) {
      res.status(401).json({ error: 'Invalid token audience' })
      return null
    }

    const user = getDb()
      .prepare('SELECT id, email, username, role, banned_at, created_at FROM users WHERE id = ?')
      .get(payload.sub)

    if (!user) {
      res.status(401).json({ error: 'User not found' })
      return null
    }

    if (user.banned_at) {
      res.status(403).json({ error: 'Account banned' })
      return null
    }

    return user
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' })
    return null
  }
}

export function requireAuth(req, res, next) {
  const user = verifyFor(req, res, null)
  if (user) {
    req.user = user
    next()
  }
}

/** Accepts ONLY launcher tokens (aud "launcher"). */
export function requireLauncherAuth(req, res, next) {
  const user = verifyFor(req, res, 'launcher')
  if (user) {
    req.user = user
    next()
  }
}

/** Accepts either a website token or a launcher token (website JWTs have no aud). */
export function requireAnyAuth(req, res, next) {
  const header = req.headers.authorization || ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : null
  if (!token) {
    return res.status(401).json({ error: 'Authentication required' })
  }

  let audience = null
  try {
    const decoded = jwt.decode(token)
    if (decoded && typeof decoded === 'object') {
      const aud = decoded.aud
      audience = (Array.isArray(aud) ? aud[0] : aud) || null
    }
  } catch {
    // fall through: verifyFor will reject garbage
  }

  const user = verifyFor(req, res, audience)
  if (user) {
    req.user = user
    next()
  }
}

export function isStaffRole(role) {
  return role === 'support' || role === 'admin'
}

export function requireStaff(req, res, next) {
  requireAuth(req, res, () => {
    if (!isStaffRole(req.user.role)) {
      return res.status(403).json({ error: 'Staff access required' })
    }
    next()
  })
}

export function requireAdmin(req, res, next) {
  requireAuth(req, res, () => {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' })
    }
    next()
  })
}

export function publicUser(user) {
  return {
    id: user.id,
    email: user.email,
    username: user.username,
    role: user.role || 'customer',
    banned: Boolean(user.banned_at),
    createdAt: user.created_at,
  }
}

/** Append a row to the audit log. details may be any JSON-serializable value. */
export function audit(actorId, action, targetType = null, targetId = null, details = null) {
  getDb()
    .prepare(
      `
      INSERT INTO audit_log (actor_id, action, target_type, target_id, details, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `,
    )
    .run(actorId, action, targetType, targetId, details ? JSON.stringify(details) : null, new Date().toISOString())
}

export function getSubscription(userId) {
  const row = getDb()
    .prepare('SELECT plan_id, expires_at, updated_at FROM subscriptions WHERE user_id = ?')
    .get(userId)

  if (!row?.expires_at) {
    return { active: false, planId: null, expiresAt: null }
  }

  const active = new Date(row.expires_at).getTime() > Date.now()
  return {
    active,
    planId: row.plan_id,
    expiresAt: row.expires_at,
    updatedAt: row.updated_at,
  }
}
