#!/usr/bin/env bash
#
# healthcheck.sh — probe the Mythgram backend health endpoint.
#
# Exit 0 when healthy, non-zero otherwise. Useful for systemd ExecStartPost,
# cron monitors, uptime probes, or Docker HEALTHCHECK.
#
# Usage:
#   PORT=8787 ./deploy/examples/healthcheck.sh
#   ./deploy/examples/healthcheck.sh https://mythgram.example.com

set -euo pipefail

BASE="${1:-http://localhost:${PORT:-8787}}"
URL="${BASE%/}/health"
TIMEOUT="${HEALTHCHECK_TIMEOUT:-5}"

if ! command -v curl >/dev/null 2>&1; then
  echo "healthcheck: curl is required" >&2
  exit 2
fi

BODY="$(curl -fsS --max-time "$TIMEOUT" "$URL")" || {
  echo "healthcheck: FAIL — no response from $URL" >&2
  exit 1
}

if command -v jq >/dev/null 2>&1; then
  STATUS="$(printf '%s' "$BODY" | jq -r '.status // "unknown"')"
  echo "healthcheck: $STATUS — $URL"
  [ "$STATUS" = "healthy" ] || exit 1
else
  echo "healthcheck: OK — $URL"
fi
