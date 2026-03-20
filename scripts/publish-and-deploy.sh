#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET_BRANCH="${PUBLISH_BRANCH:-main}"
TARGET_REMOTE="${PUBLISH_REMOTE:-origin}"
COMMIT_MESSAGE="${1:-}"

cd "$ROOT_DIR"

CURRENT_BRANCH="$(git branch --show-current)"
if [[ "$CURRENT_BRANCH" != "$TARGET_BRANCH" ]]; then
  echo "[publish] Current branch is '$CURRENT_BRANCH'. Switch to '$TARGET_BRANCH' before publishing." >&2
  exit 1
fi

if [[ -z "$COMMIT_MESSAGE" ]]; then
  read -r -p "Commit message: " COMMIT_MESSAGE
fi

if [[ -z "$COMMIT_MESSAGE" ]]; then
  echo "[publish] Commit message is required." >&2
  exit 1
fi

echo "[publish] Staging changes"
git add -A

if git diff --cached --quiet; then
  echo "[publish] No staged changes. Nothing to publish."
  exit 0
fi

echo "[publish] Creating commit"
git commit -m "$COMMIT_MESSAGE"

echo "[publish] Pushing to ${TARGET_REMOTE}/${TARGET_BRANCH}"
git push "$TARGET_REMOTE" "$TARGET_BRANCH"

echo "[publish] Push completed. GitHub Actions will continue the EC2 deployment."
