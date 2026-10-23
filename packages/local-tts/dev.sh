#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$SCRIPT_DIR/backend"
FRONTEND_DIR="$SCRIPT_DIR/web-ui"

cleanup() {
  echo ""
  echo "Shutting down..."
  kill "$BACKEND_PID" "$FRONTEND_PID" 2>/dev/null || true
  wait "$BACKEND_PID" "$FRONTEND_PID" 2>/dev/null || true
  echo "Done."
}
trap cleanup SIGINT SIGTERM

echo "Preparing the Python backend environment…"
if [ ! -x "$BACKEND_DIR/.venv/bin/python" ]; then
  (cd "$BACKEND_DIR" && python3 -m venv .venv && .venv/bin/pip install -q -r requirements.txt)
else
  (cd "$BACKEND_DIR" && .venv/bin/pip install -q -r requirements.txt)
fi

echo "Installing frontend dependencies (web-ui)…"
(cd "$FRONTEND_DIR" && npm install --silent)

echo "Starting backend (piper service)…"
(cd "$BACKEND_DIR" && .venv/bin/python main.py --host 0.0.0.0 --port 7878 > "$SCRIPT_DIR/.local-tts-backend.log" 2>&1) &
BACKEND_PID=$!

echo "Starting frontend (dev-console)…"
(cd "$FRONTEND_DIR" && npm run dev > "$SCRIPT_DIR/.local-tts-frontend.log" 2>&1) &
FRONTEND_PID=$!

echo ""
echo "Backend  → http://localhost:7878  (API + logs stream; piper-tts installs from the UI)"
echo "Frontend → http://localhost:4000  (proxies /api → backend)"
echo "Voices   → backend/data/voices (changeable in the UI)"
echo ""
echo "Press Ctrl+C to stop both."
echo ""

wait "$BACKEND_PID" "$FRONTEND_PID"
