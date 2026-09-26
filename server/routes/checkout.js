import { Router } from 'express'
import { getDb } from '../db.js'
import { getSubscription, requireAuth } from '../middleware/auth.js'
import { getPlan } from '../plans.js'
import { fulfillOrderRecord } from '../services/billing.js'
import {
  createCryptoInvoice,
  getInvoice,
  isPaidStatus,
} from '../services/nowpayments.js'

export const checkoutRouter = Router()

checkoutRouter.post('/session', requireAuth, async (req, res, next) => {
  try {
    const planId = String(req.body.planId || '')
    const plan = getPlan(planId)
    const clientOrigin = process.env.CLIENT_ORIGIN || 'http://127.0.0.1:5173'

    const createdAt = new Date().toISOString()
    const orderResult = getDb()
      .prepare(
        `
        INSERT INTO orders (user_id, payment_id, plan_id, amount_cents, status, created_at)
        VALUES (?, NULL, ?, ?, 'pending', ?)
      `,
      )
      .run(req.user.id, plan.id, plan.amountCents, createdAt)

    const orderId = Number(orderResult.lastInsertRowid)
    const externalOrderId = `nox-${orderId}`

    const invoice = await createCryptoInvoice({
      priceAmount: plan.amountCents / 100,
      priceCurrency: plan.currency,
      orderId: externalOrderId,
      description: `${plan.label} · ${req.user.email}`,
      successUrl: `${clientOrigin}/checkout/success?order_id=${orderId}`,
      cancelUrl: `${clientOrigin}/checkout/cancel`,
    })

    const paymentId = String(invoice.id)
    getDb().prepare('UPDATE orders SET payment_id = ? WHERE id = ?').run(paymentId, orderId)

    res.json({
      url: invoice.invoice_url,
      orderId,
      invoiceId: paymentId,
    })
  } catch (err) {
    next(err)
  }
})

checkoutRouter.post('/confirm', requireAuth, async (req, res, next) => {
  try {
    const orderId = Number(req.body.orderId || 0)
    if (!orderId) {
      return res.status(400).json({ error: 'orderId is required' })
    }

    const order = getDb()
      .prepare(
        `SELECT id, user_id, payment_id, plan_id, amount_cents, status FROM orders WHERE id = ?`,
      )
      .get(orderId)

    if (!order || order.user_id !== req.user.id) {
      return res.status(404).json({ error: 'Order not found' })
    }

    if (order.status === 'paid') {
      const paidKey = getDb()
        .prepare(
          `SELECT code FROM license_keys WHERE order_id = ? ORDER BY id DESC LIMIT 1`,
        )
        .get(order.id)

      return res.json({
        ok: true,
        alreadyProcessed: true,
        licenseKey: paidKey?.code || null,
        subscription: getSubscription(req.user.id),
      })
    }

    if (!order.payment_id) {
      return res.status(402).json({ error: 'Payment not started yet' })
    }

    const invoice = await getInvoice(order.payment_id)
    const paymentStatus =
      invoice.payment_status ||
      invoice.status ||
      invoice.invoice_status ||
      (Array.isArray(invoice.payments)
        ? invoice.payments.find((p) => isPaidStatus(p.payment_status))?.payment_status
        : null)

    if (!isPaidStatus(paymentStatus)) {
      return res.status(402).json({
        error:
          'Crypto payment not confirmed yet. Wait for network confirmations, then refresh.',
        paymentStatus: paymentStatus || 'waiting',
      })
    }

    const result = fulfillOrderRecord(order)
    const licenseKey =
      result.licenseKey ||
      getDb()
        .prepare(`SELECT code FROM license_keys WHERE order_id = ? ORDER BY id DESC LIMIT 1`)
        .get(order.id)?.code ||
      null

    res.json({
      ok: true,
      alreadyProcessed: result.alreadyProcessed,
      licenseKey,
      subscription: getSubscription(req.user.id),
    })
  } catch (err) {
    next(err)
  }
})
