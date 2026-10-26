#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$SCRIPT_DIR/mythgram"
FRONTEND_DIR="$SCRIPT_DIR/frontend-main"

cleanup() {
  echo ""
  echo "Shutting down..."
  kill "$BACKEND_PID" "$FRONTEND_PID" 2>/dev/null
  wait "$BACKEND_PID" "$FRONTEND_PID" 2>/dev/null
  echo "Done."
}
trap cleanup SIGINT SIGTERM

echo "Installing backend dependencies (mythgram)…"
cd "$BACKEND_DIR"
npm install --silent

echo "Installing frontend dependencies (dev-console)…"
cd "$FRONTEND_DIR"
npm install --silent

echo "Starting backend (mythgram)…"
echo "  → SQLite database is created/opened automatically at <workspace>/.mythgram/mythgram.db"
cd "$BACKEND_DIR"
npm run dev > "$SCRIPT_DIR/.mythgram-backend.log" 2>&1 &
BACKEND_PID=$!

echo "Starting frontend (dev-console)…"
cd "$FRONTEND_DIR"
npm run dev > "$SCRIPT_DIR/.mythgram-frontend.log" 2>&1 &
FRONTEND_PID=$!

echo ""
echo "Backend  → http://localhost:8787  (health: http://localhost:8787/health)"
echo "Frontend → http://localhost:5173  (proxies /api → backend, reads from the local SQLite DB)"
echo "Database → mythgram/workspace/.mythgram/mythgram.db (SQLite, WAL mode — auto-created)"
echo ""
echo "Press Ctrl+C to stop both."
echo ""

wait "$BACKEND_PID" "$FRONTEND_PID"
