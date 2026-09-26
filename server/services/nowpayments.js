import crypto from 'node:crypto'

const API_BASE = 'https://api.nowpayments.io/v1'

export function getNowPaymentsKey() {
  const key = process.env.NOWPAYMENTS_API_KEY
  if (!key) {
    const err = new Error('NOWPAYMENTS_API_KEY is not configured')
    err.status = 503
    throw err
  }
  return key
}

export function getIpnSecret() {
  return process.env.NOWPAYMENTS_IPN_SECRET || ''
}

export function publicIpnUrl() {
  const explicit = process.env.NOWPAYMENTS_IPN_URL
  if (explicit) return explicit
  const base = process.env.PUBLIC_API_URL || `http://127.0.0.1:${process.env.PORT || 3001}`
  return `${base.replace(/\/$/, '')}/api/webhooks/nowpayments`
}

async function npFetch(path, { method = 'GET', body } = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      'x-api-key': getNowPaymentsKey(),
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  })

  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const message = data.message || data.error || `NOWPayments error (${res.status})`
    const err = new Error(typeof message === 'string' ? message : JSON.stringify(message))
    err.status = res.status >= 400 && res.status < 600 ? res.status : 502
    throw err
  }
  return data
}

export async function createCryptoInvoice({
  priceAmount,
  priceCurrency,
  orderId,
  description,
  successUrl,
  cancelUrl,
}) {
  return npFetch('/invoice', {
    method: 'POST',
    body: {
      price_amount: priceAmount,
      price_currency: priceCurrency,
      order_id: orderId,
      order_description: description,
      ipn_callback_url: publicIpnUrl(),
      success_url: successUrl,
      cancel_url: cancelUrl,
    },
  })
}

export async function getInvoice(invoiceId) {
  return npFetch(`/invoice/${invoiceId}`)
}

/** Sorted-key HMAC-SHA512 used by NOWPayments IPN signatures. */
export function verifyIpnSignature(payload, signature) {
  const secret = getIpnSecret()
  if (!secret) {
    if (process.env.NODE_ENV === 'production') return false
    console.warn('NOWPAYMENTS_IPN_SECRET missing — skipping IPN signature check (dev only)')
    return true
  }
  if (!signature) return false

  const sorted = sortKeys(payload)
  const digest = crypto.createHmac('sha512', secret).update(JSON.stringify(sorted)).digest('hex')
  const expected = Buffer.from(digest, 'utf8')
  const received = Buffer.from(String(signature), 'utf8')
  if (expected.length !== received.length) return false
  return crypto.timingSafeEqual(expected, received)
}

function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys)
  if (value && typeof value === 'object') {
    return Object.keys(value)
      .sort()
      .reduce((acc, key) => {
        acc[key] = sortKeys(value[key])
        return acc
      }, {})
  }
  return value
}

export function isPaidStatus(status) {
  const normalized = String(status || '').toLowerCase()
  return normalized === 'finished' || normalized === 'confirmed'
}

export function parseOrderId(orderId) {
  const match = String(orderId || '').match(/^nox-(\d+)$/i)
  return match ? Number(match[1]) : null
}
