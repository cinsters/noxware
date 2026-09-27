import { getDb } from '../db.js'

/**
 * Outbound transactional email (e.g. staff reply notifications).
 *
 * Providers are REST-only — no SMTP deps. Configure via env:
 *   MAIL_OUTBOUND_PROVIDER=resend   → MAIL_OUTBOUND_API_KEY  (Resend API key,
 *                                      domain verified for the From address)
 *   MAIL_OUTBOUND_PROVIDER=postmark → MAIL_OUTBOUND_API_KEY  (Postmark server token)
 *   MAIL_FROM=noxware Support <support@noxware.cc>
 * Unset/unknown provider = outbound disabled (logged as 'skipped', never fatal).
 */

export function outboundConfigured() {
  const provider = String(process.env.MAIL_OUTBOUND_PROVIDER || '').toLowerCase()
  return (provider === 'resend' || provider === 'postmark') && process.env.MAIL_OUTBOUND_API_KEY && process.env.MAIL_FROM
}

function recordOutboundEvent({ to, subject, outcome, reason = null }) {
  try {
    getDb()
      .prepare(
        `INSERT INTO mail_events (from_addr, to_addr, subject, outcome, reason, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(process.env.MAIL_FROM || null, to, subject, outcome, reason, new Date().toISOString())
  } catch {
    // never let logging break the request
  }
}

async function sendViaResend(apiKey, from, to, subject, text) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to, subject, text }),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`resend ${res.status}: ${body.slice(0, 200)}`)
  }
}

async function sendViaPostmark(apiKey, from, to, subject, text) {
  const res = await fetch('https://api.postmarkapp.com/email', {
    method: 'POST',
    headers: { 'X-Postmark-Server-Token': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ From: from, To: to, Subject: subject, TextBody: text, MessageStream: 'outbound' }),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`postmark ${res.status}: ${body.slice(0, 200)}`)
  }
}

/** Fire-and-forget send. Never throws — failures land in the admin Mail log. */
export function sendMail({ to, subject, text }) {
  void (async () => {
    try {
      const provider = String(process.env.MAIL_OUTBOUND_PROVIDER || '').toLowerCase()
      const apiKey = process.env.MAIL_OUTBOUND_API_KEY
      const from = process.env.MAIL_FROM

      if (provider !== 'resend' && provider !== 'postmark') {
        recordOutboundEvent({ to, subject, outcome: 'skipped', reason: 'outbound mail not configured' })
        return
      }
      if (!apiKey || !from) {
        recordOutboundEvent({ to, subject, outcome: 'skipped', reason: 'MAIL_OUTBOUND_API_KEY or MAIL_FROM missing' })
        return
      }

      if (provider === 'resend') {
        await sendViaResend(apiKey, from, to, subject, text)
      } else {
        await sendViaPostmark(apiKey, from, to, subject, text)
      }
      recordOutboundEvent({ to, subject, outcome: 'sent' })
    } catch (err) {
      recordOutboundEvent({ to, subject, outcome: 'send_failed', reason: err.message })
    }
  })()
}
