import { Router } from 'express'
import crypto from 'node:crypto'
import { getDb } from '../db.js'
import { audit, publicUser, requireAdmin } from '../middleware/auth.js'

export const adminRouter = Router()

const ROLES = ['customer', 'support', 'admin']
const PLAN_IDS = new Set(['1m', '3m', '6m', 'lifetime'])
const PLAN_DAYS = { '1m': 30, '3m': 90, '6m': 180, lifetime: 36500 }
const LIFETIME_DAYS = PLAN_DAYS.lifetime

function adminAudit(req, action, targetType, targetId, details) {
  audit(req.user.id, action, targetType, targetId, details)
}

/* ---------------- Users ---------------- */

adminRouter.get('/users', requireAdmin, (req, res) => {
  const search = String(req.query.search || '').trim()
  const limit = Math.min(Number(req.query.limit) || 50, 200)
  const offset = Math.max(Number(req.query.offset) || 0, 0)

  const where = []
  const params = []
  if (search) {
    where.push('(email LIKE ? OR username LIKE ?)')
    params.push(`%${search}%`, `%${search}%`)
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''

  const total = getDb().prepare(`SELECT COUNT(*) AS c FROM users ${whereSql}`).get(...params).c
  const rows = getDb()
    .prepare(
      `
      SELECT u.id, u.email, u.username, u.role, u.banned_at, u.ban_reason, u.created_at,
             s.plan_id, s.expires_at,
             (SELECT COUNT(*) FROM support_tickets t WHERE t.user_id = u.id) AS ticket_count
      FROM users u
      LEFT JOIN subscriptions s ON s.user_id = u.id
      ${whereSql}
      ORDER BY u.id DESC
      LIMIT ? OFFSET ?
    `,
    )
    .all(...params, limit, offset)

  res.json({
    users: rows.map((row) => ({
      id: row.id,
      email: row.email,
      username: row.username,
      role: row.role,
      banned: Boolean(row.banned_at),
      banReason: row.ban_reason || null,
      bannedAt: row.banned_at || null,
      createdAt: row.created_at,
      subscription: row.plan_id
        ? { planId: row.plan_id, expiresAt: row.expires_at, active: new Date(row.expires_at).getTime() > Date.now() }
        : null,
      ticketCount: row.ticket_count,
    })),
    total,
    limit,
    offset,
  })
})

adminRouter.patch('/users/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id)
  const db = getDb()
  const target = db.prepare('SELECT id, email, username, role, banned_at FROM users WHERE id = ?').get(id)
  if (!target) return res.status(404).json({ error: 'User not found' })

  const { role, ban, banReason } = req.body || {}

  // --- Role change ---
  if (role !== undefined) {
    if (!ROLES.includes(role)) {
      return res.status(400).json({ error: `role must be one of: ${ROLES.join(', ')}` })
    }
    if (id === req.user.id && role !== 'admin') {
      return res.status(400).json({ error: 'You cannot demote yourself' })
    }
    db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, id)
    adminAudit(req, role === 'customer' ? 'user.demote' : 'user.promote', 'user', id, {
      from: target.role,
      to: role,
    })
  }

  // --- Ban / unban ---
  if (ban !== undefined) {
    if (ban === true) {
      if (target.banned_at) {
        return res.status(409).json({ error: 'User is already banned' })
      }
      if (target.role === 'admin') {
        return res.status(409).json({ error: 'Admins cannot ban other admins' })
      }
      const reason = String(banReason || 'No reason provided')
      db.prepare('UPDATE users SET banned_at = ?, ban_reason = ? WHERE id = ?').run(
        new Date().toISOString(),
        reason,
        id,
      )
      adminAudit(req, 'user.ban', 'user', id, { reason })
    } else if (ban === false) {
      db.prepare('UPDATE users SET banned_at = NULL, ban_reason = NULL WHERE id = ?').run(id)
      adminAudit(req, 'user.unban', 'user', id, {})
    } else {
      return res.status(400).json({ error: 'ban must be true or false' })
    }
  }

  const updated = db
    .prepare('SELECT id, email, username, role, banned_at, ban_reason FROM users WHERE id = ?')
    .get(id)
  res.json({
    user: {
      ...publicUser(updated),
      banReason: updated.ban_reason || null,
      bannedAt: updated.banned_at || null,
    },
  })
})

/* ---------------- Subscription grants ---------------- */

adminRouter.post('/users/:id/grant', requireAdmin, (req, res) => {
  const id = Number(req.params.id)
  const db = getDb()
  const target = db.prepare('SELECT id, email, username FROM users WHERE id = ?').get(id)
  if (!target) return res.status(404).json({ error: 'User not found' })

  const { days, planId, lifetime } = req.body || {}

  let effectiveDays
  let effectivePlan
  if (lifetime === true) {
    effectiveDays = LIFETIME_DAYS
    effectivePlan = 'lifetime'
  } else {
    const d = Number(days)
    if (!Number.isInteger(d) || d <= 0 || d > 3650) {
      return res.status(400).json({ error: 'days must be an integer between 1 and 3650, or pass lifetime:true' })
    }
    effectiveDays = d
    effectivePlan = PLAN_IDS.has(planId) ? planId : 'comp'
  }

  // Extend from max(now, current expiry) so grants stack, same as purchases.
  const existing = db.prepare('SELECT expires_at FROM subscriptions WHERE user_id = ?').get(id)
  const now = new Date()
  let base = now
  if (existing?.expires_at && new Date(existing.expires_at) > now) {
    base = new Date(existing.expires_at)
  }
  const expires = new Date(base)
  expires.setUTCDate(expires.getUTCDate() + effectiveDays)

  db.prepare(
    `
    INSERT INTO subscriptions (user_id, plan_id, expires_at, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      plan_id = excluded.plan_id,
      expires_at = excluded.expires_at,
      updated_at = excluded.updated_at
  `,
  ).run(id, effectivePlan, expires.toISOString(), now.toISOString())

  adminAudit(req, lifetime ? 'user.grant_lifetime' : 'user.grant', 'user', id, {
    planId: effectivePlan,
    days: effectiveDays,
    expiresAt: expires.toISOString(),
  })

  res.json({
    subscription: {
      planId: effectivePlan,
      expiresAt: expires.toISOString(),
      lifetime: effectivePlan === 'lifetime',
    },
  })
})

/* ---------------- License key generation ---------------- */

adminRouter.post('/license-keys', requireAdmin, (req, res) => {
  const { count = 1, planId = '3m' } = req.body || {}
  const n = Number(count)
  if (!Number.isInteger(n) || n < 1 || n > 50) {
    return res.status(400).json({ error: 'count must be an integer between 1 and 50' })
  }
  if (!PLAN_IDS.has(planId)) {
    return res.status(400).json({ error: `planId must be one of: ${[...PLAN_IDS].join(', ')}` })
  }

  const plan = getPlanData(planId)
  const db = getDb()
  const keys = []

  const tx = db.transaction(() => {
    for (let i = 0; i < n; i++) {
      let code = generateCode(planId)
      while (db.prepare('SELECT id FROM license_keys WHERE code = ?').get(code)) {
        code = generateCode(planId)
      }
      db.prepare(
        `
        INSERT INTO license_keys (code, plan_id, days, created_at)
        VALUES (?, ?, ?, ?)
      `,
      ).run(code, plan.id, plan.days, new Date().toISOString())
      keys.push(code)
    }
  })
  tx()

  adminAudit(req, 'keys.generate', 'license_batch', null, { count: n, planId })
  res.status(201).json({ keys })
})

function generateCode(planId) {
  const prefix =
    planId === 'lifetime' ? 'NOXL' : planId === '6m' ? 'NOX6' : planId === '3m' ? 'NOX3' : 'NOX1'
  const chunk = () => crypto.randomBytes(2).toString('hex').toUpperCase()
  return `${prefix}-${chunk()}-${chunk()}-${chunk()}`
}

function getPlanData(planId) {
  const days = PLAN_DAYS[planId] ?? 30
  return { id: planId, days }
}

/* ---------------- Audit log ---------------- */

adminRouter.get('/audit-log', requireAdmin, (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 200)
  const offset = Math.max(Number(req.query.offset) || 0, 0)
  const db = getDb()

  const total = db.prepare('SELECT COUNT(*) AS c FROM audit_log').get().c
  const rows = db
    .prepare(
      `
      SELECT a.id, a.action, a.target_type, a.target_id, a.details, a.created_at,
             u.username AS actor_username, u.email AS actor_email
      FROM audit_log a
      LEFT JOIN users u ON u.id = a.actor_id
      ORDER BY a.id DESC
      LIMIT ? OFFSET ?
    `,
    )
    .all(limit, offset)

  res.json({
    entries: rows.map((row) => ({
      id: row.id,
      actor: row.actor_username ? { id: row.actor_id, username: row.actor_username, email: row.actor_email } : null,
      action: row.action,
      targetType: row.target_type,
      targetId: row.target_id,
      details: row.details ? JSON.parse(row.details) : null,
      createdAt: row.created_at,
    })),
    total,
    limit,
    offset,
  })
})
