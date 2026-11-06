-- Read-only audit of the backup role's privileges (docs/hosted-backups.md §
-- The backup role). Run by the database owner after provisioning, and by the
-- tests on a disposable database:
--
--   psql "<owner connection>" -v backup_role=refrain_backup -v database=neondb \
--     -f ops/backup/backup-role-audit.sql
--
-- Prints one line per check, `ok|<check>` or `FAIL|<check>|<detail>`, and a
-- last line `result|pass` or `result|fail`. It changes nothing.
\set ON_ERROR_STOP on
\pset format unaligned
\pset tuples_only on

with role as (
  select * from pg_roles where rolname = :'backup_role'
),
checks(name, ok, detail) as (
  select 'role exists', exists (select 1 from role), null::text
  union all
  select 'can log in', coalesce((select rolcanlogin from role), false), null
  union all
  select 'not superuser, createdb, createrole, replication, or bypassrls',
         coalesce((select not (rolsuper or rolcreatedb or rolcreaterole or rolreplication or rolbypassrls) from role), false),
         null
  union all
  select 'member of no role (no inherited or SET ROLE privileges)',
         not exists (select 1 from pg_auth_members m join role r on r.oid = m.member),
         (select string_agg(g.rolname, ',') from pg_auth_members m join role r on r.oid = m.member join pg_roles g on g.oid = m.roleid)
  union all
  select 'no role is a member of it',
         not exists (select 1 from pg_auth_members m join role r on r.oid = m.roleid),
         null
  union all
  select 'owns no object in this database',
         not exists (select 1 from pg_class c join role r on r.oid = c.relowner)
           and not exists (select 1 from pg_namespace n join role r on r.oid = n.nspowner)
           and not exists (select 1 from pg_proc p join role r on r.oid = p.proowner)
           and not exists (select 1 from pg_type t join role r on r.oid = t.typowner),
         null
  union all
  select 'cannot create in the database (schemas)',
         not has_database_privilege(:'backup_role', :'database', 'CREATE'),
         null
  union all
  select 'cannot create in any schema',
         not exists (
           select 1 from pg_namespace n
            where n.nspname not like 'pg\_%' and n.nspname <> 'information_schema'
              and has_schema_privilege(:'backup_role', n.oid, 'CREATE')),
         (select string_agg(n.nspname, ',') from pg_namespace n
           where n.nspname not like 'pg\_%' and n.nspname <> 'information_schema'
             and has_schema_privilege(:'backup_role', n.oid, 'CREATE'))
  union all
  select 'can use the schemas public and drizzle',
         has_schema_privilege(:'backup_role', 'public', 'USAGE')
           and has_schema_privilege(:'backup_role', 'drizzle', 'USAGE'),
         null
  union all
  select 'can read every table in public and drizzle',
         not exists (
           select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname in ('public', 'drizzle') and c.relkind in ('r', 'p', 'v', 'm')
              and not has_table_privilege(:'backup_role', c.oid, 'SELECT')),
         (select string_agg(n.nspname || '.' || c.relname, ',') from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname in ('public', 'drizzle') and c.relkind in ('r', 'p', 'v', 'm')
             and not has_table_privilege(:'backup_role', c.oid, 'SELECT'))
  union all
  select 'cannot insert, update, delete, truncate, reference, or trigger on any table',
         not exists (
           select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname not like 'pg\_%' and n.nspname <> 'information_schema' and c.relkind in ('r', 'p', 'v', 'm', 'f')
              and has_table_privilege(:'backup_role', c.oid, 'INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')),
         (select string_agg(n.nspname || '.' || c.relname, ',') from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname not like 'pg\_%' and n.nspname <> 'information_schema' and c.relkind in ('r', 'p', 'v', 'm', 'f')
             and has_table_privilege(:'backup_role', c.oid, 'INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER'))
  union all
  select 'can read every sequence, and cannot advance or set any',
         not exists (
           select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname in ('public', 'drizzle') and c.relkind = 'S'
              and (not has_sequence_privilege(:'backup_role', c.oid, 'SELECT')
                   or has_sequence_privilege(:'backup_role', c.oid, 'USAGE, UPDATE'))),
         null
  union all
  select 'no column-level write grant',
         not exists (
           select 1 from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
            where n.nspname in ('public', 'drizzle') and a.attnum > 0 and not a.attisdropped
              and has_column_privilege(:'backup_role', c.oid, a.attnum, 'INSERT, UPDATE, REFERENCES')),
         null
  union all
  select 'sessions are read-only by default',
         exists (
           select 1 from pg_db_role_setting s join role r on r.oid = s.setrole
            where 'default_transaction_read_only=on' = any (s.setconfig)),
         null
)
select case when ok then 'ok|' || name else 'FAIL|' || name || '|' || coalesce(detail, '') end
  from checks
union all
select 'result|' || case when bool_and(ok) then 'pass' else 'fail' end from checks;
