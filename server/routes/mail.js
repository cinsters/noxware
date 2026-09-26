import { Router } from 'express'
import crypto from 'node:crypto'
import { getInboundSecret, handleInboundEmail } from '../services/mail.js'

export const mailRouter = Router()

/**
 * Inbound mail webhook — point your MX / Email Routing worker here.
 * Shared-secret auth: `X-Inbound-Secret: $MAIL_INBOUND_SECRET`.
 * 4xx responses tell the provider to bounce the message.
 */
mailRouter.post('/inbound', (req, res) => {
  const secret = getInboundSecret()
  if (!secret) {
    return res.status(503).json({ error: 'Inbound mail is not configured' })
  }

  const provided = req.headers['x-inbound-secret']
  const providedStr = Array.isArray(provided) ? provided[0] : provided
  const a = Buffer.from(String(providedStr || ''), 'utf8')
  const b = Buffer.from(secret, 'utf8')
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(401).json({ error: 'Invalid inbound secret' })
  }

  try {
    const result = handleInboundEmail(req.body)
    res.status(201).json({ received: true, ...result })
  } catch (err) {
    const status = err.status || 500
    if (status >= 500) console.error('Inbound email failed', err)
    res.status(status).json({ error: err.message || 'Inbound email failed' })
  }
})
