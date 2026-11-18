-- The dedicated backup role (docs/hosted-backups.md § The backup role).
-- For the owner's review. NOT applied to production: provisioning is a
-- separate, explicitly authorized step, run by the database owner in psql:
--
--   psql "<owner connection, direct, sslmode=verify-full>" \
--     -v backup_role=refrain_backup -v owner_role=neondb_owner -v database=neondb \
--     -f ops/backup/backup-role.sql
--   then, in the same psql session: \password refrain_backup
--
-- The password is set interactively with \password (it never appears in a
-- file, a command line, or the server log as plain text) and is generated in
-- the password manager (60+ bits of entropy, as Neon requires).
--
-- What the role can do: connect, read every table and sequence in the schemas
-- `public` and `drizzle` (all pg_dump needs for a complete logical backup of
-- the application), and nothing else. It is not a member of any role, owns
-- nothing, cannot write, create, or change roles, and does not bypass
-- row-level security: if RLS is ever enabled, pg_dump fails loudly instead of
-- silently dumping part of a table (it sets row_security = off and errors).
--
-- Why explicit grants and not pg_read_all_data: that predefined role reads
-- every table, view, and sequence in EVERY schema and database of the server,
-- now and in the future. The application lives in two schemas; the grants
-- below are exactly those, and the default privileges extend them to tables
-- the owner role creates later (a migration). A table created by any other
-- role is not readable, so the backup fails and reports it: fail closed.
\set ON_ERROR_STOP on

create role :"backup_role" with
  login
  nosuperuser nocreatedb nocreaterole noreplication nobypassrls
  noinherit
  connection limit 3;

-- Defense in depth, not a boundary (a session can change these): sessions of
-- this role are read-only by default and cannot run or idle forever. The
-- idle limit is above the backup job's own timeout, because the session that
-- holds the exported snapshot is idle in its transaction while pg_dump runs.
alter role :"backup_role" set default_transaction_read_only = on;
alter role :"backup_role" set statement_timeout = '20min';
alter role :"backup_role" set idle_in_transaction_session_timeout = '30min';

grant connect on database :"database" to :"backup_role";
grant usage on schema public, drizzle to :"backup_role";
grant select on all tables in schema public, drizzle to :"backup_role";
grant select on all sequences in schema public, drizzle to :"backup_role";
alter default privileges for role :"owner_role" in schema public, drizzle
  grant select on tables to :"backup_role";
alter default privileges for role :"owner_role" in schema public, drizzle
  grant select on sequences to :"backup_role";
