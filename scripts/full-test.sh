#!/usr/bin/env bash
#
# full-test.sh — one-shot quality gate for the Mythgram monorepo.
#
# Runs the full verification for BOTH first-party packages:
#   packages/mythgram        (TypeScript/Express backend + CLI)
#   packages/frontend-main   (React 19 + Vite web console)
#
# Steps, in order:
#   1. init       install dependencies (npm ci in CI, npm install locally)
#   2. typecheck  tsc --noEmit
#   3. build      production build (frontend emits into packages/mythgram/dist/web)
#   4. test       unit tests (a package with no test script is skipped gracefully)
#
# Usage:
#   ./scripts/full-test.sh                     # init + typecheck + build + test
#   FULL_TEST_CI=1 ./scripts/full-test.sh      # use `npm ci` for a clean, reproducible install
#   FULL_TEST_SKIP_INIT=1 ./scripts/full-test.sh   # reuse existing node_modules (no install)
#   FULL_TEST_NO_BUILD=1 ./scripts/full-test.sh    # typecheck + test only
#
# Exit code is non-zero if any step fails; every step still runs so you see the
# full picture in one pass.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

BACKEND="packages/mythgram"
FRONTEND="packages/frontend-main"

if [ -t 1 ]; then
  BOLD="$(printf '\033[1m')"
  DIM="$(printf '\033[2m')"
  RED="$(printf '\033[31m')"
  GREEN="$(printf '\033[32m')"
  YELLOW="$(printf '\033[33m')"
  CYAN="$(printf '\033[36m')"
  RESET="$(printf '\033[0m')"
else
  BOLD="" DIM="" RED="" GREEN="" YELLOW="" CYAN="" RESET=""
fi

step() { printf '\n%s==> %s%s\n' "$BOLD$CYAN" "$1" "$RESET"; }
ok()   { printf '%s  PASS%s %s\n' "$GREEN" "$RESET" "$1"; }
skip() { printf '%s  SKIP%s %s\n' "$YELLOW" "$RESET" "$1"; }
fail() { printf '%s  FAIL%s %s\n' "$RED" "$RESET" "$1"; }

FAILURES=0

run() {
  local label="$1"
  shift
  step "$label"
  if "$@"; then
    ok "$label"
  else
    fail "$label"
    FAILURES=$((FAILURES + 1))
  fi
}

install_pkg() {
  local dir="$1"
  if [ "${FULL_TEST_CI:-0}" = "1" ] && [ -f "$ROOT_DIR/$dir/package-lock.json" ]; then
    npm --prefix "$ROOT_DIR/$dir" ci --no-audit --no-fund
  else
    npm --prefix "$ROOT_DIR/$dir" install --no-audit --no-fund
  fi
}

printf '%sMythgram full test%s  %s(both packages)%s\n' "$BOLD" "$RESET" "$DIM" "$RESET"

# 1. init -------------------------------------------------------------------
if [ "${FULL_TEST_SKIP_INIT:-0}" = "1" ]; then
  step "init"
  skip "dependency install (FULL_TEST_SKIP_INIT=1)"
else
  run "init: $BACKEND dependencies" install_pkg "$BACKEND"
  run "init: $FRONTEND dependencies" install_pkg "$FRONTEND"
fi

# 2. typecheck --------------------------------------------------------------
run "typecheck: $BACKEND" npm --prefix "$ROOT_DIR/$BACKEND" run typecheck
run "typecheck: $FRONTEND" npm --prefix "$ROOT_DIR/$FRONTEND" run typecheck

# 3. build ------------------------------------------------------------------
if [ "${FULL_TEST_NO_BUILD:-0}" = "1" ]; then
  step "build"
  skip "production build (FULL_TEST_NO_BUILD=1)"
else
  run "build: $BACKEND" npm --prefix "$ROOT_DIR/$BACKEND" run build
  run "build: $FRONTEND" npm --prefix "$ROOT_DIR/$FRONTEND" run build
fi

# 4. test -------------------------------------------------------------------
run "test: $BACKEND" npm --prefix "$ROOT_DIR/$BACKEND" test
# frontend-main does not define a test script yet: --if-present keeps this green.
run "test: $FRONTEND" npm --prefix "$ROOT_DIR/$FRONTEND" test --if-present

# summary -------------------------------------------------------------------
if [ "$FAILURES" -eq 0 ]; then
  printf '\n%sAll checks passed.%s\n' "$BOLD$GREEN" "$RESET"
  exit 0
fi

printf '\n%s%d check(s) failed.%s\n' "$BOLD$RED" "$FAILURES" "$RESET"
exit 1
