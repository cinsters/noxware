import { getDb } from '../db.js'
import { addTicketMessage, createTicket, getTicketById, httpError, jsonTicket } from './support.js'

export function getInboundSecret() {
  return process.env.MAIL_INBOUND_SECRET || ''
}

export function getSupportInboundAddress() {
  return String(process.env.SUPPORT_INBOUND_ADDRESS || '').trim().toLowerCase()
}

/** Accepts "Name <a@b.c>", "a@b.c", { address }, or arrays of those. */
export function parseEmailAddress(value) {
  if (!value) return null
  if (Array.isArray(value)) return parseEmailAddress(value[0])
  if (typeof value === 'object') return parseEmailAddress(value.address || value.email || '')

  const str = String(value)
  const angled = str.match(/<([^>]+)>/)
  const candidate = (angled ? angled[1] : str).trim()
  const match = candidate.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)
  return match ? match[0].toLowerCase() : null
}

/**
 * Normalizes the payload shapes used by common inbound-mail providers:
 * Cloudflare Email Workers, Mailgun routes (sender/recipient/body-plain),
 * SendGrid Inbound Parse, and Postmark (From/To/TextBody).
 */
export function readInboundEmail(payload = {}) {
  const from = parseEmailAddress(payload.from ?? payload.sender ?? payload.From ?? payload.from_address)
  const to = parseEmailAddress(payload.to ?? payload.recipient ?? payload.To ?? payload.envelope_to)
  const subject = String(payload.subject ?? payload.Subject ?? '').trim() || '(no subject)'
  const text =
    String(
      payload.text ??
        payload.textBody ??
        payload.TextBody ??
        payload['body-plain'] ??
        payload.bodyPlain ??
        payload.body ??
        '',
    ).trim() || ''

  return { from, to, subject, text }
}

function stripReplyPrefixes(subject) {
  let out = String(subject || '').trim()
  while (/^(re|fw|fwd)\s*:\s*/i.test(out)) {
    out = out.replace(/^(re|fw|fwd)\s*:\s*/i, '').trim()
  }
  return out || '(no subject)'
}

/**
 * Creates a new ticket for the sender or appends to their most recent open
 * ticket when the subject looks like a reply (Re:/Fwd:). Throws httpError with
 * 4xx status so the MX provider can bounce undeliverable mail.
 */
export function handleInboundEmail(payload) {
  if (!getInboundSecret()) {
    throw httpError(503, 'MAIL_INBOUND_SECRET is not configured')
  }

  const { from, to, subject, text } = readInboundEmail(payload)
  if (!from) throw httpError(422, 'Missing sender email address')

  const expectedTo = getSupportInboundAddress()
  if (expectedTo && to && to !== expectedTo) {
    throw httpError(422, 'Recipient is not the support inbox')
  }
  if (!text) throw httpError(422, 'Email body is empty')

  const user = getDb()
    .prepare('SELECT id, email, username FROM users WHERE email = ? COLLATE NOCASE')
    .get(from)
  if (!user) {
    throw httpError(422, `No account matches sender ${from}`)
  }

  const isReply = /^(re|fw|fwd)\s*:/i.test(subject)
  if (isReply) {
    const existing = getDb()
      .prepare(
        `
        SELECT id FROM support_tickets
        WHERE user_id = ? AND status != 'closed'
        ORDER BY updated_at DESC, id DESC
        LIMIT 1
      `,
      )
      .get(user.id)

    if (existing) {
      const message = addTicketMessage({
        ticketId: existing.id,
        authorId: user.id,
        authorRole: 'customer',
        body: text,
      })
      getDb()
        .prepare(`UPDATE support_tickets SET status = 'open' WHERE id = ? AND status != 'open'`)
        .run(existing.id)

      return {
        matched: 'reply',
        ticketId: existing.id,
        messageId: message.id,
        ticket: jsonTicket(getTicketById(existing.id)),
      }
    }
  }

  const { ticket, message } = createTicket({
    userId: user.id,
    subject: stripReplyPrefixes(subject),
    body: text,
    via: 'email',
  })

  return { matched: 'new', ticketId: ticket.id, messageId: message.id, ticket: jsonTicket(ticket) }
}
