#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_PORT="${THREE_D_EARTH_APP_PORT:-${APP_PORT:-4173}}"
SKIP_TUNNEL=0
VALIDATE_ONLY=0

for arg in "$@"; do
  case "$arg" in
    -SkipDiscord|--skip-discord)
      ;;
    -SkipTunnel|--skip-tunnel)
      SKIP_TUNNEL=1
      ;;
    -ValidateOnly|--validate-only)
      VALIDATE_ONLY=1
      ;;
    *)
      echo "[startup] Ignoring unsupported argument: $arg" >&2
      ;;
  esac
done

cd "$ROOT_DIR"

if [[ "$VALIDATE_ONLY" -eq 1 ]]; then
  echo "[validate] project root: $ROOT_DIR"
  echo "[validate] deploy script: $ROOT_DIR/scripts/deploy-on-ec2.sh"
  if [[ ! -f "$ROOT_DIR/scripts/deploy-on-ec2.sh" ]]; then
    echo "[validate] deploy script is missing." >&2
    exit 1
  fi

  if [[ "$SKIP_TUNNEL" -eq 0 ]]; then
    if [[ ! -f "$ROOT_DIR/scripts/start-cloudflare-quick-tunnel.sh" ]]; then
      echo "[validate] quick tunnel script is missing." >&2
      exit 1
    fi
    if ! command -v cloudflared >/dev/null 2>&1; then
      echo "[validate] cloudflared command was not found." >&2
      exit 1
    fi
  fi

  echo "[validate] app port: $APP_PORT"
  exit 0
fi

APP_PORT="$APP_PORT" bash ./scripts/deploy-on-ec2.sh

if [[ "$SKIP_TUNNEL" -eq 1 ]]; then
  URL="http://127.0.0.1:${APP_PORT}/"
else
  TUNNEL_OUTPUT="$(APP_PORT="$APP_PORT" bash ./scripts/start-cloudflare-quick-tunnel.sh)"
  URL="$(printf '%s\n' "$TUNNEL_OUTPUT" | grep -Eo 'https://[-a-zA-Z0-9]+\.trycloudflare\.com' | tail -n 1 || true)"
  if [[ -z "$URL" ]]; then
    echo "$TUNNEL_OUTPUT" >&2
    echo "[startup] Failed to extract a trycloudflare URL from the tunnel output." >&2
    exit 1
  fi
fi

TIMESTAMP="$(date '+%Y-%m-%d %H:%M:%S %z')"

echo "3D Earth Explorer is online."
echo "URL: $URL"
echo "Deploy Path: $ROOT_DIR"
echo "Timestamp: $TIMESTAMP"
