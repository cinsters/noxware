import { Router } from 'express'
import { getDb } from '../db.js'
import { getSubscription, requireAuth } from '../middleware/auth.js'
import { extendSubscription } from '../services/billing.js'

export const redeemRouter = Router()

redeemRouter.post('/', requireAuth, (req, res) => {
  const code = String(req.body.code || '')
    .trim()
    .toUpperCase()

  if (!code) {
    return res.status(400).json({ error: 'License key is required' })
  }

  const db = getDb()
  const key = db
    .prepare(
      `SELECT id, code, plan_id, days, redeemed_by FROM license_keys WHERE code = ?`,
    )
    .get(code)

  if (!key) {
    return res.status(404).json({ error: 'Invalid license key' })
  }

  if (key.redeemed_by && key.redeemed_by !== req.user.id) {
    return res.status(409).json({ error: 'License key already redeemed' })
  }

  if (key.redeemed_by === req.user.id) {
    return res.json({
      message: 'This key is already on your account',
      subscription: getSubscription(req.user.id),
    })
  }

  const redeemedAt = new Date().toISOString()
  const subscription = extendSubscription(req.user.id, key.plan_id, key.days)

  db.prepare(
    `UPDATE license_keys SET redeemed_by = ?, redeemed_at = ? WHERE id = ?`,
  ).run(req.user.id, redeemedAt, key.id)

  res.json({
    message: 'License key redeemed',
    planId: key.plan_id,
    subscription,
  })
})
