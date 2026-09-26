#!/usr/bin/env bash
# Noxware deploy — run on the VM from the repo root after `git pull`.
set -euo pipefail

cd "$(dirname "$0")/.."   # repo root

echo "==> [1/4] Building images"
docker compose -f deploy/docker-compose.yml build

echo "==> [2/4] Starting stack"
docker compose -f deploy/docker-compose.yml up -d --wait

echo "==> [3/4] Seeding invite codes"
# Seed codes from api.env (comma-separated). Re-running is safe (idempotent upsert of codes).
docker compose -f deploy/docker-compose.yml exec -T api node -e "
  const codes = (process.env.INVITE_SEED_CODES || '').split(',').map(s => s.trim()).filter(Boolean);
  if (!codes.length) { console.log('  (INVITE_SEED_CODES empty — skipped)'); process.exit(0); }
  import('./server/db.js').then(({ initDb, getDb }) => {
    initDb();
    const db = getDb();
    for (const code of codes) {
      try {
        db.prepare('INSERT INTO invite_codes (code, max_uses, uses, note, created_at) VALUES (?, 100, 0, ?, ?)')
          .run(code.toUpperCase(), 'deploy', new Date().toISOString());
        console.log('  seeded invite:', code.toUpperCase());
      } catch (e) {
        console.log('  exists:', code.toUpperCase());
      }
    }
    process.exit(0);
  });
"

echo "==> [4/4] Smoke test"
for i in $(seq 1 10); do
  if curl -fsS https://noxware.cc/api/health > /dev/null 2>&1; then
    echo "  https://noxware.cc/api/health OK"
    curl -fsS https://api.noxware.cc/api/health > /dev/null && echo "  https://api.noxware.cc/api/health OK"
    echo "Deploy complete."
    exit 0
  fi
  sleep 3
done

echo "Smoke test failed — check: docker compose -f deploy/docker-compose.yml logs api" >&2
exit 1
