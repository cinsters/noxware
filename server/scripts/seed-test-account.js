import bcrypt from 'bcryptjs'
import { getDb, initDb } from '../db.js'
import dotenv from 'dotenv'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.join(__dirname, '..', '..', '.env') })

initDb()

const PASSWORD = process.env.TEST_ACCOUNT_PASSWORD || 'Test1234!'
const ONE_YEAR = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString()

const TEST_ACCOUNTS = [
  {
    email: 'test@noxware.app',
    username: 'noxtest',
    role: 'customer',
    subscription: { plan_id: '3m', expires_at: ONE_YEAR },
    licenseCode: 'NOX-TEST-KEY1-0001',
  },
  {
    email: 'support@noxware.app',
    username: 'noxsupport',
    role: 'support',
    subscription: null,
    licenseCode: null,
  },
  {
    email: 'admin@noxware.app',
    username: 'noxadmin',
    role: 'admin',
    subscription: null,
    licenseCode: null,
  },
]

const db = getDb()

function upsertUser({ email, username, role, subscription, licenseCode }) {
  const now = new Date().toISOString()
  const passwordHash = bcrypt.hashSync(PASSWORD, 12)

  const existing = db
    .prepare('SELECT id FROM users WHERE email = ? COLLATE NOCASE')
    .get(email)

  let userId
  if (existing) {
    db.prepare('UPDATE users SET username = ?, password_hash = ?, role = ? WHERE id = ?').run(
      username,
      passwordHash,
      role,
      existing.id,
    )
    userId = existing.id
  } else {
    const result = db
      .prepare(
        'INSERT INTO users (email, username, password_hash, role, accepted_terms_at, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(email, username, passwordHash, role, now, now)
    userId = Number(result.lastInsertRowid)
  }

  if (subscription) {
    db.prepare(
      `
      INSERT INTO subscriptions (user_id, plan_id, expires_at, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        plan_id = excluded.plan_id,
        expires_at = excluded.expires_at,
        updated_at = excluded.updated_at
    `,
    ).run(userId, subscription.plan_id, subscription.expires_at, now)
  }

  if (licenseCode && !db.prepare('SELECT id FROM license_keys WHERE code = ?').get(licenseCode)) {
    db.prepare(
      `
      INSERT INTO license_keys (code, plan_id, days, redeemed_by, redeemed_at, created_at)
      VALUES (?, '3m', 90, ?, ?, ?)
    `,
    ).run(licenseCode, userId, now, now)
  }

  return userId
}

const created = TEST_ACCOUNTS.map((account) => ({
  email: account.email,
  role: account.role,
  id: upsertUser(account),
}))

// Demo ticket so the staff queue is not empty out of the box.
const testCustomer = created.find((account) => account.role === 'customer')
const hasTicket = db
  .prepare('SELECT id FROM support_tickets WHERE user_id = ? LIMIT 1')
  .get(testCustomer.id)

if (!hasTicket) {
  const now = new Date().toISOString()
  const ticket = db
    .prepare(
      "INSERT INTO support_tickets (user_id, subject, status, priority, created_via, created_at, updated_at) VALUES (?, ?, 'open', 'normal', 'web', ?, ?)",
    )
    .run(testCustomer.id, 'Test ticket — license key check', now, now)
  const ticketId = Number(ticket.lastInsertRowid)
  db.prepare(
    "INSERT INTO support_messages (ticket_id, author_id, author_role, body, internal, created_at) VALUES (?, ?, 'customer', ?, 0, ?)",
  ).run(
    ticketId,
    testCustomer.id,
    'Seeded test ticket. Reply from the staff endpoints to see the full flow.',
    now,
  )
}

// Ensure a invite code exists for staging signups.
const inviteCode = process.env.INVITE_SEED_CODES?.split(',')[0] || 'NOX-INVITE-2026'
if (!db.prepare('SELECT id FROM invite_codes WHERE code = ?').get(inviteCode)) {
  db.prepare('INSERT INTO invite_codes (code, max_uses, uses, note, created_at) VALUES (?, 100, 0, ?, ?)').run(
    inviteCode,
    'staging seed',
    new Date().toISOString(),
  )
}

// Pre-register two fake devices on the test customer so DEVICE_LIMIT paths are testable.
const { hashHwid } = await import('../services/devices.js')
const testCustomerRow = created.find((account) => account.role === 'customer')
const nowIso = new Date().toISOString()
for (const [hwid, label] of [
  ['TESTHWID-GAMING-PC-00000001', 'Test Gaming PC'],
  ['TESTHWID-LAPTOP-000000000002', 'Test Laptop'],
]) {
  const hw = hashHwid(hwid)
  const exists = db.prepare('SELECT id FROM launcher_devices WHERE user_id = ? AND hwid_hash = ?').get(testCustomerRow.id, hw)
  if (!exists) {
    db.prepare(
      `INSERT INTO launcher_devices (user_id, hwid_hash, device_label, platform, created_at, last_seen_at)
       VALUES (?, ?, ?, 'windows', ?, ?)`,
    ).run(testCustomerRow.id, hw, label, nowIso, nowIso)
  }
}

console.log('Test accounts ready:')
for (const account of created) {
  console.log(`  ${account.role.padEnd(8)} ${account.email} / ${PASSWORD}`)
}
console.log('Test HWIDs (customer, 2/2 slots used): TESTHWID-GAMING-PC-00000001, TESTHWID-LAPTOP-000000000002')
console.log(`Invite code: ${inviteCode}`)
