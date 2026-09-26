import { Router } from 'express'
import { getDb } from '../db.js'
import { getSubscription, publicUser, requireAuth } from '../middleware/auth.js'

export const meRouter = Router()

meRouter.get('/', requireAuth, (req, res) => {
  const subscription = getSubscription(req.user.id)
  const latestKey = getDb()
    .prepare(
      `
      SELECT code, plan_id, created_at
      FROM license_keys
      WHERE redeemed_by = ?
      ORDER BY id DESC
      LIMIT 1
    `,
    )
    .get(req.user.id)

  res.json({
    user: publicUser(req.user),
    subscription,
    latestLicenseKey: latestKey
      ? { code: latestKey.code, planId: latestKey.plan_id, createdAt: latestKey.created_at }
      : null,
  })
})
