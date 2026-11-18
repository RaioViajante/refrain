-- Recovery step 4 (docs/hosted-backups.md § Recovery, ADR 0007 § 3): before
-- the application uses a database restored from a backup, nothing in it is
-- public. Every published language version becomes private and its
-- published_at is cleared, as the Publication module's own restore does
-- (src/modules/publication/commands.ts); first_published_at, the entries'
-- history, and the slugs are kept, so a URL that was public stays reserved.
-- The author republishes through the Studio's confirmed workflow (ADR 0006).
--
-- Run by the owner, on the NEW database only, never on the serving one:
--   psql "<owner connection to the restored database>" -f ops/backup/recovery-demote.sql
-- One transaction; it fails, changing nothing, if anything published remains.
\set ON_ERROR_STOP on
\pset format unaligned
\pset tuples_only on

begin;

with demoted as (
  update public.entry_texts
     set status = 'private', published_at = null, updated_at = now()
   where status = 'published'
  returning 1
)
select 'demoted|' || count(*) from demoted;

do $$
begin
  if exists (select 1 from public.entry_texts where status = 'published') then
    raise exception 'published language versions remain; nothing was changed';
  end if;
end
$$;

commit;
