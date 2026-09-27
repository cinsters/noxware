#!/data/data/com.termux/files/usr/bin/bash
# Tunnel launcher used by start.sh.
#
# Bare `cloudflared tunnel run` — no --config flag (the default
# ~/.cloudflared/config.yml is read automatically) and no tunnel-name argument
# (some builds reject it; the ID comes from the config). This exact invocation
# is the one verified working interactively on the target device.
exec cloudflared tunnel run
