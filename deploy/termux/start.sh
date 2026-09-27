#!/data/data/com.termux/files/usr/bin/bash
# Noxware on Termux — start node API + caddy + cloudflared, each in a restart loop.
# Stop with deploy/termux/stop.sh. Logs in ~/noxware/logs/.

set -u

ROOT="$HOME/noxware"
LOGS="$ROOT/logs"
mkdir -p "$LOGS"

if [ ! -f "$ROOT/dist/index.html" ]; then
  echo "ERROR: $ROOT/dist/index.html missing — run 'npm run build' first." >&2
  exit 1
fi
if [ ! -f "$ROOT/.env" ]; then
  echo "ERROR: $ROOT/.env missing — copy and fill .env.example first (see deploy/termux/README.md)." >&2
  exit 1
fi
if ! command -v cloudflared >/dev/null || ! command -v caddy >/dev/null; then
  echo "ERROR: caddy/cloudflared not installed — pkg install -y caddy cloudflared" >&2
  exit 1
fi
if [ ! -f "$HOME/.cloudflared/config.yml" ]; then
  echo "ERROR: ~/.cloudflared/config.yml missing — finish tunnel setup (step 7 of deploy/termux/README.md)." >&2
  exit 1
fi
if grep -qE 'TUNNEL_ID|<UUID>' "$HOME/.cloudflared/config.yml"; then
  echo "ERROR: ~/.cloudflared/config.yml still contains a placeholder (TUNNEL_ID or <UUID>)." >&2
  echo "  Get your tunnel id:  cloudflared tunnel list" >&2
  echo "  Then substitute it:  sed -i \"s|PLACEHOLDER|YOUR_REAL_UUID|g\" ~/.cloudflared/config.yml" >&2
  echo "  (both lines: 'tunnel:' and 'credentials-file:')" >&2
  exit 1
fi
CRED_FILE=$(grep 'credentials-file:' "$HOME/.cloudflared/config.yml" | awk '{print $2}')
if [ -n "$CRED_FILE" ] && [ ! -f "$CRED_FILE" ]; then
  echo "ERROR: tunnel credentials file not found: $CRED_FILE" >&2
  echo "  The file is created by: cloudflared tunnel create noxware" >&2
  echo "  Re-run that, then set credentials-file to the real path ~/.cloudflared/YOUR_TUNNEL_UUID.json" >&2
  exit 1
fi

# Keep the CPU awake while serving.
termux-wake-lock 2>/dev/null || true

cd "$ROOT"

run_loop() { # $1 name, $2 command...
  local name="$1"; shift
  (
    while true; do
      echo "[$(date -u +%FT%TZ)] starting $name" >> "$LOGS/$name.log"
      "$@" >> "$LOGS/$name.log" 2>&1
      echo "[$(date -u +%FT%TZ)] $name exited (code $?) — restarting in 2s" >> "$LOGS/$name.log"
      sleep 2
    done
  ) &
  echo $! > "$LOGS/$name.pid"
}

run_loop api       node server/index.js
run_loop caddy     caddy run --config "$ROOT/deploy/termux/Caddyfile"
# Run the tunnel through a wrapper: bare `cloudflared tunnel run` with no flags
# and no args — the invocation verified working on the device (some builds choke
# on --config placement and on the tunnel-name argument).
run_loop tunnel    "$ROOT/deploy/termux/tunnel-run.sh"

sleep 2
echo "Noxware started on Termux:"
echo "  local :  http://127.0.0.1:8080"
echo "  public:  https://noxware.cc"
echo "  logs  :  $LOGS/{api,caddy,tunnel}.log"
echo "  stop  :  bash deploy/termux/stop.sh"
