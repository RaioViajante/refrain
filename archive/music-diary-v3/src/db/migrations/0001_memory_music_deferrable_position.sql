-- Custom migration: Drizzle cannot declare deferrable constraints.
--
-- At most one item per position in a memory's music list. The check is
-- deferred to commit, so the list can be reordered with ordinary UPDATEs in
-- one transaction (docs/data-model.md, transaction boundary "Reorder memory
-- music"). It is not declared in src/db/schema.ts; see the comment on
-- memory_music there.
ALTER TABLE "memory_music"
  ADD CONSTRAINT "memory_music_position_unique"
  UNIQUE ("memory_id", "position")
  DEFERRABLE INITIALLY DEFERRED;
