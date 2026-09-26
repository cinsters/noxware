import { createInviteCode, normalizeInviteCode } from '../services/registration.js'
import { initDb } from '../db.js'
import dotenv from 'dotenv'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.join(__dirname, '..', '..', '.env') })

initDb()

const code = normalizeInviteCode(process.argv[2] || '')
const maxUses = Number(process.argv[3] || 1)

if (!code) {
  console.error('Usage: node server/scripts/create-invite.js CODE [maxUses]')
  process.exit(1)
}

const invite = createInviteCode(code, { maxUses, note: 'cli' })
console.log(`Created invite ${invite.code} (max uses: ${invite.maxUses})`)
