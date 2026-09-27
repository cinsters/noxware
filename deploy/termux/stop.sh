#!/data/data/com.termux/files/usr/bin/bash
# Stop the Termux stack started by start.sh.

set -u
LOGS="$HOME/noxware/logs"

for name in api caddy tunnel; do
  if [ -f "$LOGS/$name.pid" ]; then
    pid=$(cat "$LOGS/$name.pid")
    if kill "$pid" 2>/dev/null; then
      # kill the whole loop's process group children too (node/caddy/cloudflared)
      pkill -P "$pid" 2>/dev/null
      echo "stopped $name (pid $pid)"
    fi
    rm -f "$LOGS/$name.pid"
  fi
done

# Belt and suspenders: any strays still bound to our ports/processes —
# including orphaned run_loop subshells from an earlier start.sh run that
# never got stopped (they keep respawning their service forever otherwise).
pkill -f "termux/start.sh" 2>/dev/null
pkill -f "cloudflared tunnel run" 2>/dev/null
pkill -f "caddy run --config $HOME/noxware" 2>/dev/null
pkill -f "node server/index.js" 2>/dev/null

termux-wake-unlock 2>/dev/null || true
echo "Noxware stopped."
