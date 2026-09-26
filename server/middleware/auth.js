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

export function requireAuth(req, res, next) {
  const header = req.headers.authorization || ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : null
  if (!token) {
    return res.status(401).json({ error: 'Authentication required' })
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET())
    const user = getDb()
      .prepare('SELECT id, email, username, role, created_at FROM users WHERE id = ?')
      .get(payload.sub)

    if (!user) {
      return res.status(401).json({ error: 'User not found' })
    }

    req.user = user
    next()
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' })
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

export function publicUser(user) {
  return {
    id: user.id,
    email: user.email,
    username: user.username,
    role: user.role || 'customer',
    createdAt: user.created_at,
  }
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
