#!/usr/bin/env bash
#
# dev.sh — start the Mythgram backend and web console together in development.
#
# Unlike the root start.sh, this script:
#   • installs dependencies first when node_modules is missing,
#   • writes timestamped logs under .logs/ at the repo root,
#   • waits for the backend health endpoint before printing the URLs,
#   • cleanly shuts both processes down on Ctrl+C / SIGTERM.
#
# Ports (override via env):
#   PORT        backend API + dev console     (default 8787)
#   VITE_PORT   Vite dev server               (default 5173)
#
# Usage:
#   ./scripts/dev.sh
#   PORT=9000 VITE_PORT=6000 ./scripts/dev.sh

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

BACKEND="$ROOT_DIR/packages/mythgram"
FRONTEND="$ROOT_DIR/packages/frontend-main"
LOG_DIR="$ROOT_DIR/.logs"

PORT="${PORT:-8787}"
FRONTEND_PORT="${VITE_PORT:-5173}"
API_URL="${MYTHGRAM_API_URL:-http://localhost:$PORT}"

mkdir -p "$LOG_DIR"
BACKEND_LOG="$LOG_DIR/backend.dev.log"
FRONTEND_LOG="$LOG_DIR/frontend.dev.log"

ensure_deps() {
  local dir="$1" name="$2"
  if [ ! -d "$dir/node_modules" ]; then
    printf '\033[1;36m==>\033[0m Installing %s dependencies (first run)\n' "$name"
    npm --prefix "$dir" install --no-audit --no-fund || exit 1
  fi
}

cleanup() {
  printf '\nShutting down...\n'
  [ -n "${BACKEND_PID:-}" ] && kill "$BACKEND_PID" 2>/dev/null
  [ -n "${FRONTEND_PID:-}" ] && kill "$FRONTEND_PID" 2>/dev/null
  wait "${BACKEND_PID:-}" "${FRONTEND_PID:-}" 2>/dev/null
  printf 'Done. Logs: %s\n' "$LOG_DIR"
}
trap cleanup SIGINT SIGTERM

wait_for_health() {
  local deadline=$((SECONDS + 40))
  while [ "$SECONDS" -lt "$deadline" ]; do
    if command -v curl >/dev/null 2>&1; then
      curl -fsS "http://localhost:$PORT/health" >/dev/null 2>&1 && return 0
    else
      return 0
    fi
    sleep 0.5
  done
  return 1
}

ensure_deps "$BACKEND" "mythgram"
ensure_deps "$FRONTEND" "frontend-main"

printf '\033[1;36m==>\033[0m Starting backend on :%s\n' "$PORT"
PORT="$PORT" npm --prefix "$BACKEND" run dev >"$BACKEND_LOG" 2>&1 &
BACKEND_PID=$!

printf '\033[1;36m==>\033[0m Starting frontend on :%s\n' "$FRONTEND_PORT"
PORT="$PORT" VITE_PORT="$FRONTEND_PORT" MYTHGRAM_API_URL="$API_URL" \
  npm --prefix "$FRONTEND" run dev >"$FRONTEND_LOG" 2>&1 &
FRONTEND_PID=$!

if wait_for_health; then
  printf '\n  Backend  → http://localhost:%s  (health: /health)\n' "$PORT"
else
  printf '\n  Backend is still starting — watch %s\n' "$BACKEND_LOG"
fi
printf '  Console  → http://localhost:%s\n' "$FRONTEND_PORT"
printf '  Logs     → %s\n\n' "$LOG_DIR"
printf 'Press Ctrl+C to stop both.\n\n'

wait "$BACKEND_PID" "$FRONTEND_PID"
