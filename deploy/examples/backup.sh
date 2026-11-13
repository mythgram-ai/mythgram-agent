#!/usr/bin/env bash
#
# backup.sh — consistent online backup of the Mythgram SQLite database.
#
# SQLite runs in WAL mode, so copying only mythgram.db can miss recent writes.
# This uses the sqlite3 `.backup` command, which produces a single consistent
# snapshot even while the app is running.
#
# Usage:
#   WORKSPACE=/srv/mythgram-workspace BACKUP_DIR=/backups ./deploy/examples/backup.sh
#
# Cron (daily at 03:15):
#   15 3 * * * WORKSPACE=/srv/mythgram-workspace BACKUP_DIR=/backups \
#              /opt/mythgram/deploy/examples/backup.sh >> /var/log/mythgram-backup.log 2>&1

set -euo pipefail

WORKSPACE="${WORKSPACE:-/srv/mythgram-workspace}"
BACKUP_DIR="${BACKUP_DIR:-/backups}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"

DB="$WORKSPACE/.mythgram/mythgram.db"
STAMP="$(date +%Y%m%d-%H%M%S)"
OUT="$BACKUP_DIR/mythgram-$STAMP.db"

if [ ! -f "$DB" ]; then
  echo "backup: database not found at $DB" >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"

if command -v sqlite3 >/dev/null 2>&1; then
  sqlite3 "$DB" ".backup '$OUT'"
else
  # Fallback: checkpoint WAL then copy the files together.
  echo "backup: sqlite3 not found — copying db files (best effort)" >&2
  cp "$DB" "$OUT"
  [ -f "$DB-wal" ] && cp "$DB-wal" "$OUT-wal"
  [ -f "$DB-shm" ] && cp "$DB-shm" "$OUT-shm"
fi

echo "backup: wrote $OUT"

if [ "$RETENTION_DAYS" -gt 0 ]; then
  find "$BACKUP_DIR" -maxdepth 1 -name 'mythgram-*.db*' -mtime "+$RETENTION_DAYS" -delete
  echo "backup: pruned backups older than $RETENTION_DAYS days"
fi
