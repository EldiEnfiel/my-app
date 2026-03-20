#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_PORT="${APP_PORT:-4173}"
PID_DIR="$ROOT_DIR/.run"
PID_FILE="$PID_DIR/3d-earth.pid"
LOG_FILE="${DEPLOY_LOG_FILE:-/tmp/3d-earth.log}"

mkdir -p "$PID_DIR"
cd "$ROOT_DIR"

echo "[deploy] Installing production dependencies"
npm ci --no-fund --no-audit

if [[ -f "$PID_FILE" ]]; then
  OLD_PID="$(cat "$PID_FILE")"

  if [[ -n "$OLD_PID" ]] && kill -0 "$OLD_PID" 2>/dev/null; then
    echo "[deploy] Stopping previous process $OLD_PID"
    kill "$OLD_PID"

    for _ in {1..20}; do
      if ! kill -0 "$OLD_PID" 2>/dev/null; then
        break
      fi

      sleep 0.5
    done
  fi

  rm -f "$PID_FILE"
fi

if command -v fuser >/dev/null 2>&1; then
  fuser -k "${APP_PORT}/tcp" >/dev/null 2>&1 || true
fi

echo "[deploy] Starting public web server on port ${APP_PORT}"
nohup npm run start:public >"$LOG_FILE" 2>&1 &
NEW_PID=$!
echo "$NEW_PID" >"$PID_FILE"

for _ in {1..30}; do
  if curl --silent --fail "http://127.0.0.1:${APP_PORT}/" >/dev/null; then
    echo "[deploy] Deployment succeeded. PID=${NEW_PID}"
    exit 0
  fi

  sleep 1
done

echo "[deploy] Deployment failed. Last server log lines:" >&2
tail -n 40 "$LOG_FILE" >&2 || true
exit 1
