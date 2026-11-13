#!/usr/bin/env bash
#
# setup.sh — bootstrap the repo: install dependencies and seed local env files.
#
# Idempotent and safe to re-run. Installs npm dependencies for the root package
# (husky git hooks) plus both first-party packages, then copies each package's
# `.env.example` to `.env` when no `.env` exists yet (it never overwrites one).
#
# Usage:
#   ./scripts/setup.sh                # npm install everywhere + seed .env files
#   SETUP_CI=1 ./scripts/setup.sh     # use `npm ci` (clean, lockfile-exact install)
#   SETUP_NO_ENV=1 ./scripts/setup.sh # skip creating .env files

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

BACKEND="packages/mythgram"
FRONTEND="packages/frontend-main"

if [ -t 1 ]; then
  BOLD="$(printf '\033[1m')"; RED="$(printf '\033[31m')"
  GREEN="$(printf '\033[32m')"; YELLOW="$(printf '\033[33m')"
  CYAN="$(printf '\033[36m')"; RESET="$(printf '\033[0m')"
else
  BOLD="" RED="" GREEN="" YELLOW="" CYAN="" RESET=""
fi

step() { printf '\n%s==> %s%s\n' "$BOLD$CYAN" "$1" "$RESET"; }
ok()   { printf '%s  ✓%s %s\n' "$GREEN" "$RESET" "$1"; }
warn() { printf '%s  !%s %s\n' "$YELLOW" "$RESET" "$1"; }

FAILURES=0

install_dir() {
  local dir="$1"
  if [ ! -f "$ROOT_DIR/$dir/package.json" ]; then
    warn "no package.json in $dir — skipping"
    return 0
  fi
  step "Installing dependencies: ${dir:-<root>}"
  if [ "${SETUP_CI:-0}" = "1" ] && [ -f "$ROOT_DIR/$dir/package-lock.json" ]; then
    npm --prefix "$ROOT_DIR/$dir" ci --no-audit --no-fund
  else
    npm --prefix "$ROOT_DIR/$dir" install --no-audit --no-fund
  fi
}

seed_env() {
  local dir="$1"
  local example="$ROOT_DIR/$dir/.env.example"
  local target="$ROOT_DIR/$dir/.env"
  if [ ! -f "$example" ]; then
    return 0
  fi
  if [ -f "$target" ]; then
    warn "$dir/.env already exists — left untouched"
  else
    cp "$example" "$target"
    ok "created $dir/.env from .env.example"
  fi
}

printf '%sMythgram setup%s\n' "$BOLD" "$RESET"

install_dir "" || FAILURES=$((FAILURES + 1))
install_dir "$BACKEND" || FAILURES=$((FAILURES + 1))
install_dir "$FRONTEND" || FAILURES=$((FAILURES + 1))

if [ "${SETUP_NO_ENV:-0}" != "1" ]; then
  step "Seeding environment files"
  seed_env "$BACKEND"
  seed_env "$FRONTEND"
fi

step "Done"
if [ "$FAILURES" -eq 0 ]; then
  printf '%s  ✓%s Setup complete. Start the dev servers with: ./scripts/dev.sh\n' "$GREEN" "$RESET"
  exit 0
fi
printf '%s  %s%d step(s) failed.%s\n' "$RED" "$BOLD" "$FAILURES" "$RESET"
exit 1
