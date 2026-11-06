-- Fingerprint of a Refrain database, for comparing a source with the copy
-- restored from its backup (docs/hosted-backups.md). Read-only: it runs as the
-- backup role, inside the source's exported snapshot, and again on the
-- restored copy; the two outputs must be byte-identical.
--
-- One line per fact, in a fixed order. It covers the schemas `public` and
-- `drizzle` (the application and its migration history):
--   - the structure: tables, columns, constraints (with their validation
--     state), indexes, sequences, enum types, functions, triggers, views, and
--     row-level-security settings and policies;
--   - the data: for every table, its row count and an md5 over the text of
--     every row in a fixed order, so a changed value anywhere differs. The
--     digests travel only inside the encrypted bundle and are never printed.
-- A table whose rows a backup deliberately leaves out (:excluded) is listed
-- without a count; the restore check proves separately that it is empty.
-- Owners and privileges are not compared: a backup is restored with
-- --no-owner --no-privileges, and the recovery procedure grants them again.
--
-- psql variable: excluded, a list of quoted, schema-qualified table names,
-- for example: 'public.auth_sessions','public.auth_rate_limits'.
\set ON_ERROR_STOP on
\pset format unaligned
\pset tuples_only on
\pset null '<null>'

-- Any other schema with tables would not be in the backup (it dumps public
-- and drizzle only), so it is listed and the comparison fails loudly.
select 'schema|' || n.nspname
  from pg_namespace n
 where n.nspname not in ('pg_catalog', 'information_schema', 'pg_toast')
   and n.nspname not like 'pg\_temp\_%'
   and n.nspname not like 'pg\_toast\_temp\_%'
   and (n.nspname in ('public', 'drizzle')
        or exists (select 1 from pg_class c where c.relnamespace = n.oid and c.relkind in ('r', 'p', 'v', 'm', 'S')))
 order by 1;

select 'table|' || n.nspname || '.' || c.relname || '|' || c.relkind::text
       || '|rls=' || c.relrowsecurity || '|force=' || c.relforcerowsecurity
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname in ('public', 'drizzle') and c.relkind in ('r', 'p', 'v', 'm', 'S')
 order by 1;

select 'column|' || n.nspname || '.' || c.relname || '|'
       || row_number() over (partition by c.oid order by a.attnum) || '|' || a.attname
       || '|' || format_type(a.atttypid, a.atttypmod) || '|notnull=' || a.attnotnull
       || '|default=' || coalesce(pg_get_expr(d.adbin, d.adrelid), '')
       || '|identity=' || a.attidentity::text || '|generated=' || a.attgenerated::text
  from pg_attribute a
  join pg_class c on c.oid = a.attrelid
  join pg_namespace n on n.oid = c.relnamespace
  left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
 where n.nspname in ('public', 'drizzle') and c.relkind in ('r', 'p', 'v', 'm')
   and a.attnum > 0 and not a.attisdropped
 order by 1;

select 'constraint|' || n.nspname || '.' || c.relname || '|' || k.conname || '|' || k.contype::text
       || '|' || pg_get_constraintdef(k.oid) || '|validated=' || k.convalidated
  from pg_constraint k
  join pg_class c on c.oid = k.conrelid
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname in ('public', 'drizzle')
 order by 1;

select 'index|' || n.nspname || '.' || c.relname || '|' || i.relname || '|' || pg_get_indexdef(x.indexrelid)
       || '|valid=' || x.indisvalid
  from pg_index x
  join pg_class i on i.oid = x.indexrelid
  join pg_class c on c.oid = x.indrelid
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname in ('public', 'drizzle')
 order by 1;

select 'sequence|' || s.schemaname || '.' || s.sequencename || '|' || s.data_type || '|start=' || s.start_value
       || '|increment=' || s.increment_by || '|min=' || s.min_value || '|max=' || s.max_value || '|cycle=' || s.cycle
  from pg_sequences s
 where s.schemaname in ('public', 'drizzle')
 order by 1;

select 'type|' || n.nspname || '.' || t.typname || '|' || string_agg(e.enumlabel, ',' order by e.enumsortorder)
  from pg_type t
  join pg_namespace n on n.oid = t.typnamespace
  join pg_enum e on e.enumtypid = t.oid
 where n.nspname in ('public', 'drizzle')
 group by n.nspname, t.typname
 order by 1;

select 'function|' || n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')|'
       || md5(pg_get_functiondef(p.oid))
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname in ('public', 'drizzle') and p.prokind in ('f', 'p')
 order by 1;

select 'trigger|' || n.nspname || '.' || c.relname || '|' || t.tgname || '|' || pg_get_triggerdef(t.oid)
  from pg_trigger t
  join pg_class c on c.oid = t.tgrelid
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname in ('public', 'drizzle') and not t.tgisinternal
 order by 1;

select 'view|' || schemaname || '.' || viewname || '|' || md5(definition)
  from pg_views where schemaname in ('public', 'drizzle')
 order by 1;

select 'policy|' || schemaname || '.' || tablename || '|' || policyname || '|' || cmd || '|'
       || coalesce(qual, '') || '|' || coalesce(with_check, '')
  from pg_policies where schemaname in ('public', 'drizzle')
 order by 1;

-- The current value of every sequence. Sequences are not transactional, so a
-- value read here can only differ from the dump's if something drew a number
-- during the backup: the comparison then fails and the next run retries.
select format(
         $$select 'sequence-value|%1$s.%2$s|' || last_value || '|' || is_called from %1$I.%2$I$$,
         schemaname, sequencename)
  from pg_sequences
 where schemaname in ('public', 'drizzle')
 order by schemaname, sequencename
\gexec

-- Every table's rows: a count and a digest (or "excluded").
select case
         when format('%I.%I', n.nspname, c.relname) in (:excluded) then
           format($$select 'data|%1$s.%2$s|excluded'$$, n.nspname, c.relname)
         else
           format($$select 'data|%1$s.%2$s|' || count(*) || '|'
                    || coalesce(md5(string_agg(x::text, '|' order by x::text)), 'empty')
                    from %1$I.%2$I x$$, n.nspname, c.relname)
       end
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname in ('public', 'drizzle') and c.relkind in ('r', 'p')
 order by n.nspname, c.relname
\gexec
