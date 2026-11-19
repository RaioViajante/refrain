#!/usr/bin/env bash
# Backs up a PostgreSQL database and proves the backup restores intact.
# Generic: it discovers the tables itself, so it serves both the new Refrain
# and the archived music diary (whose schema differs).
#
#   scripts/backup-database.sh <env-file> [label]
#
# <env-file> holds PGHOST_UNPOOLED (or PGHOST), PGUSER, PGPASSWORD,
# PGDATABASE, and optionally PGSSLMODE (default: require) — e.g. from
# `vercel env pull <file> --environment=<…>`. Keep it outside the repository
# and delete it afterwards. Needs Docker; never prints credentials.
#
# What it does:
#   1. Connects to the source READ-ONLY (default_transaction_read_only=on,
#      enforced by PostgreSQL), so nothing can modify it.
#   2. pg_dump --format=custom → backups/<label>-<UTC>.dump (+ .sha256).
#   3. Restores the dump into a throwaway PostgreSQL container.
#   4. For every table in every non-system schema of the source, compares
#      the row count and a content checksum between source and restore:
#      md5 of each row's full text (bytea photos included, byte for byte),
#      sorted, then md5 of the list — independent of physical row order.
#      It ends with "restore verified" only if every table matches.
#
# BACKUP_SELFTEST_TAMPER=1 alters the throwaway restore before the
# comparison (one byte of one photo when there are photos, so row counts stay
# equal), to prove a difference is detected: expect a failure.
set -euo pipefail

ENV_FILE="${1:?usage: scripts/backup-database.sh <env-file> [label]}"
LABEL="${2:-refrain}"
IMAGE="postgres:18"
set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a
export PGHOST="${PGHOST_UNPOOLED:-${PGHOST:?PGHOST_UNPOOLED or PGHOST missing}}"
export PGSSLMODE="${PGSSLMODE:-require}" PGPORT="${PGPORT:-5432}"
: "${PGUSER:?}" "${PGPASSWORD:?}" "${PGDATABASE:?}"
# Read-only at the server, and stable text forms for the checksums.
export PGOPTIONS="-c default_transaction_read_only=on -c TimeZone=UTC -c DateStyle=ISO -c extra_float_digits=1 -c bytea_output=hex"

mkdir -p backups
umask 077
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DUMP="backups/${LABEL}-${STAMP}.dump"
SRC=(docker run --rm --add-host=host.docker.internal:host-gateway
  -e PGHOST -e PGPORT -e PGUSER -e PGPASSWORD -e PGDATABASE -e PGSSLMODE -e PGOPTIONS "$IMAGE")

echo "source: ${PGHOST} / ${PGDATABASE} (read-only)"
"${SRC[@]}" psql -tA -c "show default_transaction_read_only" | grep -qx on

"${SRC[@]}" pg_dump --format=custom --no-owner --no-privileges > "$DUMP"
shasum -a 256 "$DUMP" > "${DUMP}.sha256"
echo "backup: ${DUMP} ($(wc -c < "$DUMP" | tr -d ' ') bytes, sha256 in ${DUMP}.sha256)"

# Every table in every non-system schema, as schema.table.
TABLES_SQL="select quote_ident(table_schema) || '.' || quote_ident(table_name)
  from information_schema.tables
  where table_type = 'BASE TABLE'
    and table_schema not in ('pg_catalog', 'information_schema')
    and table_schema not like 'pg\\_%'
  order by 1"
TABLES=()
while IFS= read -r t; do [ -n "$t" ] && TABLES+=("$t"); done \
  < <("${SRC[@]}" psql -tA -c "$TABLES_SQL")
[ "${#TABLES[@]}" -gt 0 ] || { echo "no tables found" >&2; exit 1; }

# One line per table: name, row count, content checksum.
CHECKSUM_SQL=""
for t in "${TABLES[@]}"; do
  CHECKSUM_SQL+="select '${t//\'/\'\'}' || ' ' || count(*) || ' ' || coalesce(md5(string_agg(h, '' order by h)), '-') from (select md5(x::text) h from ${t} x) r;"
done

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

if [ "${BACKUP_SELFTEST_TAMPER:-}" = "1" ]; then
  # A content-only change where possible (one byte of one photo: same row
  # counts), otherwise one row removed from the first table.
  if docker exec "$NAME" psql -U postgres -d postgres -tA -c \
      "select 1 from public.image_files limit 1" 2>/dev/null | grep -qx 1; then
    docker exec "$NAME" psql -U postgres -d postgres -q -c \
      "update public.image_files set bytes = set_byte(bytes, 0, (get_byte(bytes, 0) + 1) % 256)
       where image_id = (select image_id from public.image_files order by image_id limit 1)" >/dev/null
    echo "self-test: one byte of one photo changed in the restored copy"
  else
    FIRST="${TABLES[0]}"
    docker exec "$NAME" psql -U postgres -d postgres -q -c \
      "delete from ${FIRST} where ctid = (select ctid from ${FIRST} limit 1)" >/dev/null
    echo "self-test: one row removed from ${FIRST} in the restored copy"
  fi
fi

SOURCE_SUMS="$("${SRC[@]}" psql -tA -c "$CHECKSUM_SQL")"
RESTORED_SUMS="$(docker exec -e PGOPTIONS="-c TimeZone=UTC -c DateStyle=ISO -c extra_float_digits=1 -c bytea_output=hex" \
  "$NAME" psql -U postgres -d postgres -tA -c "$CHECKSUM_SQL")"

echo "tables:   ${#TABLES[@]}"
if [ "$SOURCE_SUMS" = "$RESTORED_SUMS" ]; then
  echo "$SOURCE_SUMS" | awk '{ printf "  %-40s %8s rows  %s\n", $1, $2, $3 }'
  echo "restore verified: every table's rows and content match the source."
else
  echo "RESTORE MISMATCH (table rows checksum: source vs restored)" >&2
  diff <(echo "$SOURCE_SUMS") <(echo "$RESTORED_SUMS") >&2 || true
  exit 1
fi
