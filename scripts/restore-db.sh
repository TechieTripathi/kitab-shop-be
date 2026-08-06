#!/usr/bin/env bash
#
# Restores a MongoDB archive produced by scripts/backup-db.sh.
#
# Usage:
#   ./scripts/restore-db.sh ./backups/kitab-shop-20260805T023000Z.archive.gz
#   MONGO_URL=mongodb://127.0.0.1:27017/kitab-staging ./scripts/restore-db.sh <archive>
#
# By default this refuses to overwrite existing collections. Pass --drop to
# replace them, which is what a real disaster recovery needs:
#   ./scripts/restore-db.sh --drop <archive>
#
# Practise this against a scratch database before you need it. An untested
# backup is a guess.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

DROP=0
ARCHIVE=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --drop)
      DROP=1
      shift
      ;;
    -h|--help)
      sed -n '2,15p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      ARCHIVE="$1"
      shift
      ;;
  esac
done

if [[ -z "${ARCHIVE}" ]]; then
  echo "usage: $0 [--drop] <archive.gz>" >&2
  exit 1
fi

if [[ ! -f "${ARCHIVE}" ]]; then
  echo "error: archive not found: ${ARCHIVE}" >&2
  exit 1
fi

if ! command -v mongorestore >/dev/null 2>&1; then
  echo "error: mongorestore not found. Install the MongoDB Database Tools first:" >&2
  echo "  https://www.mongodb.com/docs/database-tools/installation/" >&2
  exit 1
fi

if [[ -z "${MONGO_URL:-}" ]]; then
  if [[ ! -f "${APP_DIR}/.env" ]]; then
    echo "error: no MONGO_URL set and ${APP_DIR}/.env not found" >&2
    exit 1
  fi
  MONGO_URL="$(
    grep -E '^[[:space:]]*mango_url[[:space:]]*=' "${APP_DIR}/.env" \
      | tail -n 1 \
      | sed -E 's/^[[:space:]]*mango_url[[:space:]]*=[[:space:]]*//; s/^["'"'"']//; s/["'"'"']$//'
  )"
fi

if [[ -z "${MONGO_URL}" ]]; then
  echo "error: could not determine the MongoDB connection string" >&2
  exit 1
fi

# Show the target without leaking credentials into logs or scrollback.
SAFE_TARGET="$(printf '%s' "${MONGO_URL}" | sed -E 's#://[^@/]*@#://***:***@#')"

echo "Archive : ${ARCHIVE}"
echo "Target  : ${SAFE_TARGET}"
if [[ "${DROP}" -eq 1 ]]; then
  echo "Mode    : --drop (existing collections will be REPLACED)"
else
  echo "Mode    : merge (existing collections are kept)"
fi
echo

read -r -p "Type 'restore' to continue: " CONFIRM
if [[ "${CONFIRM}" != "restore" ]]; then
  echo "Aborted."
  exit 1
fi

RESTORE_ARGS=(--uri="${MONGO_URL}" --archive="${ARCHIVE}" --gzip)
if [[ "${DROP}" -eq 1 ]]; then
  RESTORE_ARGS+=(--drop)
fi

mongorestore "${RESTORE_ARGS[@]}"

echo "Restore complete."
