import { Router } from 'express'
import crypto from 'node:crypto'
import fs from 'node:fs'
import { getDb } from '../db.js'
import { getActiveBuild, buildPath } from '../services/builds.js'
import { getSubscription, requireAuth } from '../middleware/auth.js'

export const downloadsRouter = Router()

const DOWNLOAD_TOKEN_TTL_MS = 2 * 60 * 1000

function downloadSecret() {
  return process.env.JWT_SECRET || 'dev-only-change-me'
}

function signDownloadToken(buildId, expiresAtMs) {
  return crypto
    .createHmac('sha256', downloadSecret())
    .update(`nox-build:${buildId}:${expiresAtMs}`)
    .digest('hex')
}

function hasActiveSub(userId) {
  return Boolean(getSubscription(userId).active)
}

// Authenticated: returns a short-lived signed URL the browser can open directly.
downloadsRouter.get('/:platform', requireAuth, (req, res) => {
  const platform = String(req.params.platform || '').toLowerCase()
  if (platform !== 'windows' && platform !== 'linux') {
    return res.status(404).json({ error: 'Unknown platform' })
  }

  if (!hasActiveSub(req.user.id)) {
    return res.status(403).json({ error: 'An active subscription is required to download the loader' })
  }

  const build = getActiveBuild(platform)
  if (!build) {
    return res.status(404).json({ error: `No ${platform} build is currently available` })
  }

  const expires = Date.now() + DOWNLOAD_TOKEN_TTL_MS
  const sig = signDownloadToken(build.id, expires)
  res.json({
    url: `/api/downloads/file/${build.id}?expires=${expires}&sig=${sig}`,
    filename: build.filename,
    version: build.version,
    sha256: build.sha256,
    expiresIn: DOWNLOAD_TOKEN_TTL_MS / 1000,
  })
})

// Authenticated: public metadata (version/hash/size) — no subscription needed to look.
downloadsRouter.get('/:platform/meta', requireAuth, (req, res) => {
  const platform = String(req.params.platform || '').toLowerCase()
  if (platform !== 'windows' && platform !== 'linux') {
    return res.status(404).json({ error: 'Unknown platform' })
  }
  const build = getActiveBuild(platform)
  if (!build) {
    return res.json({ build: null })
  }
  res.json({
    build: {
      version: build.version,
      filename: build.filename,
      sizeBytes: build.size_bytes,
      sha256: build.sha256,
      updatedAt: build.created_at,
    },
  })
})

// Unauthenticated: the signed token itself is the proof (HMAC over build id + expiry).
downloadsRouter.get('/file/:buildId', (req, res) => {
  const buildId = Number(req.params.buildId)
  const expires = Number(req.query.expires)
  const sig = String(req.query.sig || '')

  if (!Number.isInteger(buildId) || !Number.isFinite(expires)) {
    return res.status(400).json({ error: 'Invalid download link' })
  }
  if (Date.now() > expires) {
    return res.status(403).json({ error: 'Download link expired — get a fresh one from the dashboard' })
  }

  const expected = signDownloadToken(buildId, expires)
  const a = Buffer.from(sig)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(403).json({ error: 'Invalid download link signature' })
  }

  const build = getDb().prepare('SELECT * FROM builds WHERE id = ?').get(buildId)
  if (!build) {
    return res.status(404).json({ error: 'Build not found' })
  }

  const filePath = buildPath(build.stored_name)
  if (!fs.existsSync(filePath)) {
    return res.status(503).json({ error: 'Build file missing from storage — contact support' })
  }

  res.setHeader('X-Build-Version', build.version)
  res.setHeader('X-Build-Sha256', build.sha256)
  res.download(filePath, build.filename)
})
