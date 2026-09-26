import { getDb } from '../db.js'

export const TICKET_STATUSES = ['open', 'pending', 'closed']
export const TICKET_PRIORITIES = ['low', 'normal', 'high']

export function httpError(status, message) {
  const err = new Error(message)
  err.status = status
  return err
}

export function jsonTicket(row) {
  return {
    id: row.id,
    userId: row.user_id,
    username: row.username ?? null,
    email: row.email ?? null,
    subject: row.subject,
    status: row.status,
    priority: row.priority,
    createdVia: row.created_via,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function getTicketById(id) {
  return getDb()
    .prepare(
      `
      SELECT t.*, u.username, u.email
      FROM support_tickets t
      JOIN users u ON u.id = t.user_id
      WHERE t.id = ?
    `,
    )
    .get(id)
}

export function listTickets({ status, userId = null, limit = 50, offset = 0 } = {}) {
  const db = getDb()
  const where = []
  const params = []

  if (status) {
    where.push('t.status = ?')
    params.push(String(status))
  }
  if (userId) {
    where.push('t.user_id = ?')
    params.push(userId)
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''
  const total = db
    .prepare(`SELECT COUNT(*) AS c FROM support_tickets t ${whereSql}`)
    .get(...params).c

  const rows = db
    .prepare(
      `
      SELECT t.*, u.username, u.email
      FROM support_tickets t
      JOIN users u ON u.id = t.user_id
      ${whereSql}
      ORDER BY t.updated_at DESC, t.id DESC
      LIMIT ? OFFSET ?
    `,
    )
    .all(...params, limit, offset)

  return { rows, total }
}

export function createTicket({ userId, subject, body, via = 'web' }) {
  const cleanSubject = String(subject || '').trim()
  const cleanBody = String(body || '').trim()

  if (!cleanSubject) throw httpError(400, 'Subject is required')
  if (cleanSubject.length > 200) throw httpError(400, 'Subject must be 200 characters or fewer')
  if (!cleanBody) throw httpError(400, 'Message body is required')
  if (cleanBody.length > 10000) throw httpError(400, 'Message must be 10000 characters or fewer')

  const db = getDb()
  const now = new Date().toISOString()
  const result = db
    .prepare(
      `
      INSERT INTO support_tickets (user_id, subject, status, priority, created_via, created_at, updated_at)
      VALUES (?, ?, 'open', 'normal', ?, ?, ?)
    `,
    )
    .run(userId, cleanSubject, via, now, now)

  const ticketId = Number(result.lastInsertRowid)
  const message = addTicketMessage({
    ticketId,
    authorId: userId,
    authorRole: 'customer',
    body: cleanBody,
  })

  return { ticket: getTicketById(ticketId), message }
}

export function addTicketMessage({ ticketId, authorId, authorRole = 'customer', body, internal = false }) {
  const cleanBody = String(body || '').trim()
  if (!cleanBody) throw httpError(400, 'Message body is required')
  if (cleanBody.length > 10000) throw httpError(400, 'Message must be 10000 characters or fewer')

  const db = getDb()
  if (!db.prepare('SELECT id FROM support_tickets WHERE id = ?').get(ticketId)) {
    throw httpError(404, 'Ticket not found')
  }

  const now = new Date().toISOString()
  const result = db
    .prepare(
      `
      INSERT INTO support_messages (ticket_id, author_id, author_role, body, internal, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `,
    )
    .run(ticketId, authorId ?? null, authorRole, cleanBody, internal ? 1 : 0, now)

  db.prepare('UPDATE support_tickets SET updated_at = ? WHERE id = ?').run(now, ticketId)

  return {
    id: Number(result.lastInsertRowid),
    ticketId,
    authorId: authorId ?? null,
    authorRole,
    body: cleanBody,
    internal: Boolean(internal),
    createdAt: now,
  }
}

export function listTicketMessages(ticketId, { includeInternal = false } = {}) {
  const sql = `
    SELECT id, ticket_id, author_id, author_role, body, internal, created_at
    FROM support_messages
    WHERE ticket_id = ? ${includeInternal ? '' : 'AND internal = 0'}
    ORDER BY id ASC
  `
  return getDb()
    .prepare(sql)
    .all(ticketId)
    .map((row) => ({
      id: row.id,
      ticketId: row.ticket_id,
      authorId: row.author_id,
      authorRole: row.author_role,
      body: row.body,
      internal: Boolean(row.internal),
      createdAt: row.created_at,
    }))
}

export function updateTicket(id, { status, priority } = {}) {
  const db = getDb()
  if (!db.prepare('SELECT id FROM support_tickets WHERE id = ?').get(id)) {
    throw httpError(404, 'Ticket not found')
  }

  const updates = []
  const params = []

  if (status !== undefined) {
    if (!TICKET_STATUSES.includes(status)) {
      throw httpError(400, `Status must be one of: ${TICKET_STATUSES.join(', ')}`)
    }
    updates.push('status = ?')
    params.push(status)
  }
  if (priority !== undefined) {
    if (!TICKET_PRIORITIES.includes(priority)) {
      throw httpError(400, `Priority must be one of: ${TICKET_PRIORITIES.join(', ')}`)
    }
    updates.push('priority = ?')
    params.push(priority)
  }
  if (!updates.length) {
    throw httpError(400, 'Nothing to update (provide status and/or priority)')
  }

  updates.push('updated_at = ?')
  params.push(new Date().toISOString(), id)
  db.prepare(`UPDATE support_tickets SET ${updates.join(', ')} WHERE id = ?`).run(...params)

  return getTicketById(id)
}
