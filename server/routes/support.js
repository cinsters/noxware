import { Router } from 'express'
import { requireAuth, requireStaff } from '../middleware/auth.js'
import {
  TICKET_PRIORITIES,
  TICKET_STATUSES,
  addTicketMessage,
  createTicket,
  getTicketById,
  listTicketMessages,
  listTickets,
  updateTicket,
} from '../services/support.js'
import { sendMail } from '../services/outbound-mail.js'

export const supportRouter = Router()

function jsonSafeRow(row) {
  const { id, user_id, subject, status, priority, created_via, created_at, updated_at, username, email } = row
  return {
    id,
    userId: user_id,
    username,
    email,
    subject,
    status,
    priority,
    createdVia: created_via,
    createdAt: created_at,
    updatedAt: updated_at,
  }
}

function respondTicket(res, ticketId, { includeInternal = false, withIdentity = true, status = 200 } = {}) {
  const ticket = getTicketById(ticketId)
  if (!ticket) return res.status(404).json({ error: 'Ticket not found' })

  const summary = jsonSafeRow(ticket)
  if (!withIdentity) {
    delete summary.username
    delete summary.email
  }
  const messages = listTicketMessages(ticketId, { includeInternal })
  res.status(status).json({ ticket: { ...summary, messages } })
}

/* ---------------- Customer endpoints ---------------- */

supportRouter.get('/tickets', requireAuth, (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 100)
  const offset = Math.max(Number(req.query.offset) || 0, 0)
  const { rows, total } = listTickets({ userId: req.user.id, limit, offset })

  res.json({
    tickets: rows.map(({ username, email, ...ticket }) => ticket),
    total,
    limit,
    offset,
  })
})

supportRouter.post('/tickets', requireAuth, (req, res) => {
  const { ticket } = createTicket({
    userId: req.user.id,
    subject: req.body.subject,
    body: req.body.body,
    via: 'web',
  })

  res.location(`/api/support/tickets/${ticket.id}`)
  respondTicket(res, ticket.id, { status: 201, withIdentity: false })
})

supportRouter.get('/tickets/:id', requireAuth, (req, res) => {
  const ticket = getTicketById(req.params.id)
  if (!ticket) return res.status(404).json({ error: 'Ticket not found' })
  if (ticket.user_id !== req.user.id) {
    return res.status(403).json({ error: 'Not your ticket' })
  }

  respondTicket(res, ticket.id, { withIdentity: false })
})

supportRouter.post('/tickets/:id/replies', requireAuth, (req, res) => {
  const ticket = getTicketById(req.params.id)
  if (!ticket) return res.status(404).json({ error: 'Ticket not found' })
  if (ticket.user_id !== req.user.id) {
    return res.status(403).json({ error: 'Not your ticket' })
  }
  if (ticket.status === 'closed') {
    return res.status(409).json({ error: 'Ticket is closed — open a new ticket' })
  }

  const message = addTicketMessage({
    ticketId: ticket.id,
    authorId: req.user.id,
    authorRole: 'customer',
    body: req.body.body,
  })

  res.status(201).json({ message })
})

/* ---------------- Staff endpoints ---------------- */

supportRouter.get('/staff/tickets', requireStaff, (req, res) => {
  const status = req.query.status ? String(req.query.status) : undefined
  if (status && !TICKET_STATUSES.includes(status)) {
    return res.status(400).json({ error: `status must be one of: ${TICKET_STATUSES.join(', ')}` })
  }

  const limit = Math.min(Number(req.query.limit) || 50, 100)
  const offset = Math.max(Number(req.query.offset) || 0, 0)
  const { rows, total } = listTickets({ status, limit, offset })

  res.json({ tickets: rows.map(jsonSafeRow), total, limit, offset })
})

supportRouter.get('/staff/tickets/:id', requireStaff, (req, res) => {
  respondTicket(res, req.params.id, { includeInternal: true })
})

supportRouter.patch('/staff/tickets/:id', requireStaff, (req, res) => {
  const ticket = updateTicket(req.params.id, req.body)
  respondTicket(res, ticket.id, { includeInternal: true })
})

supportRouter.post('/staff/tickets/:id/replies', requireStaff, (req, res) => {
  const ticket = getTicketById(req.params.id)
  if (!ticket) return res.status(404).json({ error: 'Ticket not found' })
  if (ticket.status === 'closed' && req.body.reopen !== true) {
    return res.status(409).json({ error: 'Ticket is closed — pass reopen:true to reply anyway' })
  }

  const message = addTicketMessage({
    ticketId: ticket.id,
    authorId: req.user.id,
    authorRole: 'staff',
    body: req.body.body,
    internal: req.body.internal === true,
  })

  if (ticket.status === 'open' && req.body.internal !== true) {
    updateTicket(ticket.id, { status: 'pending' })
  }

  // Notify the customer by email on every visible staff reply (never on
  // internal notes). Fire-and-forget; failures land in the admin Mail log.
  if (req.body.internal !== true && ticket.email) {
    sendMail({
      to: ticket.email,
      subject: `Re: [noxware #${ticket.id}] ${ticket.subject}`,
      text: [
        `Staff replied to your support ticket #${ticket.id} ("${ticket.subject}"):`,
        '',
        req.body.body,
        '',
        'Reply to this ticket at: https://noxware.cc/dashboard (Support tab)',
        `Or just email support@noxware.cc with "Re:" in the subject to add to it.`,
      ].join('\n'),
    })
  }

  res.status(201).json({ message })
})
