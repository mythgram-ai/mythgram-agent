#!/usr/bin/env bash
#
# build.sh — produce the publishable artifact for the unified Mythgram package.
#
# Builds the backend (tsc → packages/mythgram/dist) and then the frontend
# (Vite → packages/mythgram/dist/web), which is exactly what `npm publish`
# ships. The backend serves both the API and the bundled console on one port.
#
# Usage:
#   ./scripts/build.sh                  # typecheck + backend build + frontend build
#   ./scripts/build.sh --no-typecheck   # skip the tsc --noEmit gate
#   ./scripts/build.sh --pack           # also run `npm pack --dry-run` to inspect the tarball

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

BACKEND="packages/mythgram"
FRONTEND="packages/frontend-main"

TYPECHECK=1
PACK=0
for arg in "$@"; do
  case "$arg" in
    --no-typecheck) TYPECHECK=0 ;;
    --pack) PACK=1 ;;
    -h|--help) printf 'Usage: %s [--no-typecheck] [--pack]\n' "$0"; exit 0 ;;
    *) printf 'Unknown option: %s\n' "$arg" >&2; exit 2 ;;
  esac
done

if [ -t 1 ]; then
  BOLD="$(printf '\033[1m')"; RED="$(printf '\033[31m')"
  GREEN="$(printf '\033[32m')"; CYAN="$(printf '\033[36m')"; RESET="$(printf '\033[0m')"
else
  BOLD="" RED="" GREEN="" CYAN="" RESET=""
fi
step() { printf '\n%s==> %s%s\n' "$BOLD$CYAN" "$1" "$RESET"; }
ok()   { printf '%s  ✓%s %s\n' "$GREEN" "$RESET" "$1"; }

FAILURES=0
run() {
  local label="$1"; shift
  step "$label"
  if "$@"; then ok "$label"; else
    printf '%s  ✗%s %s\n' "$RED" "$RESET" "$label"
    FAILURES=$((FAILURES + 1))
  fi
}

if [ "$TYPECHECK" -eq 1 ]; then
  run "typecheck: $BACKEND" npm --prefix "$ROOT_DIR/$BACKEND" run typecheck
  run "typecheck: $FRONTEND" npm --prefix "$ROOT_DIR/$FRONTEND" run typecheck
fi

run "build: $BACKEND" npm --prefix "$ROOT_DIR/$BACKEND" run build
run "build: $FRONTEND" npm --prefix "$ROOT_DIR/$FRONTEND" run build

if [ "$PACK" -eq 1 ]; then
  run "pack: inspect publishable tarball" npm --prefix "$ROOT_DIR" pack --dry-run
fi

if [ "$FAILURES" -eq 0 ]; then
  printf '\n%s  ✓%s Build complete.\n' "$GREEN" "$RESET"
  printf '      backend  → %s/%s/dist\n' "$ROOT_DIR" "$BACKEND"
  printf '      console  → %s/%s/dist/web\n' "$ROOT_DIR" "$BACKEND"
  exit 0
fi
printf '\n%s  %d step(s) failed.%s\n' "$RED" "$FAILURES" "$RESET"
exit 1
