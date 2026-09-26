# Noxware production deploy — noxware.cc

Architecture:

```
                       ┌──────────────────── Cloudflare ────────────────────┐
                       │  DNS  A noxware.cc / www / api  → VM IP            │
                       │  Email Routing (MX route1/2/3.mx.cloudflare.net)   │
                       │        └─ catch-all → Email Worker                 │
                       └──────────┬──────────────────────┬─────────────────┘
                                  │ HTTPS                │ email (MIME)
                                  ▼                      ▼
                ┌──────────── your VM (Docker) ┐   ┌─ Cloudflare Workers ─┐
 noxware.cc ───▶│ caddy :443 — SPA + /api/* ───┼──▶│ api :3001 (private)  │
 api.noxware.cc▶│ auto-TLS, HTTP/3             │   │ SQLite volume        │
                └──────────────────────────────┘   └──────────────────────┘
                                                        ▲
                                        POST /api/mail/inbound
                                        X-Inbound-Secret: …
```

- **caddy** — public edge. Serves the built SPA, proxies `/api/*` to the API, auto-provisions TLS certs.
- **api** — Node/Express + SQLite (`better-sqlite3`, WAL) on a named volume. Never exposed publicly.
- **Email Worker** — receives mail for `*@noxware.cc`, POSTs parsed messages to `/api/mail/inbound`.

---

## 0. Prerequisites

- A VM with **Docker + Docker Compose v2** (any 1–2 vCPU / 2 GB box is plenty for launch).
- Cloudflare account with the zone **noxware.cc**.
- A NOWPayments account (API key + IPN secret).
- Shell access to the VM.

## 1. DNS (Cloudflare dashboard → noxware.cc → DNS)

| Type | Name | Content | Proxy |
| --- | --- | --- | --- |
| A | `@` | your VM IP | **DNS only** (grey cloud) for first boot |
| A | `www` | your VM IP | DNS only for first boot |
| A | `api` | your VM IP | DNS only for first boot |

Keep records grey-clouded for the first deploy so Let's Encrypt can reach Caddy directly for the cert challenge. Once `https://noxware.cc` serves traffic over the grey-cloud, you may flip records to proxied (orange) — Caddy's `tls` will then use the TLS-ALPN/http challenges still fine, and you get Cloudflare CDN + WAF on top. Don't proxy before the first successful cert issuance.

MX records come later, in step 5 — Email Routing owns `route1/2/3.mx.cloudflare.net`.

## 2. Get the code onto the VM

```bash
ssh root@YOUR_VM_IP
mkdir -p /opt/noxware && cd /opt/noxware
git clone <YOUR_REPO_URL> app && cd app
```

(Or `git pull` if it's already there. Everything below runs from `/opt/noxware/app`.)

## 3. Secrets and environment

```bash
cp deploy/api.env.example deploy/api.env
node -e "console.log('JWT_SECRET='+require('crypto').randomBytes(32).toString('hex'))"
node -e "console.log('MAIL_INBOUND_SECRET='+require('crypto').randomBytes(32).toString('hex'))"
```

Fill `deploy/api.env`:

- `JWT_SECRET` and `MAIL_INBOUND_SECRET` from the commands above.
- `NOWPAYMENTS_API_KEY`, `NOWPAYMENTS_IPN_SECRET` from the NOWPayments dashboard.
- `INVITE_SEED_CODES=NOX-LAUNCH-2026` (or your own codes — the deploy script seeds them; comma-separated for several).
- `SUPPORT_INBOUND_ADDRESS=support@noxware.cc` (already pre-filled in the template).

`api.env` is git-ignored; secrets never leave the VM.

## 4. First deploy

```bash
bash deploy/deploy.sh
```

That builds both images, starts the stack (`up -d --wait`), seeds invite codes, and smoke-tests both hosts. First run takes a few minutes (image builds + Let's Encrypt issuance).

Verify:

```bash
curl -s https://noxware.cc/api/health
curl -s https://api.noxware.cc/api/health
# then open https://noxware.cc and https://api.noxware.cc/docs in a browser
```

You can now orange-cloud the DNS records if you want Cloudflare proxying.

## 5. Email (MX) — support intake

From your workstation (or any machine with Node):

```bash
cd deploy/email-worker
npm init -y && npm i postal-mime
npx wrangler login
npx wrangler secret put INBOUND_SECRET   # paste the SAME value as MAIL_INBOUND_SECRET
npx wrangler deploy
```

Then in the Cloudflare dashboard:

1. **Email → Email Routing**: enable for noxware.cc. Accept the automatic MX/DNS records
   (`route1/2/3.mx.cloudflare.net`, priorities 10/20/30) — this is what makes `*@noxware.cc` deliverable.
2. **Routing rules → Catch-all → Send to Worker → `noxware-mail-inbound`**.
3. Send a test email from an address that has a Noxware account to `support@noxware.cc` —
   it should appear as an open ticket. A `Re:` reply should thread into the same ticket.

## 6. NOWPayments

Dashboard → store settings:

- **IPN callback URL**: `https://api.noxware.cc/api/webhooks/nowpayments`
- The invoice creation code already sends `ipn_callback_url` per-invoice too, so this is belt-and-suspenders.

Test with a real small invoice (e.g. the 1-month plan) and watch:

```bash
docker compose -f deploy/docker-compose.yml logs -f api
```

You should see the IPN arrive, the order flip to `paid`, a license key get issued, and the subscription extend.

## 7. Create your staff account

```bash
# admin CLI invite, if you need a signup code for yourself:
docker compose -f deploy/docker-compose.yml exec api node server/scripts/create-invite.js FOUNDER-01 1

# sign up on https://noxware.cc, then promote yourself:
docker compose -f deploy/docker-compose.yml exec api node -e "
  import('./server/db.js').then(({ initDb, getDb }) => {
    initDb();
    getDb().prepare(\"UPDATE users SET role='support' WHERE email = ?\").run('YOU@example.com');
    console.log('promoted');
    process.exit(0);
  });
"
```

(`npm run seed:test-accounts` is staging-only. Never run it in production.)

## 8. Day-2 operations

**Updates** — the whole flow is:

```bash
cd /opt/noxware/app && git pull
bash deploy/deploy.sh     # rebuilds changed layers, restarts cleanly, re-runs smoke test
```

SQLite lives in the `api-data` volume — deploys don't touch it. The API runs idempotent `CREATE TABLE IF NOT EXISTS` + column migrations on boot, so schema drift is handled automatically.

**Backups** — add a daily cron on the VM (SQLite is a single file; use the online-backup API so WAL is checkpointed safely):

```bash
# /etc/cron.d/noxware-backup  (root)
15 4 * * * docker exec noxware-api-1 node -e "import('./server/db.js').then(async ({ initDb, getDb }) => { initDb(); await getDb().backup('/tmp/backup.sqlite'); process.exit(0); })" && docker cp noxware-api-1:/tmp/backup.sqlite /var/backups/noxware-$(date +\%F).sqlite
```

(Learn the exact container name with `docker ps`; compose names it `noxware-api-1` by default.) Copy `/var/backups` off-box (S3, restic, etc.).

**Logs / restarts**:

```bash
docker compose -f deploy/docker-compose.yml logs -f api     # or caddy
docker compose -f deploy/docker-compose.yml restart api
docker compose -f deploy/docker-compose.yml ps              # healthcheck status
```

**Firewall** — only 22/80/443 need to be open. The API container has no published ports; it's only reachable through the compose network (`api:3001`).

## 9. Staging

Same stack, different names. Simplest: a second VM, or a second compose project on the same VM with hostname/env overrides:

1. Copy the repo to `/opt/noxware-staging`, create `deploy/api.env` with staging secrets and
   `CLIENT_ORIGIN=https://staging.noxware.cc`, `PUBLIC_API_URL=https://api-staging.noxware.cc`.
2. Add `staging.noxware.cc` / `api-staging.noxware.cc` DNS records (grey-cloud), adjust the Caddyfile site blocks to those hostnames, and run `docker compose -p noxware-staging up -d --build`.
3. Run `npm run seed:test-accounts` there (staging only!) — accounts `test@ / support@ / admin@noxware.app`, password `Test1234!` unless `TEST_ACCOUNT_PASSWORD` is set.
4. Point NOWPayments staging IPN at `https://api-staging.noxware.cc/api/webhooks/nowpayments` if you use a separate sandbox account.

The OpenAPI spec (`https://api-staging.noxware.cc/docs/openapi.yaml`) lists all three server URLs.

## 10. Troubleshooting

| Symptom | Check |
| --- | --- |
| Cert issuance fails | DNS grey-clouded and pointing at the VM? Ports 80/443 reachable (`ufw status`)? |
| 502 from Caddy | `docker compose logs api` — container unhealthy/crashed; `docker compose ps` |
| Emails don't become tickets | Worker logs (`npx wrangler tail`), then `docker compose logs api` for 401s (secret mismatch) or 422s (unknown sender) |
| NOWPayments IPN 401 | `NOWPAYMENTS_IPN_SECRET` mismatch between dashboard and `api.env` |
| `SQLITE_CANTOPEN` on boot | `api-data` volume mount issue — check `volumes:` in compose and container logs |

---

### Checklist (print me)

- [ ] VM ready, Docker + Compose v2 installed
- [ ] DNS A records (`@`, `www`, `api`) grey-clouded → VM IP
- [ ] `deploy/api.env` filled (JWT_SECRET, MAIL_INBOUND_SECRET, NOWPAYMENTS_*, INVITE_SEED_CODES)
- [ ] `bash deploy/deploy.sh` → both health checks green
- [ ] `https://noxware.cc` loads, signup works with your invite code
- [ ] Email Worker deployed, secret set, catch-all → worker
- [ ] MX records active (Email Routing enabled), test mail → ticket created
- [ ] NOWPayments IPN URL registered, test invoice → license key issued
- [ ] Your account promoted to `support`
- [ ] Backup cron configured
