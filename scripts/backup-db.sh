#!/usr/bin/env bash
#
# Dumps the MongoDB database to a timestamped gzip archive and prunes old ones.
#
# Reads the connection string from `mango_url` in ../.env unless MONGO_URL is
# already set in the environment.
#
# Usage:
#   ./scripts/backup-db.sh                      # -> ./backups/
#   BACKUP_DIR=/var/backups/kitab ./scripts/backup-db.sh
#   RETENTION_DAYS=30 ./scripts/backup-db.sh
#
# Cron example (daily at 02:30, log to syslog):
#   30 2 * * * cd /srv/kitab-shop-be && BACKUP_DIR=/var/backups/kitab \
#     ./scripts/backup-db.sh 2>&1 | logger -t kitab-backup

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

BACKUP_DIR="${BACKUP_DIR:-${APP_DIR}/backups}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"

if ! command -v mongodump >/dev/null 2>&1; then
  echo "error: mongodump not found. Install the MongoDB Database Tools first:" >&2
  echo "  https://www.mongodb.com/docs/database-tools/installation/" >&2
  exit 1
fi

# Pull the connection string out of .env without sourcing the file, so quoting styles
# and other entries in .env cannot execute anything.
#
# BOTH spellings, in the same precedence the app uses (src/database/mongo.db.js reads
# `mango_url || mongo_url`). This script used to read `mango_url` only: on a deployment
# whose .env says `mongo_url` it captured an empty string and, under `set -e`, exited 1
# with NO output at all. A backup that reports nothing and writes nothing is worse than
# one that fails loudly, because it looks like it worked.
if [[ -z "${MONGO_URL:-}" ]]; then
  if [[ ! -f "${APP_DIR}/.env" ]]; then
    echo "error: no MONGO_URL set and ${APP_DIR}/.env not found" >&2
    exit 1
  fi
  for KEY in mango_url mongo_url MONGO_URL; do
    # `|| true` is load-bearing: with `set -o pipefail`, grep exiting 1 because a key is
    # ABSENT fails the whole command substitution, and `set -e` then kills the script — no
    # message, no archive, exit 1. That is exactly how this silently never backed anything
    # up. A missing key has to be an empty result, not a fatal error, because trying the
    # next spelling is the entire point of the loop.
    MONGO_URL="$(
      { grep -E "^[[:space:]]*${KEY}[[:space:]]*=" "${APP_DIR}/.env" || true; } \
        | tail -n 1 \
        | sed -E "s/^[[:space:]]*${KEY}[[:space:]]*=[[:space:]]*//; s/^[\"']//; s/[\"']$//"
    )"
    [[ -n "${MONGO_URL}" ]] && break
  done
fi

if [[ -z "${MONGO_URL}" ]]; then
  echo "error: could not determine the MongoDB connection string" >&2
  exit 1
fi

mkdir -p "${BACKUP_DIR}"

TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
ARCHIVE="${BACKUP_DIR}/kitab-shop-${TIMESTAMP}.archive.gz"

echo "Backing up to ${ARCHIVE}"

# --archive + --gzip writes a single compressed file, which is far easier to
# ship off-box than a directory tree of BSON.
mongodump --uri="${MONGO_URL}" --archive="${ARCHIVE}" --gzip --quiet

if [[ ! -s "${ARCHIVE}" ]]; then
  echo "error: backup file is empty, removing it" >&2
  rm -f "${ARCHIVE}"
  exit 1
fi

SIZE="$(du -h "${ARCHIVE}" | cut -f1)"
echo "Backup complete: ${ARCHIVE} (${SIZE})"

# Prune only our own archives, never anything else that shares the directory.
DELETED="$(
  find "${BACKUP_DIR}" -maxdepth 1 -type f \
    -name 'kitab-shop-*.archive.gz' \
    -mtime "+${RETENTION_DAYS}" -print -delete | wc -l
)"
echo "Pruned ${DELETED} archive(s) older than ${RETENTION_DAYS} days"

echo
echo "Reminder: a backup that only lives on the same VPS is not a backup."
echo "Copy ${BACKUP_DIR} to object storage or another host."
