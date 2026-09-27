import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { getDb } from '../db.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export const PLATFORMS = ['windows', 'linux']
export const MAX_BUILD_BYTES = 512 * 1024 * 1024 // 512 MB

const BUILD_DIR = process.env.BUILDS_DIR || path.join(__dirname, 'data', 'builds')

export function ensureBuildsDir() {
  fs.mkdirSync(BUILD_DIR, { recursive: true })
  return BUILD_DIR
}

export function buildPath(storedName) {
  const p = path.join(BUILD_DIR, storedName)
  if (!p.startsWith(BUILD_DIR)) {
    const err = new Error('Invalid path')
    err.status = 400
    throw err
  }
  return p
}

export function getActiveBuild(platform) {
  return getDb()
    .prepare('SELECT * FROM builds WHERE platform = ? AND active = 1')
    .get(platform)
}

export function listBuilds() {
  return getDb()
    .prepare('SELECT * FROM builds ORDER BY platform ASC, active DESC, id DESC')
    .all()
}

export function activateBuild(id) {
  const db = getDb()
  const build = db.prepare('SELECT id, platform FROM builds WHERE id = ?').get(id)
  if (!build) {
    const err = new Error('Build not found')
    err.status = 404
    throw err
  }
  const tx = db.transaction(() => {
    db.prepare('UPDATE builds SET active = 0 WHERE platform = ?').run(build.platform)
    db.prepare('UPDATE builds SET active = 1 WHERE id = ?').run(id)
  })
  tx()
  return db.prepare('SELECT * FROM builds WHERE id = ?').get(id)
}

export function deleteBuild(id) {
  const db = getDb()
  const build = db.prepare('SELECT id, active, stored_name FROM builds WHERE id = ?').get(id)
  if (!build) {
    const err = new Error('Build not found')
    err.status = 404
    throw err
  }
  if (build.active) {
    const err = new Error('Deactivate this build first (activate another one for its platform)')
    err.status = 409
    throw err
  }

  try {
    fs.unlinkSync(buildPath(build.stored_name))
  } catch {
    // already gone — still remove the row
  }
  db.prepare('DELETE FROM builds WHERE id = ?').run(id)
  return { ok: true }
}

/** Compute sha256 + size of an uploaded file without loading it into memory. */
export function hashStoredFile(storedName) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256')
    let size = 0
    const stream = fs.createReadStream(buildPath(storedName))
    stream.on('data', (chunk) => {
      hash.update(chunk)
      size += chunk.length
    })
    stream.on('end', () => resolve({ sha256: hash.digest('hex'), size }))
    stream.on('error', reject)
  })
}
