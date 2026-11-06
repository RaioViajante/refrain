-- Read-only release check for a restored database (docs/hosted-backups.md §
-- Recovery): it fails (psql exits non-zero) while any language version is
-- published, so DATABASE_URL is not switched, and public reads are not
-- enabled, before recovery-demote.sql has run. Run it immediately before the
-- switch:
--   psql "<connection to the restored database>" -f ops/backup/recovery-check.sql
\set ON_ERROR_STOP on
\pset format unaligned
\pset tuples_only on

begin transaction read only;

select 'published|' || count(*) from public.entry_texts where status = 'published';

do $$
begin
  if exists (select 1 from public.entry_texts where status = 'published') then
    raise exception 'the restored database still has published language versions: run recovery-demote.sql first';
  end if;
end
$$;

commit;
