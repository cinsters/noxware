# Noxware Launcher Integration — API Contract

**Status: contract draft v1** (2026-09-27).

Sections marked **[EXISTS]** are live on `https://noxware.cc` today. Sections marked
**[PROPOSED]** are the backend contract the launcher and website should build against;
server implementations are pending and tracked in the checklist at the end. Each shipped
endpoint gets added to `docs/openapi.yaml` (Swagger UI: `/docs`).

**Base URLs**

| Environment | URL | Notes |
|---|---|---|
| Production + staging | `https://noxware.cc` | phone deploy; test accounts seeded |
| Local dev | `http://127.0.0.1:3001` | `npm run dev` |

All authenticated calls use `Authorization: Bearer <token>`. Errors are JSON: `{ "error": "message" }`
(`[PROPOSED]` endpoints additionally return a machine-readable `code` field).

---

## 1. Auth model today [EXISTS]

- `POST /api/auth/login` → `{ token, user, subscription }`. JWT (HS256, `sub` = user id), **14-day** expiry.
- Every request re-reads role/ban state from the DB; banned accounts get `403 {"error":"Account banned"}` even with a valid token.
- Limitations for the launcher: one long-lived token, no refresh rotation, no revocation, no device binding. The launcher-specific contracts below fix exactly these.

---

## 2. Browser sign-in with PKCE [PROPOSED]

The launcher never sees the user's password. It opens the default browser; the user approves
with their existing website session.

**Flow**

```
Launcher                          Website (browser)                       API
   │ 1. start loopback server 127.0.0.1:<ephemeral port>                │
   │ 2. code_verifier (43–128 chars) + S256 code_challenge               │
   │ 3. open browser ──────────────▶ GET /launcher/authorize?...         │
   │                                   │ 4. user approves (session cookie)│
   │                                   ├─────────────────────────────────▶│ create auth code
   │ ◀── 302 redirect_uri?code=...&state=... ─────────────────────────────┤
   │ 5. verify state                                                     │
   │ 6. POST /api/launcher/token (code + code_verifier) ────────────────▶│
   │ ◀── { access_token, refresh_token, user } ───────────────────────────┤
```

**Authorize URL** (opened in the default browser):

```
GET https://noxware.cc/launcher/authorize
  ?response_type=code
  &client_id=nox-launcher
  &redirect_uri=http://127.0.0.1:{port}/callback
  &scope=launch
  &state={random 128-bit, URL-safe}
  &code_challenge={BASE64URL(SHA256(code_verifier))}
  &code_challenge_method=S256
```

- `redirect_uri` **must** be loopback `http://127.0.0.1:<port>/callback` (any port). Other schemes are rejected.
- If the browser has no website session, the page redirects to the normal login/register form first, then returns to the consent step.
- Consent page shows: account identity, requested scope (`launch`), and a Approve / Deny choice. Deny → redirect with `?error=access_denied`.

**Token exchange:**

```
POST /api/launcher/token
{
  "grant_type": "authorization_code",
  "code": "<opaque auth code>",
  "code_verifier": "<the verifier>",
  "redirect_uri": "http://127.0.0.1:{port}/callback",
  "client_id": "nox-launcher"
}

→ 200 {
  "access_token": "<JWT, aud=launcher, 1h>",
  "refresh_token": "<opaque, rotating>",
  "token_type": "Bearer",
  "expires_in": 3600,
  "user": { "id": 7, "username": "jane", "role": "customer" }
}
```

**Rules**

- Auth codes are single-use, TTL **120 s**, bound to `client_id` + `code_challenge` + `redirect_uri`.
- `code_verifier` is never sent to the browser; only the S256 challenge leaves the launcher.
- Access tokens carry `aud: "launcher"` and are accepted **only** by `/api/launcher/*` endpoints; website tokens stay separate audiences.
- Rate limit: 5 authorize attempts / minute / account; 10 token exchanges / minute / IP.

---

## 3. Session refresh, logout, revocation [PROPOSED]

| Endpoint | Auth | Purpose |
|---|---|---|
| `POST /api/launcher/token` (`grant_type=refresh_token`) | refresh token | Rotate session |
| `GET /api/launcher/sessions` | launcher access token | List own sessions |
| `POST /api/launcher/sessions/current/revoke` | launcher access token | Log out this device |
| `POST /api/launcher/sessions/revoke-all` | launcher access token | Log out everywhere |

**Refresh (rotation with reuse detection):**

```
POST /api/launcher/token
{ "grant_type": "refresh_token", "refresh_token": "<current>" }

→ 200 { access_token, refresh_token, token_type, expires_in }   // both rotate
→ 401 { "error": "Session revoked", "code": "SESSION_REVOKED" }
```

Presenting a **previously-rotated** refresh token is treated as theft: the whole session
family is revoked and the response is the same 401. The launcher must then re-run browser sign-in.

**Session list:**

```
GET /api/launcher/sessions
→ 200 { "sessions": [ { "id": "ls_01H…", "deviceLabel": "Gaming PC", "platform": "windows",
                        "createdAt": "...", "lastSeenAt": "...", "current": true } ] }
```

**Notes**

- Logout (`.../current/revoke`) deletes the session row; the paired refresh token dies with it. Short-lived access tokens simply expire (≤ 1 h).
- Staff parity: Admin → Users gains a "Revoke sessions" action (audited as `user.revoke_sessions`). Website 14-day tokens are unaffected by launcher sessions and vice versa.

---

## 4. HWID / device registration, limits, resets [EXISTS]

**HWID format** — opaque ASCII, 16–128 chars, launcher-generated. Recommended: salted hash of
stable identifiers (e.g. machine GUID + motherboard serial), never raw serials. The server
stores and compares hashes only.

| Endpoint | Auth | Purpose |
|---|---|---|
| `POST /api/launcher/devices` | launcher access token | Register/update this device |
| `POST /api/launcher/devices/reset` | **website** token | Self-serve reset (own account) |
| `POST /api/admin/users/:id/reset-devices` | admin | Staff reset (audited) |

**Register:**

```
POST /api/launcher/devices
{ "hwid": "a91f…", "deviceLabel": "Gaming PC", "platform": "windows" }

→ 200 { "deviceId": "ld_01H…", "deviceLimit": 2,
        "devices": [ { "id": "…", "label": "Gaming PC", "lastSeenAt": "…" } ] }
→ 409 { "error": "Device limit reached (2)", "code": "DEVICE_LIMIT", "devices": [ ... ] }
```

- Re-posting an **already-registered** hwid just updates `lastSeenAt` / label (idempotent) — no limit interaction.
- Default limit: **2 devices per account** (`DEVICE_LIMIT_PER_USER`, env-tunable). Lifetime grants may raise it later via a per-user override.
- 409 responses include the device list so the launcher can show "you have 2 devices; reset at noxware.cc/dashboard".

**Hardware-change reset** (user replaced motherboard/disk, reinstalled Windows, etc.):

- Self-serve: Dashboard → Devices → "Reset devices". Clears all devices **and** launcher sessions for the account. Rate-limited to **once every 3 months** (90 days, `DEVICE_RESET_COOLDOWN_DAYS` env-tunable; `code: DEVICE_RESET_COOLDOWN` with `nextAllowedAt`).
- Staff: Admin reset has no cooldown and is audit-logged (`user.reset_devices`) — use it for support tickets where the user lost access to the site too.

---

## 5. Launch eligibility check [EXISTS]

One call the launcher makes before injecting — confirms account, subscription, and device in one shot:

```
POST /api/launcher/launch-check          (Authorization: Bearer <launcher access token>)
{ "hwid": "a91f…" }

→ 200 {
  "allowed": true,
  "user": { "id": 7, "username": "jane", "planId": "3m", "expiresAt": "2026-12-01T00:00:00Z" },
  "build": { "platform": "windows", "version": "1.4.3", "sha256": "…", "sizeBytes": 5242880,
             "url": "/api/downloads/file/1?expires=…&sig=…",   // 2-min signed URL
             "urlExpiresIn": 120 }
}
```

Failure modes (machine codes in the body, correct HTTP statuses):

| HTTP | `code` | Meaning |
|---|---|---|
| 403 | `ACCOUNT_BANNED` | Banned (checked server-side regardless of token) |
| 403 | `SUB_INACTIVE` | No active subscription — open store / redeem key |
| 403 | `SESSION_REVOKED` | Session was revoked or rotated elsewhere |
| 409 | `DEVICE_UNREGISTERED` | hwid not registered → call `POST /devices` first |
| 409 | `DEVICE_LIMIT` | New device beyond limit — reset needed |
| 404 | `BUILD_MISSING` | No active build for the platform (staff must upload) |

The returned signed `build.url` doubles as the auto-update fetch: compare `sha256` with the
locally running binary, download if different, then launch.

**Exists today [EXISTS]** (launcher v1 can ship on these alone, before the consolidated check):

- `GET /api/downloads/:platform/meta` — active build metadata (any signed-in user).
- `GET /api/downloads/:platform` — **2-minute signed download URL**, requires an active subscription; enforces ban + subscription server-side.

---

## 6. Automatic updates [PROPOSED]

```
GET /api/launcher/latest?platform=windows&current=1.4.2

→ 200 { "version": "1.4.3", "sha256": "…", "sizeBytes": 5242880,
        "mandatory": true, "notes": "Signature scanner update",
        "url": null }              // signed only when a valid launcher token is attached
```

- Public metadata (version/hash/size) so the launcher can *check* silently; the signed `url`
  appears only with `Authorization: Bearer <launcher access token>` + eligible account.
- `mandatory: true` until staff-requested optional channel exists. Launcher policy: if
  `current != version` → download via signed URL, verify SHA-256, swap binary, relaunch.

---

## 7. Staging test accounts [EXISTS]

Seeded by `npm run seed:test-accounts` (idempotent upsert — safe to re-run on staging):

| Role | Email | Password | Extras |
|---|---|---|---|
| customer | `test@noxware.app` | `Test1234!` | active 3-month sub, test key `NOX-TEST-KEY1-0001`, demo ticket |
| support | `support@noxware.app` | `Test1234!` | staff queue access |
| admin | `admin@noxware.app` | `Test1234!` | full admin panel |

- Test invite code: `NOX-LAUNCH-2026` (100 uses).
- **HWID testing:** the seed pre-registers 2 devices on `test@noxware.app` — raw test hwids
  `TESTHWID-GAMING-PC-00000001` and `TESTHWID-LAPTOP-000000000002` — so the `DEVICE_LIMIT` (409)
  path is testable out of the box, and a third registration attempt returns 409 immediately.
- Sandbox payments: set `NOWPAYMENTS_API_BASE=https://api.sandbox.nowpayments.io/v1` in the env.
- **HWID testing:** device endpoints don't exist yet; when they ship, the seed will pre-register
  2 devices on `test@noxware.app` so the `DEVICE_LIMIT` (409) path is testable out of the box.
- ⚠️ Re-running the seed **resets the trio's passwords**. Never run it on production casually.

---

## 8. Backend implementation checklist

1. ~~**Tables**: `launcher_devices`~~ **[DONE]** · still needed: `launcher_sessions` (id, user_id, refresh_hash, device_id, created/rotated/last_seen, revoked_at) · `launcher_auth_codes` (code_hash, user_id, challenge, redirect_uri, expires, consumed).
2. **PKCE authorize page** on the website (`/launcher/authorize`) + consent UI. [PROPOSED]
3. **`POST /api/launcher/token`** — authorization_code + refresh_token grants, rotation + reuse detection, `aud: "launcher"` JWTs (1 h). [PROPOSED]
4. ~~**Devices**: register (limit 2, idempotent re-post), list, self-serve reset (7-day cooldown), admin reset~~ **[DONE]** — `/api/launcher/devices`, `/api/launcher/devices/reset`, `/api/admin/users/:id/reset-devices`; documented in `docs/openapi.yaml`.
5. ~~**`POST /api/launcher/launch-check`**~~ **[DONE]** — sub + ban + device in one call, returns signed build URL; documented in `docs/openapi.yaml`. (Currently authenticates with the website JWT; revisit after `aud: "launcher"` tokens ship.)
6. **`GET /api/launcher/latest`** — public update metadata, signed URL for eligible tokens. [PROPOSED — interim: `GET /api/downloads/:platform/meta` + launch-check cover this]
7. **Session management**: list / revoke current / revoke all + admin revoke action (audited). [PROPOSED]
8. ~~**OpenAPI**: `/api/launcher/*` paths + Device/DeviceError/LaunchCheck schemas~~ **[DONE]** — live in Swagger UI at `/docs`.
9. ~~**Seed update**: pre-registered devices on `test@noxware.app`~~ **[DONE]**.
