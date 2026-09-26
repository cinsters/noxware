import { getDb } from '../db.js'
import { getPlan } from '../plans.js'
import { fulfillPaidOrder } from '../services/billing.js'
import {
  isPaidStatus,
  parseOrderId,
  verifyIpnSignature,
} from '../services/nowpayments.js'

export function nowpaymentsWebhookHandler(req, res) {
  try {
    const signature = req.headers['x-nowpayments-sig']
    const payload = req.body

    if (!verifyIpnSignature(payload, signature)) {
      return res.status(401).json({ error: 'Invalid IPN signature' })
    }

    if (!isPaidStatus(payload.payment_status)) {
      return res.json({ received: true, ignored: true })
    }

    const orderId = parseOrderId(payload.order_id)
    const db = getDb()

    let order = null
    if (orderId) {
      order = db
        .prepare(
          `SELECT id, user_id, payment_id, plan_id, amount_cents, status FROM orders WHERE id = ?`,
        )
        .get(orderId)
    }

    if (!order && payload.invoice_id) {
      order = db
        .prepare(
          `SELECT id, user_id, payment_id, plan_id, amount_cents, status FROM orders WHERE payment_id = ?`,
        )
        .get(String(payload.invoice_id))
    }

    if (!order) {
      console.error('NOWPayments IPN for unknown order', payload.order_id, payload.invoice_id)
      return res.status(404).json({ error: 'Order not found' })
    }

    if (order.status === 'paid') {
      return res.json({ received: true, alreadyProcessed: true })
    }

    const plan = getPlan(order.plan_id)
    fulfillPaidOrder({
      userId: order.user_id,
      planId: plan.id,
      days: plan.days,
      paymentId: order.payment_id || String(payload.invoice_id || payload.payment_id),
      amountCents: order.amount_cents,
    })

    res.json({ received: true })
  } catch (err) {
    console.error('NOWPayments IPN failed', err)
    res.status(500).json({ error: 'IPN handler failed' })
  }
}
