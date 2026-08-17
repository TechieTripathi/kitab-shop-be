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
  # Both spellings, in the app's own precedence (src/database/mongo.db.js reads
  # `mango_url || mongo_url`). Reading only `mango_url` meant that on a deployment whose
  # .env says `mongo_url` this captured an empty string and exited 1 with no output — so a
  # restore appeared to do nothing rather than say why.
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
