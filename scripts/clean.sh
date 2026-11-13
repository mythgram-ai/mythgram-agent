#!/usr/bin/env bash
#
# clean.sh — remove build output, caches, and logs.
#
# By default it deletes generated artifacts only (never source):
#   • packages/mythgram/dist          (compiled backend + bundled web console)
#   • .logs/ and *.log at the repo root
#   • TypeScript build-info files (*.tsbuildinfo)
#
# With --all it also removes every node_modules directory (the next
# ./scripts/setup.sh will reinstall them).
#
# Usage:
#   ./scripts/clean.sh          # artifacts + caches + logs
#   ./scripts/clean.sh --all    # ...and node_modules
#   ./scripts/clean.sh --dry    # show what would be removed

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

ALL=0
DRY=0
for arg in "$@"; do
  case "$arg" in
    --all) ALL=1 ;;
    --dry|--dry-run) DRY=1 ;;
    -h|--help) printf 'Usage: %s [--all] [--dry]\n' "$0"; exit 0 ;;
    *) printf 'Unknown option: %s\n' "$arg" >&2; exit 2 ;;
  esac
done

if [ -t 1 ]; then
  BOLD="$(printf '\033[1m')"; YELLOW="$(printf '\033[33m')"
  CYAN="$(printf '\033[36m')"; RESET="$(printf '\033[0m')"
else
  BOLD="" YELLOW="" CYAN="" RESET=""
fi

rm_path() {
  local path="$1"
  [ -e "$path" ] || return 0
  if [ "$DRY" -eq 1 ]; then
    printf '  would remove  %s\n' "${path#"$ROOT_DIR/"}"
  else
    rm -rf "$path"
    printf '  removed       %s\n' "${path#"$ROOT_DIR/"}"
  fi
}

printf '\n%s==> Cleaning build artifacts%s\n' "$BOLD$CYAN" "$RESET"
rm_path "$ROOT_DIR/packages/mythgram/dist"
rm_path "$ROOT_DIR/packages/frontend-main/dist"
rm_path "$ROOT_DIR/.logs"

printf '\n%s==> Cleaning TypeScript build info%s\n' "$BOLD$CYAN" "$RESET"
while IFS= read -r -d '' f; do
  rm_path "$f"
done < <(find "$ROOT_DIR/packages" "$ROOT_DIR" -maxdepth 3 -name '*.tsbuildinfo' -not -path '*/node_modules/*' -print0 2>/dev/null)

printf '\n%s==> Cleaning logs%s\n' "$BOLD$CYAN" "$RESET"
while IFS= read -r -d '' f; do
  rm_path "$f"
done < <(find "$ROOT_DIR" -maxdepth 1 -name '*.log' -print0 2>/dev/null)

if [ "$ALL" -eq 1 ]; then
  printf '\n%s==> Removing node_modules%s\n' "$BOLD$CYAN" "$RESET"
  while IFS= read -r -d '' d; do
    rm_path "$d"
  done < <(find "$ROOT_DIR" -maxdepth 3 -type d -name node_modules -not -path '*/local-tts/backend/*' -print0 2>/dev/null)
fi

if [ "$DRY" -eq 1 ]; then
  printf '\n%s  dry run — nothing was deleted.%s\n\n' "$YELLOW" "$RESET"
else
  printf '\n  Clean complete.\n\n'
fi
