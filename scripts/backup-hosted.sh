#!/usr/bin/env bash
# Backs up the hosted database and proves the backup restores.
#
#   scripts/backup-hosted.sh <env-file>
#
# <env-file> holds PGHOST_UNPOOLED, PGUSER, PGPASSWORD, PGDATABASE (from
# `vercel env pull <file> --environment=<preview|production>`); keep it
# outside the repository and delete it afterwards. Writes
# backups/refrain-<timestamp>.dump (git-ignored), restores it into a
# throwaway PostgreSQL container, and compares every table's row count with
# the source. Needs Docker. Never prints credentials.
set -euo pipefail

ENV_FILE="${1:?usage: scripts/backup-hosted.sh <env-file>}"
IMAGE="postgres:18"
set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a
export PGHOST="${PGHOST_UNPOOLED:?PGHOST_UNPOOLED missing}" PGSSLMODE=require
: "${PGUSER:?}" "${PGPASSWORD:?}" "${PGDATABASE:?}"

mkdir -p backups
umask 077
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DUMP="backups/refrain-${STAMP}.dump"
PG=(docker run --rm -e PGHOST -e PGUSER -e PGPASSWORD -e PGDATABASE -e PGSSLMODE "$IMAGE")

echo "source: ${PGHOST} / ${PGDATABASE}"
"${PG[@]}" pg_dump --format=custom --no-owner --no-privileges > "$DUMP"
echo "backup: ${DUMP} ($(wc -c < "$DUMP" | tr -d ' ') bytes)"
shasum -a 256 "$DUMP" > "${DUMP}.sha256"

COUNTS="select string_agg(t || '=' || n, ' ' order by t collate \"C\") from (
  select 'mixtapes' t, count(*) n from mixtapes union all
  select 'songs', count(*) from songs union all
  select 'mixtape_tracks', count(*) from mixtape_tracks union all
  select 'site_texts', count(*) from site_texts union all
  select 'site_images', count(*) from site_images union all
  select 'images', count(*) from images union all
  select 'image_files', count(*) from image_files union all
  select 'migrations', count(*) from drizzle.__drizzle_migrations) c;"
SOURCE="$("${PG[@]}" psql -tA -c "$COUNTS")"

NAME="refrain-restore-test-$(echo "$STAMP" | tr "[:upper:]" "[:lower:]")"
docker run -d --rm --name "$NAME" -e POSTGRES_PASSWORD=restore-test "$IMAGE" >/dev/null
trap 'docker stop "$NAME" >/dev/null 2>&1 || true' EXIT
until docker exec "$NAME" pg_isready -U postgres >/dev/null 2>&1; do sleep 1; done
sleep 2
# Neon adds a column option of its own (pg_attver) that vanilla PostgreSQL
# rejects; the throwaway restore drops just those statements. A restore into
# Neon itself accepts the dump unchanged.
docker exec -i "$NAME" pg_restore --no-owner --no-privileges -f - < "$DUMP" \
  | grep -v 'SET (pg_attver=' \
  | docker exec -i "$NAME" psql -U postgres -d postgres -q -v ON_ERROR_STOP=1 >/dev/null
RESTORED="$(docker exec "$NAME" psql -U postgres -d postgres -tA -c "$COUNTS")"

echo "source:   ${SOURCE}"
echo "restored: ${RESTORED}"
if [ "$SOURCE" = "$RESTORED" ]; then
  echo "restore verified: every table matches."
else
  echo "RESTORE MISMATCH" >&2
  exit 1
fi
