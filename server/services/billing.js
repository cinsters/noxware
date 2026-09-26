import crypto from 'node:crypto'
import { getDb } from '../db.js'
import { getPlan } from '../plans.js'

export function generateLicenseCode() {
  const chunk = () => crypto.randomBytes(2).toString('hex').toUpperCase()
  return `NOX-${chunk()}-${chunk()}-${chunk()}`
}

/** Extend subscription from now or from current expiry if still active. */
export function extendSubscription(userId, planId, days) {
  const db = getDb()
  const now = new Date()
  const existing = db
    .prepare('SELECT expires_at FROM subscriptions WHERE user_id = ?')
    .get(userId)

  let base = now
  if (existing?.expires_at) {
    const current = new Date(existing.expires_at)
    if (current > now) base = current
  }

  const expires = new Date(base)
  expires.setUTCDate(expires.getUTCDate() + days)
  const expiresAt = expires.toISOString()
  const updatedAt = now.toISOString()

  db.prepare(
    `
    INSERT INTO subscriptions (user_id, plan_id, expires_at, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      plan_id = excluded.plan_id,
      expires_at = excluded.expires_at,
      updated_at = excluded.updated_at
  `,
  ).run(userId, planId, expiresAt, updatedAt)

  return { planId, expiresAt }
}

export function fulfillPaidOrder({ userId, planId, days, paymentId, amountCents }) {
  const db = getDb()

  const existing = db
    .prepare('SELECT id, status FROM orders WHERE payment_id = ?')
    .get(paymentId)

  if (existing?.status === 'paid') {
    return { alreadyProcessed: true, orderId: existing.id }
  }

  const createdAt = new Date().toISOString()
  let orderId = existing?.id

  if (!orderId) {
    const result = db
      .prepare(
        `
        INSERT INTO orders (user_id, payment_id, plan_id, amount_cents, status, created_at)
        VALUES (?, ?, ?, ?, 'paid', ?)
      `,
      )
      .run(userId, paymentId, planId, amountCents, createdAt)
    orderId = Number(result.lastInsertRowid)
  } else {
    db.prepare(`UPDATE orders SET status = 'paid', plan_id = ?, amount_cents = ? WHERE id = ?`).run(
      planId,
      amountCents,
      orderId,
    )
  }

  const subscription = extendSubscription(userId, planId, days)

  let code = generateLicenseCode()
  while (db.prepare('SELECT id FROM license_keys WHERE code = ?').get(code)) {
    code = generateLicenseCode()
  }

  db.prepare(
    `
    INSERT INTO license_keys (code, plan_id, days, order_id, redeemed_by, redeemed_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `,
  ).run(code, planId, days, orderId, userId, createdAt, createdAt)

  return { alreadyProcessed: false, orderId, licenseKey: code, subscription }
}

export function fulfillOrderRecord(order) {
  if (order.status === 'paid') {
    return { alreadyProcessed: true, orderId: order.id }
  }

  const plan = getPlan(order.plan_id)
  return fulfillPaidOrder({
    userId: order.user_id,
    planId: plan.id,
    days: plan.days,
    paymentId: order.payment_id || `order-${order.id}`,
    amountCents: order.amount_cents,
  })
}
