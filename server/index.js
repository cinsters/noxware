import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { initDb } from './db.js'
import { authRouter } from './routes/auth.js'
import { meRouter } from './routes/me.js'
import { checkoutRouter } from './routes/checkout.js'
import { redeemRouter } from './routes/redeem.js'
import { supportRouter } from './routes/support.js'
import { adminRouter } from './routes/admin.js'
import { mailRouter } from './routes/mail.js'
import { mountDocs } from './routes/docs.js'
import { nowpaymentsWebhookHandler } from './routes/webhook.js'
import { seedDefaultInvites } from './services/registration.js'
import { systemStatus } from './services/status.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.join(__dirname, '..', '.env') })

const PORT = Number(process.env.PORT || 3001)
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || 'http://127.0.0.1:5173'

initDb()
seedDefaultInvites()

const app = express()

app.use(cors({ origin: CLIENT_ORIGIN, credentials: true }))
app.use(express.json())

app.post('/api/webhooks/nowpayments', nowpaymentsWebhookHandler)

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'noxware-api' })
})

app.get('/api/status', (_req, res) => {
  res.json(systemStatus())
})

app.use('/api/auth', authRouter)
app.use('/api/me', meRouter)
app.use('/api/checkout', checkoutRouter)
app.use('/api/redeem', redeemRouter)
app.use('/api/support', supportRouter)
app.use('/api/admin', adminRouter)
app.use('/api/mail', mailRouter)
mountDocs(app)

app.use((err, _req, res, _next) => {
  console.error(err)
  const status = err.status || 500
  res.status(status).json({ error: err.message || 'Server error' })
})

app.listen(PORT, () => {
  console.log(`noxware api on http://127.0.0.1:${PORT}`)
  console.log(`OpenAPI spec: http://127.0.0.1:${PORT}/docs`)
})
