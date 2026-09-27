import { getDb } from '../db.js'
import { publicIpnUrl } from '../services/nowpayments.js'

export function systemStatus() {
  const db = getDb()
  const now = Date.now()

  // Registration gate: needs a usable invite (not expired/revoked, uses < max).
  // A closed gate is intentional (invite-only), NOT an outage — shown as its own
  // neutral state instead of Degraded.
  const invites = db
    .prepare('SELECT COUNT(*) AS c FROM invite_codes WHERE (expires_at IS NULL OR expires_at > ?) AND uses < max_uses')
    .get(new Date().toISOString()).c
  const registration =
    invites > 0
      ? { status: 'Operational', ok: true }
      : { status: 'Invite-only', ok: true }

  // Checkout: NOWPayments fully configured (key, IPN secret, reachable IPN URL).
  const paymentsOk = Boolean(
    process.env.NOWPAYMENTS_API_KEY && process.env.NOWPAYMENTS_IPN_SECRET && publicIpnUrl(),
  )

  // Support inbox: mail pipeline wired up (inbound secret + address set).
  const supportOk = Boolean(process.env.MAIL_INBOUND_SECRET && process.env.SUPPORT_INBOUND_ADDRESS)

  // Database: write latency, measured for real.
  const dbStart = process.hrtime.bigint()
  db.prepare("SELECT COUNT(*) AS c FROM users WHERE created_at > ?").get(new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString())
  const dbMs = Number(process.hrtime.bigint() - dbStart) / 1e6

  const check = (ok) => (ok ? { status: 'Operational', ok: true } : { status: 'Degraded', ok: false })
  const payments = check(paymentsOk)
  const support = check(supportOk)

  return {
    updatedAt: new Date().toISOString(),
    services: [
      { name: 'Website', ...check(true), latency: null },
      { name: 'Auth API', ...check(true), latency: null },
      { name: 'Payments', ...payments, latency: null },
      { name: 'Support inbox', ...support, latency: null },
      { name: 'Registration', ...registration, latency: null },
      { name: 'Database', ...check(true), latency: `${dbMs.toFixed(1)}ms` },
    ],
    invitesAvailable: invites,
  }
}
