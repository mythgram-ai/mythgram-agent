#!/usr/bin/env bash
#
# lint.sh — run the linters across the workspace.
#
# frontend-main and packages/local-tts/web-ui use oxlint; the backend currently
# relies on TypeScript for correctness (run ./scripts/full-test.sh for typecheck).
# Packages without node_modules or without a lint script are skipped.
#
# Usage:
#   ./scripts/lint.sh             # lint every package that has a lint script
#   ./scripts/lint.sh --fix       # pass oxlint's --fix through (where supported)

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

FIX=0
for arg in "$@"; do
  case "$arg" in
    --fix) FIX=1 ;;
    -h|--help) printf 'Usage: %s [--fix]\n' "$0"; exit 0 ;;
    *) printf 'Unknown option: %s\n' "$arg" >&2; exit 2 ;;
  esac
done

if [ -t 1 ]; then
  BOLD="$(printf '\033[1m')"; RED="$(printf '\033[31m')"
  GREEN="$(printf '\033[32m')"; YELLOW="$(printf '\033[33m')"
  CYAN="$(printf '\033[36m')"; RESET="$(printf '\033[0m')"
else
  BOLD="" RED="" GREEN="" YELLOW="" CYAN="" RESET=""
fi
step() { printf '\n%s==> %s%s\n' "$BOLD$CYAN" "$1" "$RESET"; }
ok()   { printf '%s  ✓%s %s\n' "$GREEN" "$RESET" "$1"; }
skip() { printf '%s  –%s %s\n' "$YELLOW" "$RESET" "$1"; }

PACKAGES=(
  "packages/frontend-main"
  "packages/local-tts/web-ui"
)

FAILURES=0
for pkg in "${PACKAGES[@]}"; do
  dir="$ROOT_DIR/$pkg"
  if [ ! -d "$dir/node_modules" ]; then
    step "lint: $pkg"
    skip "node_modules missing — run ./scripts/setup.sh"
    continue
  fi
  if ! grep -q '"lint"' "$dir/package.json" 2>/dev/null; then
    step "lint: $pkg"
    skip "no lint script defined"
    continue
  fi
  step "lint: $pkg"
  if [ "$FIX" -eq 1 ] && [ -x "$dir/node_modules/.bin/oxlint" ]; then
    ( cd "$dir" && ./node_modules/.bin/oxlint --fix ) && ok "$pkg" || FAILURES=$((FAILURES + 1))
  else
    npm --prefix "$dir" run lint && ok "$pkg" || FAILURES=$((FAILURES + 1))
  fi
done

if [ "$FAILURES" -eq 0 ]; then
  printf '\n%s  ✓%s Lint complete.\n' "$GREEN" "$RESET"
  exit 0
fi
printf '\n%s  %d package(s) failed lint.%s\n' "$RED" "$FAILURES" "$RESET"
exit 1
