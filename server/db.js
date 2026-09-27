import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const dataDir = path.join(__dirname, 'data')
const dbPath = process.env.DATABASE_PATH || path.join(dataDir, 'noxware.sqlite')

/** @type {import('better-sqlite3').Database | null} */
let db = null

export function getDb() {
  if (!db) throw new Error('Database not initialized')
  return db
}

export function initDb() {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true })
  db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'customer',
      invite_code_id INTEGER,
      accepted_terms_at TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS subscriptions (
      user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      plan_id TEXT,
      expires_at TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      payment_id TEXT UNIQUE,
      plan_id TEXT NOT NULL,
      amount_cents INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS license_keys (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      plan_id TEXT NOT NULL,
      days INTEGER NOT NULL,
      order_id INTEGER REFERENCES orders(id) ON DELETE SET NULL,
      redeemed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      redeemed_at TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS invite_codes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE COLLATE NOCASE,
      max_uses INTEGER NOT NULL DEFAULT 1,
      uses INTEGER NOT NULL DEFAULT 0,
      note TEXT,
      expires_at TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS captcha_challenges (
      id TEXT PRIMARY KEY,
      answer_hash TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      consumed_at TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS support_tickets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      subject TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      priority TEXT NOT NULL DEFAULT 'normal',
      created_via TEXT NOT NULL DEFAULT 'web',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS support_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticket_id INTEGER NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
      author_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      author_role TEXT NOT NULL DEFAULT 'customer',
      body TEXT NOT NULL,
      internal INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      action TEXT NOT NULL,
      target_type TEXT,
      target_id INTEGER,
      details TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS builds (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      platform TEXT NOT NULL CHECK (platform IN ('windows', 'linux')),
      version TEXT NOT NULL,
      filename TEXT NOT NULL,
      stored_name TEXT NOT NULL UNIQUE,
      size_bytes INTEGER NOT NULL,
      sha256 TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 0,
      uploaded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS launcher_devices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      hwid_hash TEXT NOT NULL,
      device_label TEXT,
      platform TEXT NOT NULL DEFAULT 'windows',
      created_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      UNIQUE (user_id, hwid_hash)
    );

    CREATE TABLE IF NOT EXISTS mail_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      from_addr TEXT,
      to_addr TEXT,
      subject TEXT,
      outcome TEXT NOT NULL,
      reason TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_builds_platform_active ON builds(platform, active);
    CREATE INDEX IF NOT EXISTS idx_launcher_devices_user ON launcher_devices(user_id);
    CREATE INDEX IF NOT EXISTS idx_support_tickets_user ON support_tickets(user_id);
    CREATE INDEX IF NOT EXISTS idx_support_tickets_status ON support_tickets(status);
    CREATE INDEX IF NOT EXISTS idx_support_messages_ticket ON support_messages(ticket_id);
    CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at);
  `)

  migrateOrdersPaymentId(db)
  migrateUsersRegistrationColumns(db)
  migrateUsersRoleColumn(db)
  migrateUsersBanColumns(db)
  migrateInviteCodeColumns(db)
  migrateUsersDeviceColumns(db)

  return db
}

function migrateOrdersPaymentId(database) {
  const columns = database.prepare('PRAGMA table_info(orders)').all()
  const names = new Set(columns.map((column) => column.name))

  if (names.has('stripe_session_id') && !names.has('payment_id')) {
    database.exec('ALTER TABLE orders RENAME COLUMN stripe_session_id TO payment_id')
  }
}

function migrateUsersRegistrationColumns(database) {
  const columns = database.prepare('PRAGMA table_info(users)').all()
  const names = new Set(columns.map((column) => column.name))

  if (!names.has('invite_code_id')) {
    database.exec('ALTER TABLE users ADD COLUMN invite_code_id INTEGER')
  }
  if (!names.has('accepted_terms_at')) {
    database.exec('ALTER TABLE users ADD COLUMN accepted_terms_at TEXT')
  }
}

function migrateUsersRoleColumn(database) {
  const columns = database.prepare('PRAGMA table_info(users)').all()
  const names = new Set(columns.map((column) => column.name))

  if (!names.has('role')) {
    database.exec("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'customer'")
  }
}

function migrateUsersBanColumns(database) {
  const columns = database.prepare('PRAGMA table_info(users)').all()
  const names = new Set(columns.map((column) => column.name))

  if (!names.has('banned_at')) {
    database.exec('ALTER TABLE users ADD COLUMN banned_at TEXT')
  }
  if (!names.has('ban_reason')) {
    database.exec('ALTER TABLE users ADD COLUMN ban_reason TEXT')
  }
}

function migrateInviteCodeColumns(database) {
  const columns = database.prepare('PRAGMA table_info(invite_codes)').all()
  const names = new Set(columns.map((column) => column.name))

  if (!names.has('expires_at')) {
    database.exec('ALTER TABLE invite_codes ADD COLUMN expires_at TEXT')
  }
}

function migrateUsersDeviceColumns(database) {
  const columns = database.prepare('PRAGMA table_info(users)').all()
  const names = new Set(columns.map((column) => column.name))

  if (!names.has('devices_reset_at')) {
    database.exec('ALTER TABLE users ADD COLUMN devices_reset_at TEXT')
  }
}
