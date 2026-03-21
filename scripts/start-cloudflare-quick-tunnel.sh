#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_PORT="${APP_PORT:-4173}"
RUN_DIR="$ROOT_DIR/.run"
PID_FILE="$RUN_DIR/cloudflared.pid"
LOG_FILE="${CLOUDFLARE_TUNNEL_LOG_FILE:-/tmp/3d-earth-cloudflared.log}"
TUNNEL_TIMEOUT_SECONDS="${CLOUDFLARE_TUNNEL_TIMEOUT_SECONDS:-45}"
TUNNEL_URL_REGEX='https://[-a-zA-Z0-9]+\.trycloudflare\.com'

mkdir -p "$RUN_DIR"

if ! command -v cloudflared >/dev/null 2>&1; then
  echo "[tunnel] cloudflared command was not found on the EC2 instance." >&2
  exit 1
fi

if [[ -f "$PID_FILE" ]]; then
  OLD_PID="$(cat "$PID_FILE" 2>/dev/null || true)"
  if [[ -n "$OLD_PID" ]] && kill -0 "$OLD_PID" 2>/dev/null; then
    echo "[tunnel] Stopping previous cloudflared process $OLD_PID"
    kill "$OLD_PID" 2>/dev/null || true
    for _ in {1..20}; do
      if ! kill -0 "$OLD_PID" 2>/dev/null; then
        break
      fi
      sleep 0.5
    done
  fi
  rm -f "$PID_FILE"
fi

: >"$LOG_FILE"
echo "[tunnel] Starting Cloudflare quick tunnel for http://127.0.0.1:${APP_PORT}"
nohup cloudflared tunnel --url "http://127.0.0.1:${APP_PORT}" --no-autoupdate >"$LOG_FILE" 2>&1 &
NEW_PID=$!
echo "$NEW_PID" >"$PID_FILE"

for ((second=0; second<TUNNEL_TIMEOUT_SECONDS; second++)); do
  URL="$(grep -Eo "$TUNNEL_URL_REGEX" "$LOG_FILE" | tail -n 1 || true)"
  if [[ -n "$URL" ]]; then
    echo "$URL"
    exit 0
  fi
  if ! kill -0 "$NEW_PID" 2>/dev/null; then
    break
  fi
  sleep 1
done

echo "[tunnel] Failed to obtain a trycloudflare URL. Last log lines:" >&2
tail -n 40 "$LOG_FILE" >&2 || true
exit 1
