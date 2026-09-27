import crypto from 'node:crypto'
import { getDb, initDb } from '../db.js'
import dotenv from 'dotenv'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.join(__dirname, '..', '..', '.env') })

initDb()
const db = getDb()

// Usage:
//   node server/scripts/generate-keys.js lifetime 3
//   node server/scripts/generate-keys.js 3m 5
const kind = String(process.argv[2] || '').toLowerCase()
const count = Math.max(1, Math.min(Number(process.argv[3] || 1), 50))

let planId
let days
if (kind === 'lifetime') {
  planId = 'lifetime'
  days = 36500
} else if (['1m', '3m', '6m'].includes(kind)) {
  planId = kind
  days = { '1m': 30, '3m': 90, '6m': 180 }[kind]
} else {
  console.error('Usage: node server/scripts/generate-keys.js lifetime|1m|3m|6m [count]')
  process.exit(1)
}

const keys = []
const chunk = () => crypto.randomBytes(2).toString('hex').toUpperCase()
const prefix = kind === 'lifetime' ? 'NOXL' : kind === '6m' ? 'NOX6' : kind === '3m' ? 'NOX3' : 'NOX1'

const tx = db.transaction(() => {
  for (let i = 0; i < count; i++) {
    let code = `${prefix}-${chunk()}-${chunk()}-${chunk()}`
    while (db.prepare('SELECT id FROM license_keys WHERE code = ?').get(code)) {
      code = `${prefix}-${chunk()}-${chunk()}-${chunk()}`
    }
    db.prepare(
      'INSERT INTO license_keys (code, plan_id, days, created_at) VALUES (?, ?, ?, ?)',
    ).run(code, planId, days, new Date().toISOString())
    keys.push(code)
  }
})
tx()

console.log(`Generated ${count} ${kind} key(s):`)
for (const code of keys) console.log(`  ${code}`)
