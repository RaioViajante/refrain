#!/usr/bin/env bash
# refrain-backup: encrypted, verified logical backups of Refrain's hosted
# PostgreSQL 18 database, and the owner's restore drill.
# See docs/hosted-backups.md. It runs in the image built from ./Dockerfile
# (PostgreSQL 18 client tools and age), never with the application's code.
#
#   refrain-backup backup <empty output directory>
#       Dumps the source in one exported snapshot, fingerprints the source in
#       that same snapshot, restores the plaintext dump into a NEW database on
#       a disposable restore server and compares fingerprints, then encrypts
#       the bundle to the owner's age recipient. Only the encrypted bundle, its
#       .sha256, and a content-free summary are written to the output.
#   refrain-backup check <bundle.tar.age>
#       Checks that an encrypted bundle is intact: its .sha256 and its age
#       header. It cannot and does not decrypt it.
#   refrain-backup drill <bundle.tar.age>
#       The owner's restore drill: decrypts with the owner's identity, restores
#       into a NEW database on a disposable restore server, and compares with
#       the fingerprint taken at backup time.
#   refrain-backup reconcile <restore candidate.tar.age> <newer bundle.tar.age>
#       Recovery review: decrypts only the two inventories and lists, by
#       identifier and state, the entries the candidate holds that the newer
#       backup no longer held (deleted permanently since), and those whose
#       publication state differs. Never content.
#
# Configuration comes from the environment only; nothing secret is ever an
# argument or printed:
#   PGSERVICEFILE   libpq service file with [refrain_source] (backup only) and
#                   [refrain_restore] (the disposable restore server's
#                   maintenance database, which must carry the disposable marker)
#   PGPASSFILE      libpq password file (0600)
#   REFRAIN_BACKUP_RECIPIENTS_FILE   age recipients (public keys), backup only
#   REFRAIN_BACKUP_IDENTITY_FILE     age identity (the owner's), drill only
#   REFRAIN_BACKUP_TEST_ONLY_INSECURE_SOURCE=1
#       Tests only: allows a source without TLS, and only on a loopback host
#       and a database named *_test.
#   REFRAIN_BACKUP_TEST_PAUSE=<dir>:<point>
#       Tests only, and only with the variable above: waits at <point>
#       (snapshot: after the snapshot is exported; restore: after the scratch
#       database exists) until <dir>/<point>.continue appears, so a test can
#       write concurrently or interrupt the run.
set -Eeuo pipefail
umask 077
export LC_ALL=C.UTF-8 PGTZ=UTC PGAPPNAME=refrain-backup PGCONNECT_TIMEOUT=30

HERE="$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")"
readonly HERE
readonly BUNDLE_FORMAT=1
readonly REQUIRED_MAJOR=18
readonly MARKER='refrain:disposable-test-database'
# Rows that never travel in a backup: live sessions (replayable), one-time
# verification values, and rate-limit counters. Their tables are kept, empty.
# Must equal EXCLUDED_DATA in src/ops/backup.ts (a unit test checks it).
readonly EXCLUDED_TABLES=(public.auth_sessions public.auth_verifications public.auth_rate_limits)

work=""
holder=""
restore_maintenance=""
scratch_database=""
placeholder_roles=()

say() { printf 'refrain-backup: %s\n' "$*"; }
die() {
  printf 'refrain-backup: FAILED: %s\n' "$*" >&2
  exit 1
}

# Tool errors can quote data (a DETAIL with a key value, a COPY CONTEXT with a
# row). Only the tools' own first-level lines are kept, without host names or
# connection strings, and shortened.
redacted() {
  # psql prefixes a script's errors with `psql:<file>:<line>:`.
  grep -E '^(pg_dump|pg_restore|psql|age|tar)(:[^ ]*)?: ' |
    grep -vE '^(pg_dump|pg_restore|psql)(:[^ ]*)?: (DETAIL|CONTEXT|HINT|LINE [0-9]+|QUERY):' |
    sed -E 's#(server at |host )"[^"]*"#\1"<host>"#g; s#postgres(ql)?://[^ ]*#<connection>#g' |
    cut -c1-240 | head -n 8 || true
}

run_tool() {
  # Runs a tool with its stderr captured, and reports only redacted lines.
  local label=$1
  shift
  local errors="$work/tool.err"
  if ! "$@" 2>"$errors"; then
    redacted <"$errors" >&2
    rm -f "$errors"
    die "$label"
  fi
  rm -f "$errors"
}

cleanup() {
  local status=$?
  set +e
  if [[ -n $holder ]] && kill -0 "$holder" 2>/dev/null; then
    kill "$holder" 2>/dev/null
    wait "$holder" 2>/dev/null
  fi
  # Only what this run created: the scratch database, then the placeholder
  # roles (which own nothing once that database is gone).
  if [[ -n $scratch_database && -n $restore_maintenance ]]; then
    psql "$restore_maintenance" -X -q -v ON_ERROR_STOP=1 \
      -c "drop database if exists \"$scratch_database\" with (force)" >/dev/null 2>&1
  fi
  drop_placeholder_roles >/dev/null 2>&1
  if [[ -n $work && -d $work ]]; then
    rm -rf -- "$work"
  fi
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT TERM HUP

drop_placeholder_roles() {
  local role
  for role in "${placeholder_roles[@]}"; do
    psql "$restore_maintenance" -X -q -v ON_ERROR_STOP=1 -c "drop role if exists \"$role\"" || return 1
  done
  placeholder_roles=()
}

# The roles the source's owners and grants name must exist for them to
# restore. On the disposable restore server, each missing one is created as a
# NOLOGIN placeholder for this run only, and dropped afterwards.
create_placeholder_roles() {
  local fingerprint=$1 role exists
  while IFS= read -r role; do
    [[ $role =~ ^[a-z_][a-z0-9_]{0,62}$ ]] || die "the backup names a role this procedure does not handle"
    # psql interpolates variables in a script, not in -c.
    exists="$(psql "$restore_maintenance" -X -q -At -v ON_ERROR_STOP=1 -v role="$role" \
      <<<"select count(*) from pg_roles where rolname = :'role'" 2>/dev/null)" ||
      die "could not read the restore server's roles"
    if [[ $exists == 0 ]]; then
      run_tool "could not create a placeholder role" \
        psql "$restore_maintenance" -X -q -v ON_ERROR_STOP=1 -c "create role \"$role\" nologin"
      placeholder_roles+=("$role")
    fi
  done < <(sed -nE 's/^role\|//p' "$fingerprint")
}

test_pause() {
  local spec=${REFRAIN_BACKUP_TEST_PAUSE:-}
  [[ -n $spec && ${REFRAIN_BACKUP_TEST_ONLY_INSECURE_SOURCE:-} == 1 ]] || return 0
  local directory=${spec%:*} point=${spec##*:} waited=0
  [[ $point == "$1" ]] || return 0
  : >"$directory/$point.reached"
  until [[ -e $directory/$point.continue ]]; do
    ((waited++ < 1200)) || die "test pause timed out"
    sleep 0.1
  done
}

new_work_directory() {
  work="$(mktemp -d "${TMPDIR:-/tmp}/refrain-backup.XXXXXXXX")"
  chmod 700 "$work"
}

major_of() { sed -nE 's/^[^0-9]*([0-9]+)\..*/\1/p' | head -n 1; }

check_tools() {
  local tool
  for tool in pg_dump pg_restore psql age tar sha256sum; do
    command -v "$tool" >/dev/null || die "$tool is not installed"
  done
  [[ "$(pg_dump --version | major_of)" == "$REQUIRED_MAJOR" ]] ||
    die "pg_dump must be PostgreSQL $REQUIRED_MAJOR"
  [[ "$(pg_restore --version | major_of)" == "$REQUIRED_MAJOR" ]] ||
    die "pg_restore must be PostgreSQL $REQUIRED_MAJOR"
  [[ -n ${PGSERVICEFILE:-} && -f $PGSERVICEFILE ]] || die "PGSERVICEFILE is not a file"
  [[ -n ${PGPASSFILE:-} && -f $PGPASSFILE ]] || die "PGPASSFILE is not a file"
}

is_loopback() { [[ $1 == 127.0.0.1 || $1 == localhost || $1 == ::1 || $1 == /* ]]; }

# psql's own view of a connection: host, database, server version, TLS.
connection_facts() {
  psql "$1" -X -q -At -v ON_ERROR_STOP=1 \
    -c '\echo host=:HOST' \
    -c "select 'database=' || current_database()" \
    -c "select 'major=' || (current_setting('server_version_num')::int / 10000)" \
    -c "select 'ssl=' || coalesce((select ssl from pg_stat_ssl where pid = pg_backend_pid()), false)" \
    -c "select 'marker=' || coalesce(shobj_description(oid, 'pg_database'), '') from pg_database where datname = current_database()" \
    -c "select 'superuser=' || current_setting('is_superuser')" \
    -c "select 'writer=' || (r.rolsuper or r.rolcreatedb or r.rolcreaterole or r.rolbypassrls
          or exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                      where n.nspname not like 'pg\\_%' and n.nspname <> 'information_schema'
                        and c.relkind in ('r', 'p')
                        and has_table_privilege(c.oid, 'INSERT, UPDATE, DELETE, TRUNCATE'))
          or has_database_privilege(current_database(), 'CREATE')
          or exists (select 1 from pg_namespace n
                      where n.nspname not like 'pg\\_%' and n.nspname <> 'information_schema'
                        and has_schema_privilege(n.oid, 'CREATE'))
          or exists (select 1 from pg_auth_members m where m.member = r.oid))
        from pg_roles r where r.rolname = current_user"
}

fact() { sed -nE "s/^$1=(.*)$/\1/p" <<<"$2" | head -n 1; }

source_conninfo() {
  if [[ ${REFRAIN_BACKUP_TEST_ONLY_INSECURE_SOURCE:-} == 1 ]]; then
    printf '%s' "service=refrain_source sslmode=disable"
  else
    # The server's certificate is verified against the system CA store and its
    # host name; libpq refuses anything weaker for sslrootcert=system.
    printf '%s' "service=refrain_source sslmode=verify-full sslrootcert=system"
  fi
}

check_source() {
  local facts
  facts="$(connection_facts "$1" 2>"$work/tool.err")" || {
    redacted <"$work/tool.err" >&2
    die "could not connect to the source"
  }
  [[ "$(fact major "$facts")" == "$REQUIRED_MAJOR" ]] ||
    die "the source is not PostgreSQL $REQUIRED_MAJOR; pg_dump $REQUIRED_MAJOR would make an archive this procedure has not tested"
  [[ "$(fact superuser "$facts")" == off ]] ||
    die "the source connection is a superuser; use the dedicated read-only backup role"
  # Not the owner or the runtime role either: a role that can write a table,
  # create in the database or in a schema, create roles, or is a member of any
  # role (and so could SET ROLE to one that writes) is refused.
  [[ "$(fact writer "$facts")" == false ]] ||
    die "the source role can write or create; use the dedicated read-only backup role"
  if [[ ${REFRAIN_BACKUP_TEST_ONLY_INSECURE_SOURCE:-} == 1 ]]; then
    is_loopback "$(fact host "$facts")" || die "the insecure test source must be on a loopback host"
    [[ "$(fact database "$facts")" =~ _test$ ]] || die "the insecure test source must be a *_test database"
  else
    [[ "$(fact ssl "$facts")" == true ]] || die "the source connection is not encrypted"
  fi
}

check_restore_server() {
  local facts
  facts="$(connection_facts "$restore_maintenance" 2>"$work/tool.err")" || {
    redacted <"$work/tool.err" >&2
    die "could not connect to the restore server"
  }
  # The restore server is never a database that matters: a loopback host, and
  # a maintenance database that carries the disposable-test marker, which is
  # placed on purpose (docker/postgres-test/01-mark-disposable.sql).
  is_loopback "$(fact host "$facts")" || die "the restore server must be on a loopback host"
  [[ "$(fact marker "$facts")" == "$MARKER" ]] ||
    die "the restore server's database is not marked as disposable; nothing was restored"
  [[ "$(fact major "$facts")" == "$REQUIRED_MAJOR" ]] ||
    die "the restore server is not PostgreSQL $REQUIRED_MAJOR"
}

excluded_list() {
  local table out=""
  for table in "${EXCLUDED_TABLES[@]}"; do
    out+="${out:+,}'$table'"
  done
  printf '%s' "$out"
}

fingerprint() {
  # $1 connection, $2 output file, optional $3 snapshot to read in
  local wrapper="$work/fingerprint-run.sql"
  {
    if [[ -n ${3:-} ]]; then
      printf '%s\n' "begin isolation level repeatable read, read only;"
      printf "set transaction snapshot '%s';\n" "$3"
    fi
    printf '\\i %s\n' "$HERE/fingerprint.sql"
    if [[ -n ${3:-} ]]; then
      printf '\\i %s\n' "$HERE/inventory.sql"
      printf '%s\n' "commit;"
    fi
  } >"$wrapper"
  run_tool "could not fingerprint the database" \
    psql "$1" -X -q -v ON_ERROR_STOP=1 -v excluded="$(excluded_list)" -f "$wrapper" -o "$2"
  [[ -s $2 ]] || die "the fingerprint is empty"
}

# Restores the plaintext dump in $1/refrain.dump into a new database on the
# restore server and compares it with $1/source.fingerprint.
restore_and_verify() {
  local bundle=$1 listing dumped_by
  check_restore_server

  listing="$work/listing.txt"
  run_tool "the archive is not a readable PostgreSQL archive" \
    pg_restore --list --file="$listing" "$bundle/refrain.dump"
  dumped_by="$(sed -nE 's/^;[[:space:]]+Dumped by pg_dump version: //p' "$listing" | major_of)"
  [[ $dumped_by == "$REQUIRED_MAJOR" ]] || die "the archive was not made by pg_dump $REQUIRED_MAJOR"

  local name
  name="refrain_verify_$(od -An -N6 -tx1 /dev/urandom | tr -d ' \n')_test"
  run_tool "could not create the scratch database" \
    psql "$restore_maintenance" -X -q -v ON_ERROR_STOP=1 -c "create database \"$name\""
  # Recorded only once created: cleanup never drops a database it did not make.
  scratch_database=$name
  local target="$restore_maintenance dbname=$scratch_database"
  create_placeholder_roles "$bundle/source.fingerprint"
  test_pause restore

  # One transaction, stopping at the first error. No --clean: the database is
  # new, and nothing existing is dropped or overwritten. Owners and grants are
  # restored too, and compared, as a recovery into Neon would restore them.
  run_tool "the restore failed" \
    pg_restore --exit-on-error --single-transaction \
    --dbname="$target" "$bundle/refrain.dump"

  fingerprint "$target" "$work/restored.fingerprint"
  if ! cmp -s "$bundle/source.fingerprint" "$work/restored.fingerprint"; then
    # Names which facts differ (kind and object), never values or digests.
    diff "$bundle/source.fingerprint" "$work/restored.fingerprint" |
      sed -nE 's/^([<>]) ([a-z-]+\|[^|]*).*/\1 \2/p' | sort -u | head -n 20 >&2 || true
    die "the restored copy differs from the source"
  fi

  local table count
  for table in "${EXCLUDED_TABLES[@]}"; do
    count="$(psql "$target" -X -q -At -v ON_ERROR_STOP=1 -c "select count(*) from $table")"
    [[ $count == 0 ]] || die "the backup carries rows of $table, which must never be in a backup"
  done

  # Every sequence that feeds a column is ahead of the values already used.
  local behind
  behind="$(psql "$target" -X -q -At -v ON_ERROR_STOP=1 <<'SQL'
select format($q$select '%1$s' where (select coalesce(max(%2$I), 0) from %3$I.%4$I) >
  (select case when is_called then last_value else last_value - 1 end from %5$s)$q$,
  s.seqrelid::regclass, a.attname, n.nspname, c.relname, s.seqrelid::regclass)
from pg_sequence s
join pg_depend d on d.objid = s.seqrelid and d.deptype in ('a', 'i')
join pg_class c on c.oid = d.refobjid
join pg_namespace n on n.oid = c.relnamespace
join pg_attribute a on a.attrelid = d.refobjid and a.attnum = d.refobjsubid
\gexec
SQL
)"
  [[ -z $behind ]] || die "a restored sequence is behind its column: $behind"

  tables_verified="$(grep -c '^data|' "$work/restored.fingerprint")"
  run_tool "could not drop the scratch database" \
    psql "$restore_maintenance" -X -q -v ON_ERROR_STOP=1 -c "drop database \"$scratch_database\" with (force)"
  scratch_database=""
  drop_placeholder_roles || die "could not drop the placeholder roles"
}

check_recipients() {
  local file=${REFRAIN_BACKUP_RECIPIENTS_FILE:-}
  [[ -n $file && -s $file ]] || die "REFRAIN_BACKUP_RECIPIENTS_FILE is not a file"
  if grep -q 'AGE-SECRET-KEY' "$file"; then
    die "the recipients file holds a private key; it must hold only public recipients"
  fi
  grep -vE '^[[:space:]]*(#|$)' "$file" | grep -qvE '^age1[02-9ac-hj-np-z]{58}$' &&
    die "the recipients file has a line that is not an age X25519 recipient"
  grep -qE '^age1' "$file" || die "the recipients file has no recipient"
}

cmd_backup() {
  local out=${1:-}
  [[ -n $out && -d $out ]] || die "the output directory does not exist"
  [[ -z "$(ls -A "$out")" ]] || die "the output directory is not empty; nothing is ever overwritten"
  check_tools
  check_recipients
  new_work_directory
  restore_maintenance="service=refrain_restore"
  local source
  source="$(source_conninfo)"
  check_source "$source"
  # Fail before dumping anything if the restore check could not run.
  check_restore_server

  # Hold one repeatable-read snapshot open, export it, and read the
  # fingerprint, the inventory, and the dump from that same snapshot.
  mkfifo "$work/holder.in"
  psql "$source" -X -q -v ON_ERROR_STOP=1 <"$work/holder.in" >/dev/null 2>"$work/holder.err" &
  holder=$!
  exec 3>"$work/holder.in"
  printf '%s\n' \
    "begin isolation level repeatable read, read only;" \
    "\\copy (select pg_export_snapshot()) to '$work/snapshot.id'" \
    "\\copy (select 'ready') to '$work/snapshot.ready'" >&3
  local waited=0
  until [[ -s $work/snapshot.ready ]]; do
    kill -0 "$holder" 2>/dev/null || {
      redacted <"$work/holder.err" >&2
      die "could not open the snapshot"
    }
    ((waited++ < 600)) || die "timed out waiting for the snapshot"
    sleep 0.1
  done
  local snapshot
  snapshot="$(head -n 1 "$work/snapshot.id")"
  [[ $snapshot =~ ^[0-9A-F]+-[0-9A-F]+-[0-9]+$ ]] || die "unexpected snapshot identifier"
  test_pause snapshot

  mkdir "$work/bundle"
  local wrapper="$work/fingerprint-run.sql"
  fingerprint "$source" "$work/bundle/snapshot.fingerprint" "$snapshot"
  grep -E '^(entry|reflection)\|' "$work/bundle/snapshot.fingerprint" >"$work/bundle/inventory.txt" || true
  grep -vE '^(entry|reflection)\|' "$work/bundle/snapshot.fingerprint" >"$work/bundle/source.fingerprint"
  # The dump holds the whole database; the fingerprint compares public and
  # drizzle. Any other schema would be dumped without being compared.
  local extra
  extra="$(sed -nE 's/^schema\|//p' "$work/bundle/source.fingerprint" | grep -vxE 'public|drizzle' | tr '\n' ' ' || true)"
  [[ -z $extra ]] || die "the database has a schema besides public and drizzle (${extra% }); the comparison does not cover it"
  rm -f "$work/bundle/snapshot.fingerprint" "$wrapper"

  # Owners and grants stay in the archive, so a recovery into Neon, where the
  # roles exist, can restore the runtime role's privileges exactly. The
  # restore check below restores without them (its server has no such roles).
  # The custom format compresses each table's data (gzip, moderate level).
  local args=(--snapshot="$snapshot" --format=custom)
  # The whole database, not selected schemas: a schema the role cannot read
  # makes pg_dump fail rather than be skipped, and the fingerprint lists any
  # schema besides public and drizzle that holds tables, so the comparison
  # fails if one ever appears.
  local table
  for table in "${EXCLUDED_TABLES[@]}"; do args+=(--exclude-table-data="$table"); done
  run_tool "pg_dump failed" pg_dump "${args[@]}" --file="$work/bundle/refrain.dump" --dbname="$source"
  [[ -s $work/bundle/refrain.dump ]] || die "pg_dump wrote nothing"

  printf '%s\n' "commit;" '\q' >&3
  exec 3>&-
  wait "$holder" || {
    redacted <"$work/holder.err" >&2
    die "the snapshot transaction did not end cleanly"
  }
  holder=""

  local created dump_sha
  created="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  dump_sha="$(sha256sum "$work/bundle/refrain.dump" | cut -d' ' -f1)"
  {
    printf 'format=%s\n' "$BUNDLE_FORMAT"
    printf 'created=%s\n' "$created"
    printf 'pg_dump=%s\n' "$(pg_dump --version)"
    printf 'excluded_data=%s\n' "${EXCLUDED_TABLES[*]}"
    printf 'scope=%s\n' "whole database; fingerprint covers public and drizzle"
    printf 'dump_sha256=%s\n' "$dump_sha"
  } >"$work/bundle/meta.txt"

  # The plaintext dump is restored and compared BEFORE it is encrypted. This
  # proves the dump; it does not prove that the encrypted bundle decrypts
  # (that is the owner's drill).
  restore_and_verify "$work/bundle"

  local name
  name="refrain-$(date -u -d "$created" +%Y%m%dT%H%M%SZ).tar.age"
  # tar streams straight into age: no plaintext archive is written anywhere.
  # shellcheck disable=SC2016 # expanded by the inner bash, from its arguments
  run_tool "encryption failed" bash -o pipefail -c \
    'tar -C "$1" -cf - bundle | age -R "$2" -o "$3"' _ "$work" "$REFRAIN_BACKUP_RECIPIENTS_FILE" "$work/$name"
  [[ "$(head -c 21 "$work/$name")" == "age-encryption.org/v1" ]] || die "the output is not an age file"
  mv -- "$work/$name" "$out/$name"
  (cd "$out" && sha256sum -- "$name" >"$name.sha256")
  {
    printf 'bundle=%s\n' "$name"
    printf 'created=%s\n' "$created"
    printf 'bytes=%s\n' "$(wc -c <"$out/$name" | tr -d ' ')"
    printf 'sha256=%s\n' "$(cut -d' ' -f1 "$out/$name.sha256")"
    printf 'tables_verified=%s\n' "$tables_verified"
    printf 'restore_check=passed (plaintext dump, before encryption)\n'
    printf 'decryption_drill=not performed by this job (needs the owner key)\n'
  } >"$out/summary.txt"
  say "backup verified and encrypted: $name ($tables_verified tables compared after a restore)"
}

check_sidecar() {
  local file=$1
  [[ -f $file ]] || die "the bundle is not a file"
  [[ -f $file.sha256 ]] || die "the bundle has no .sha256 next to it"
  (cd "$(dirname "$file")" && sha256sum --check --status -- "$(basename "$file").sha256") ||
    die "the bundle does not match its .sha256: it was changed or damaged"
  [[ "$(head -c 21 "$file")" == "age-encryption.org/v1" ]] || die "the bundle is not an age file"
}

cmd_check() {
  check_sidecar "${1:-}"
  say "intact: the bundle matches its .sha256 and is an age file (not decrypted, nothing restored)"
}

cmd_drill() {
  local file=${1:-}
  check_tools
  [[ -n ${REFRAIN_BACKUP_IDENTITY_FILE:-} && -f $REFRAIN_BACKUP_IDENTITY_FILE ]] ||
    die "REFRAIN_BACKUP_IDENTITY_FILE is not a file"
  check_sidecar "$file"
  new_work_directory
  restore_maintenance="service=refrain_restore"
  # age authenticates every chunk: a damaged or altered bundle fails here.
  # shellcheck disable=SC2016 # expanded by the inner bash, from its arguments
  run_tool "decryption failed (wrong key, or a damaged bundle)" bash -o pipefail -c \
    'age -d -i "$1" "$2" | tar -C "$3" -xf -' _ "$REFRAIN_BACKUP_IDENTITY_FILE" "$file" "$work"
  local bundle="$work/bundle" name
  for name in meta.txt refrain.dump source.fingerprint inventory.txt; do
    [[ -f $bundle/$name ]] || die "the bundle has no $name"
  done
  [[ "$(sed -nE 's/^format=//p' "$bundle/meta.txt")" == "$BUNDLE_FORMAT" ]] || die "unknown bundle format"
  [[ "$(sha256sum "$bundle/refrain.dump" | cut -d' ' -f1)" == "$(sed -nE 's/^dump_sha256=//p' "$bundle/meta.txt")" ]] ||
    die "the dump inside the bundle does not match its recorded checksum"
  restore_and_verify "$bundle"
  say "drill passed: decrypted with the owner's key, restored into a new PostgreSQL $REQUIRED_MAJOR database, and identical to the backup-time fingerprint ($tables_verified tables); made $(sed -nE 's/^created=//p' "$bundle/meta.txt")"
}

inventory_of() {
  # $1 bundle, $2 output file: only inventory.txt is extracted, never the dump.
  check_sidecar "$1"
  # shellcheck disable=SC2016 # expanded by the inner bash, from its arguments
  run_tool "decryption failed (wrong key, or a damaged bundle)" bash -o pipefail -c \
    'age -d -i "$1" "$2" | tar -xOf - bundle/inventory.txt > "$3"' _ "$REFRAIN_BACKUP_IDENTITY_FILE" "$1" "$2"
}

cmd_reconcile() {
  local candidate=${1:-} newer=${2:-}
  command -v age >/dev/null || die "age is not installed"
  [[ -n ${REFRAIN_BACKUP_IDENTITY_FILE:-} && -f $REFRAIN_BACKUP_IDENTITY_FILE ]] ||
    die "REFRAIN_BACKUP_IDENTITY_FILE is not a file"
  new_work_directory
  inventory_of "$candidate" "$work/candidate.txt"
  inventory_of "$newer" "$work/newer.txt"
  # entry|<id>|<kind>|deleted=<bool>|<locale:status,...>
  awk -F'|' -f "$HERE/reconcile.awk" "$work/newer.txt" "$work/candidate.txt" | sort
  say "reconciled: entries above were deleted or changed after the candidate backup; review each before the restored copy is used"
}

tables_verified=0
case "${1:-}" in
  backup) cmd_backup "${2:-}" ;;
  check) cmd_check "${2:-}" ;;
  drill) cmd_drill "${2:-}" ;;
  reconcile) cmd_reconcile "${2:-}" "${3:-}" ;;
  *) die "usage: refrain-backup backup <empty dir> | check <bundle.tar.age> | drill <bundle.tar.age> | reconcile <candidate.tar.age> <newer.tar.age>" ;;
esac
