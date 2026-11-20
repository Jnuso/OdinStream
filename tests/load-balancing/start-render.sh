#!/usr/bin/env bash
set -eu

python -m uvicorn app.main:app --host 127.0.0.1 --port 8001 &
api_a=$!
python -m uvicorn app.main:app --host 127.0.0.1 --port 8002 &
api_b=$!
caddy run --config Caddyfile --adapter caddyfile &
proxy=$!

cleanup() {
    kill "$proxy" "$api_a" "$api_b" 2>/dev/null || true
    wait || true
}
trap cleanup EXIT
trap 'exit 0' TERM INT

# A crashed worker is removed by Caddy. Render can restart the whole lab if
# Caddy or both workers stop. Do not expose worker controls over HTTP.
wait -n "$api_a" "$api_b" "$proxy" || true
if kill -0 "$proxy" 2>/dev/null && { kill -0 "$api_a" 2>/dev/null || kill -0 "$api_b" 2>/dev/null; }; then
    wait -n "$api_a" "$api_b" "$proxy" 2>/dev/null || true
fi
exit 1
