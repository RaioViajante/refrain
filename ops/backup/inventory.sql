-- Inventory of a Refrain database at backup time: identifiers and states only,
-- never titles, writing, or slugs. It travels inside the encrypted bundle.
-- During a recovery it lets the owner see what the restored copy holds that a
-- later backup no longer held (writing deleted permanently since), and what
-- was public, before anything becomes public again (docs/hosted-backups.md §
-- Recovery). Read-only; runs in the same exported snapshot as the dump.
\set ON_ERROR_STOP on
\pset format unaligned
\pset tuples_only on

select 'entry|' || e.id || '|' || e.kind || '|deleted=' || (e.deleted_at is not null)
       || '|' || coalesce(string_agg(t.locale || ':' || t.status, ',' order by t.locale), '')
  from public.entries e
  left join public.entry_texts t on t.entry_id = e.id
 group by e.id, e.kind, e.deleted_at
 order by 1;

select 'reflection|' || r.id || '|journal=' || r.album_journal_id || '|published=' || r.is_published
  from public.track_reflections r
 order by 1;
