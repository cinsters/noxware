# Noxware on Android (Termux) — noxware.cc

Android has **no Docker**, so `deploy/deploy.sh` and docker-compose do not work here.
This runbook runs the same stack natively in Termux:

```
Cloudflare edge ──▶ cloudflared tunnel (outbound, no ports opened) ──▶ Caddy :8080
                                                                        ├─ /api/*  → node :3001 (SQLite)
                                                                        └─ static  → dist/ (Vite build)
```

- `cloudflared` gives you **HTTPS + public reachability** even behind carrier CGNAT — no port forwarding, no root.
- Caddy serves the built frontend and proxies `/api` to the Node process (the frontend uses relative `/api` paths, so **zero code changes**).
- Honest caveat: a phone is fine for **staging/demo**, not a serious production box (battery, reboots, thermal throttling). For real customers, prefer the VPS path in `deploy/README.md`.

---

## 1. Install Termux

Install **Termux from F-Droid** (https://f-droid.org/packages/com.termux/) — the Play Store build is outdated and broken for this.
Optional but recommended: also install the **Termux:Boot** add-on from F-Droid (step 11).

## 2. Base packages (one-time)

```bash
pkg update -y && pkg upgrade -y
pkg install -y nodejs-lts git build-essential binutils python caddy cloudflared termux-api nano
termux-setup-storage   # allow storage access (for backups to /sdcard)
node -v && caddy version && cloudflared --version
```

## 3. Get the code

```bash
git clone https://github.com/YOUR_USER/noxware ~/noxware
cd ~/noxware
npm install
```

`better-sqlite3` compiles from source on ARM — the install can take 3–10 minutes. Let it finish.

## 4. Build the frontend

```bash
npm run build
ls dist/index.html   # must exist before you continue
```

(If the build gets OOM-killed, close other apps and retry; or build `dist/` on a PC and copy the folder into `~/noxware/dist`.)

## 5. Environment

```bash
cp .env.example .env
nano .env
```

Fill it in for the phone setup (single-host mode — no `api.` subdomain):

```env
PORT=3001
CLIENT_ORIGIN=https://noxware.cc
PUBLIC_API_URL=https://noxware.cc
JWT_SECRET=<node -e "console.log(require('crypto').randomBytes(32).toString('hex'))">
MAIL_INBOUND_SECRET=<second random hex>
NOWPAYMENTS_API_KEY=...
NOWPAYMENTS_IPN_SECRET=...
INVITE_SEED_CODES=NOX-LAUNCH-2026
SUPPORT_INBOUND_ADDRESS=support@noxware.cc
```

Generate the secrets in Termux directly:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## 6. Caddy (serves the site locally)

The Caddyfile is already in the repo at `deploy/termux/Caddyfile` (HTTP on 127.0.0.1:8080, SPA fallback, `/api` proxy). Nothing to edit if the repo lives at `~/noxware`. Test it:

```bash
caddy validate --config ~/noxware/deploy/termux/Caddyfile
```

## 7. Cloudflare Tunnel (public HTTPS)

```bash
cloudflared tunnel login
# it prints a URL — long-press to copy, open in your browser, authorize noxware.cc
cloudflared tunnel create noxware
cloudflared tunnel route dns noxware noxware.cc
cloudflared tunnel route dns noxware www.noxware.cc
```

Then write the config (replace `TUNNEL_ID` with the ID printed by `tunnel create`):

```bash
mkdir -p ~/.cloudflared
nano ~/.cloudflared/config.yml
```

```yaml
tunnel: TUNNEL_ID
credentials-file: /data/data/com.termux/files/home/.cloudflared/TUNNEL_ID.json
ingress:
  - hostname: noxware.cc
    service: http://127.0.0.1:8080
  - hostname: www.noxware.cc
    service: http://127.0.0.1:8080
  - service: http_status:404
```

> If `route dns` fails with "record already exists", delete the old `noxware.cc` / `www` **A records** in the Cloudflare dashboard first (they pointed at a VPS; a tunnel uses CNAMEs instead).

## 8. Start everything

```bash
cd ~/noxware
bash deploy/termux/start.sh
```

The script takes a wake lock, starts **node + caddy + cloudflared** each inside a restart-loop, and logs to `~/noxware/logs/`. Then seed your invite codes once:

```bash
npm run invite -- NOX-LAUNCH-2026 100
```

## 9. Verify

```bash
curl -s https://noxware.cc/api/health
```

Open `https://noxware.cc` in a browser: storefront loads, signup works with your invite code, `https://noxware.cc/docs` shows the OpenAPI UI.

## 10. External callbacks

- **NOWPayments** dashboard → IPN callback URL: `https://noxware.cc/api/webhooks/nowpayments` (single-host mode — no `api.` subdomain).
- **Email worker** (`deploy/email-worker/`): unchanged, runs in Cloudflare's cloud. Set `API_URL = "https://noxware.cc/api/mail/inbound"` in `wrangler.toml`, `npx wrangler secret put INBOUND_SECRET` (same value as `MAIL_INBOUND_SECRET`), `npx wrangler deploy`, then Email Routing → catch-all → worker. Test: email `support@noxware.cc` from an account address → ticket appears.

## 11. Keep it alive (important on Android)

1. **Battery**: Android Settings → Apps → Termux → Battery → **Unrestricted** (kill the optimizer or it will freeze Termux overnight).
2. Keep the phone **plugged in**.
3. `start.sh` holds a wake lock; leaving the Termux app open (or in recents) is safest. Do **not** swipe Termux away.
4. After a phone reboot, re-run `bash ~/noxware/deploy/termux/start.sh` — or automate it with **Termux:Boot** (F-Droid add-on):

```bash
mkdir -p ~/.termux/boot
echo '#!/data/data/com.termux/files/usr/bin/bash
bash ~/noxware/deploy/termux/start.sh' > ~/.termux/boot/noxware
chmod +x ~/.termux/boot/noxware
```

## 12. Day-2

```bash
bash deploy/termux/stop.sh        # stop all three
bash deploy/termux/start.sh       # start again
tail -f ~/noxware/logs/api.log    # API logs (same for caddy.log / tunnel.log)

# update
cd ~/noxware && git pull && npm install && npm run build && bash deploy/termux/stop.sh && bash deploy/termux/start.sh

# backup the database (SQLite is one file)
cp ~/noxware/server/data/noxware.sqlite /sdcard/Download/noxware-$(date +%F).sqlite
```

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `npm install` fails on `better-sqlite3` | Confirm `pkg install build-essential binutils python` all installed; re-run install |
| Site 502 / connection refused | `tail logs/api.log` — node crashed; `curl -s 127.0.0.1:3001/api/health` locally |
| Site timeout from outside | `tail logs/tunnel.log`; check `cloudflared tunnel list` shows the tunnel healthy; phone awake? |
| **Error 522 from Cloudflare** | Cloudflare can't reach cloudflared. In order: (1) is the tunnel connected? `cloudflared tunnel info noxware` and `tail -n 30 logs/tunnel.log` — you want `Registered tunnel connection` lines, not reconnect loops. (2) Is Caddy up? `curl -s http://127.0.0.1:8080/api/health` on the phone. (3) Phone asleep / Termux killed? Re-run `start.sh`, battery → Unrestricted. (4) DNS: `noxware.cc` must be a **CNAME → `<TUNNEL_ID>.cfargotunnel.com` (proxied)** — a leftover A record pointing anywhere will 522/1033. (5) Carrier blocks QUIC? If tunnel.log shows QUIC timeouts, run cloudflared with `--protocol http2`. |
| `route dns` record conflict | Delete stale A records for that hostname in Cloudflare DNS |
| Everything died overnight | Battery optimization re-enabled? Termux swiped away? Re-run start.sh, recheck step 11 |
