# Evidence: G8 step 2, the lock order and catalog-aware fingerprints

**Status: draft pull request, stacked on step 1 (#116), not merged, not deployed.** Recorded on 2026-11-16. It is step 2 of [ADR 0013 § 7](../decisions/0013-confirmed-catalog-changes-to-published-pages.md#7-implementation-in-small-reviewable-pull-requests), authorized by the owner on 2026-11-16.

**What it does not do:**
- it adds no `catalog_change` token and no Studio dialog (step 3);
- it gates no catalog command with a confirmation (steps 3 and 4);
- it makes no migration;
- it implements nothing of R1;
- it does not close G8.

A catalog edit made while no publication is in progress still changes a served page unconfirmed until steps 3 and 4.

## The lock order (ADR 0013 § 4.1 and § 4.4)

One helper, `lockInOrder` in [`src/modules/publication/catalog-locks.ts`](../../src/modules/publication/catalog-locks.ts), takes every row lock in one order:
1. entries `FOR SHARE`, in one statement, ascending id;
2. then albums, artists, and tracks, each in ascending id.

A row asked for twice keeps the strongest mode, so no transaction upgrades a lock it holds. Each command builds its plan from reads taken before the locks, and decides only from statements after them.

| Command | Before | Now |
| --- | --- | --- |
| `updateArtist`, `archiveArtist`, `restoreArtist`, `setArtistPhoto` | album-journal entries, then the artist | entries (album journals **and memories**), the albums crediting the artist or containing a track crediting it `FOR SHARE`, the artist `FOR NO KEY UPDATE`, the tracks crediting it `FOR SHARE`; then the decision |
| `updateAlbum` | credit entries only with a credit change; album; artists | always: the album's journals, memories linking the album or its tracks, (credit change) the journals of albums crediting the new artists; the album `FOR UPDATE`; stored and new artists `FOR SHARE`; tracks `FOR SHARE`; then the decision |
| `setAlbumTracklist`, `addTrackToAlbum`, `removeTrackFromAlbum`, `moveTrackInAlbum` | the album row only | the same entries, the album `FOR UPDATE`, its artists and tracks `FOR SHARE`, the tracks it adds `FOR NO KEY UPDATE` |
| `createTrack` with an album | **inserted the track and its credits, then locked the album** | locks the entries, the album, and the named artists **before inserting anything** |
| `updateTrack` | **locked the track first** | entries (journals of every containing album, memories linking the track or those albums), those albums `FOR SHARE`, stored and new artists `FOR SHARE`, then the track `FOR UPDATE`; it decides only after |
| `importMusicRelease` | **inserted the album, credits, and tracks with no lock** | locks the memories linking the recordings it would reuse, the albums containing them, the reused artists, and the reused recordings, **before inserting**; `resolveArtists` and `resolveTracks` read again after the locks |
| `setAlbumArtwork`, `removeAlbumArtwork` | **decided after the entry locks, before the album lock** | the entries, the album `FOR NO KEY UPDATE`, its artists and tracks; **then** the decision |
| `deleteAlbum` | a bare delete | in a transaction, after the album's locks |
| `linkAlbumToMusic` | the album row | the album's journals, then the album |
| An album journal's publication, unpublication, deletion | the entry | the entry `FOR UPDATE`, then the album and its credited artists `FOR NO KEY UPDATE`, and the tracks its page renders `FOR SHARE` |
| An album journal's confirmed save | the entry | the entry, then its album, artists, and rendered tracks `FOR SHARE` |
| A memory's publication or confirmed save | the entry | the entry, then the linked albums and every album containing a linked track, the artists credited on them, and the linked tracks, `FOR SHARE` (a save: its links before and after). **After the track locks it reads the tracks' credits and containing albums again; a difference answers `confirmation_stale`** |

The `lockAlbumCreditExposure` export is replaced by `lockAlbumCatalogChange`, and the reviewed export list in `src/testing/publication-scans.ts` is updated to match. The new exports are `lockAlbumCatalogChange`, `lockTrackCatalogChange`, `lockReleaseImport`, and `lockAlbumJournalTransition`. Each only takes row locks.

## Catalog wording in fingerprints (ADR 0013 § 5)

[`src/modules/publication/catalog-binding.ts`](../../src/modules/publication/catalog-binding.ts) reads it. The preview reads it in its snapshot; the confirmation reads it under the locks above. It is fingerprint material only: it is never shown to a reader, and the disclosure's shape is unchanged.

- **Publishing an album journal**, the page's catalog atoms as they will be once it is served:
  - the album's id, title, year, label, and stored cover (whatever the cover switch says);
  - each credit's shown name, with its link's presence and address, computed over the public artists plus the ones the publication opens;
  - the reference edition's tracks (id, title, credit, disc, position);
  - the tracks its flagged reflections name;
  - the served memories linking the album or one of its tracks (they may name or link it);
  - the served memories on which a credit becomes a link, because the publication opens that artist's page.
- **Publishing a memory:**
  - each link's rendered wording (title, artists with link and address, the album named and its link), through the same SQL as the page;
  - the id of the album each link names, and that album's year and credited names.
- **A confirmed save:**
  - an album journal: its page's atoms;
  - a memory: the rendered wording of its links before and after the save, including links the save adds.
- **Languages:** catalog wording is the same in every language, and the publication of each language version binds it. The EN and `/pt` reflections are already bound per version.
- The memory page and the binding share one SQL (`renderMusicLinks` in `memory-music.ts`), so they cannot disagree.

The engines' rules are unchanged:
- no token: `confirmation_required`;
- expired, read after the locks: `confirmation_expired`;
- another state: `confirmation_stale`, with the fresh disclosure or delta, and nothing written.

## Tests

| Property | Test |
| --- | --- |
| Album journal, after the preview: rename the credited artist, retitle the album, change the year, label, a credit's wording, a track's title or credit, the reflected track, reorder or remove a track, change the stored cover, a namesake becoming public, a memory on its track published. Each is `confirmation_stale`, every table's checksum is unchanged, the version is not published. **EN and `pt-BR`** | `catalog-binding.integration.test.ts` (26 cases) |
| Not stale: an unrelated artist's rename, a track's own artists (not on an album-journal page), draft, private, and deleted memories on its tracks | the same |
| Memory, after the preview: song retitled, singer renamed, song's artists changed, the named album switching (another album moved earlier), the named album's credits, the song added to another album, the named album gaining a served journal | the same (7 cases) |
| Not stale: retitling an album the memory does not name | the same |
| Confirmed saves: a track renamed between an album journal's preview and save; a reflection the save makes public on a track outside the reference edition, renamed before the save (found by the review); a song added, then renamed before a memory's save (stale, nothing written); an unlinked song's rename (not stale) | the same |
| Inverted to the new rule: the two tests that recorded gap C11 (`publish.integration.test.ts`, `memory-publishing.integration.test.ts`) now expect `confirmation_stale` | those files |
| **Concurrency on PostgreSQL**, separate connections, committed synthetic rows: a publication waits for an uncommitted track rename, then refuses as stale; a catalog edit waits for a publication holding the journal, then commits; a track rename waits for a memory publication's share lock; the memory lock's re-read catches a credit added while it waited; 8 rounds of 10 racing transactions (two publications, an album journal's and a memory's save, artist rename, track and credit change, tracklist rewrite, album credits, `createTrack` with the album, `removeAlbumArtwork`) end with **no deadlock**, at least one success, and only known answers (`succeeded`, `confirmation_stale`, `version_conflict`, `confirmation_required`, A3's `public_page`) | `catalog-locks.concurrency.integration.test.ts` |
| Step 1 inside a command's locks: `catalogPublicImpact` runs in a savepoint under `lockAlbumCatalogChange`, and the album stays locked afterwards (`55P03` for another session's `nowait`) | the same |
| **Static lock order:** `lockInOrder` takes entries, albums, artists, then tracks, ascending, with the strongest mode; each of the 20 commands takes its helper before its decisions and writes; an entry command takes its own entry first; no other catalog-row lock exists except a listed re-lock of a row the helper holds, or identifier-only rows | `catalog-locks.test.ts` |
| The existing static tests of A5's guards, adapted to the new helper with the same guarantees (entries in id order, then the artist row in a write mode, then the decision) | `src/app/public-surface.test.ts` |

**Mutation checks**, run by hand and reverted:
- removing the catalog material from both fingerprints made 31 of the (then) 38 binding tests fail. Of the other 7, 3 expect no staleness, and 4 stay stale through A5's existing binding of the artist pages a publication opens: the credited artist's rename and a namesake becoming public, in EN and `pt-BR` (checked by listing the passing tests);
- dropping the memory re-read made the re-read test fail;
- dropping the publication's track lock made the waiting test fail.

## Checks run

| Check | Result |
| --- | --- |
| `pnpm install --frozen-lockfile` | Lockfile unchanged |
| `pnpm lint`, `pnpm format:check`, `pnpm typecheck` | Clean |
| `pnpm test` | 61 files, **1,398 passed** |
| `pnpm test:integration`, disposable PostgreSQL 17.11 | 41 files, **873 passed** |
| `pnpm test:integration`, disposable **PostgreSQL 18.6** (`pnpm db:test18:up`, port 5434) | 41 files, **873 passed** |
| `pnpm build` | Succeeded |
| `pnpm test:http` | 22 files, **809 passed** |
| `pnpm test:e2e:run` | **359 passed, 4 skipped**, 0 failed (at `95aa3e8`; the review's fixes change no page, and CI runs the browser tests on the final head) |

## Independent security and concurrency review

Read-only, in a separate context, at `95aa3e8`, using the repository's security-review method. It reran the unit suite and the integration suite on PostgreSQL 18. **GO** for a draft step 2, with **no Critical, High, or Medium finding**.

It found:
- the lock order sound across the 20 commands, with no constructible deadlock cycle;
- every re-lock in the same mode or a weaker one;
- the fingerprints identical at preview and confirmation;
- privacy unchanged, with the disclosure's shape intact;
- ADR 0006 preserved, and no test weakened.

| Finding | Done |
| --- | --- |
| Low: a confirmed save did not bind or lock a reflection it newly makes public on a track outside the reference edition (reproduced: `succeeded` instead of `confirmation_stale`) | Fixed: the save binds and locks the tracks its predicted state reflects; regression test, which fails without the fix |
| Low: ADR 0013 § 4.5 said deadlocks answer "the existing generic retry error", which does not exist | The ADR now says they roll back and write nothing, surfacing unmapped until step 3 maps them |
| Low: the race did not include the saves, `createTrack`, or an artwork command | Added (10 transactions per round) |
| Info: the mutation note's "other 7" | Corrected, after listing the passing tests |
| Info: a test named "an artist rename" ran a track rename | Renamed |
| Info: plans read before their locks; a memory save adding a link re-reads its new album's credits without comparing them | Recorded: the consequence is an edit that could equally have committed just after the save, which step 2 still allows (steps 3 and 4) |

## Remaining concurrency risks (not closed by step 2)

- **Unconfirmed catalog edits:** while no publication is in progress, a catalog edit still changes a served page unconfirmed. Steps 3 and 4 gate the commands. Until then step 2 only guarantees that an edit and a publication serialize, and that the second one sees the first.
- **R1:** publishing or unpublishing another album's journal can change the album a served memory names, with no token. It is not decided here, and G8 needs it.
- **Reductions and namesakes** (ADR 0013 § 4.6):
  - an unpublication, deletion, or archive committing between a reader's comparison and its write leaves the confirmed state minus that reduction;
  - a namesake's transition on another artist row can move a derived address after the comparison.
- **Deadlocks:** the races found none, which is evidence, not proof. A deadlock would surface as PostgreSQL's `40P01` through each module's existing translation of an unknown error (rolled back, nothing written). Mapping it to a fixed retry code is left to step 3, with the gate's other error codes.
- **More waiting:** catalog commands now share-lock entries (memories included), and publications lock catalog rows. A long catalog command can make a publication wait, and the reverse. At a personal journal's size this is short.
- **Conservative staleness:** a publication binds the served memories that link the album or its tracks, a superset of those whose page changes. An unrelated publication of such a memory makes a pending confirmation stale; the author confirms again.
- **The publish dialog** shows a memory's music, but not every catalog atom it now binds for an album journal (the label, the tracklist). The binding is stricter than the dialog. Showing every bound atom is part of step 3's dialog work.

## Step 1 under the new locks

`catalogPublicImpact` keeps working inside a command's transaction: it runs in a savepoint, its temporary copies are dropped by the savepoint's rollback, and the command's locks stay held (tested).

It still needs the database role's **`TEMPORARY` privilege**, a PostgreSQL default; this is recorded, not checked on a hosted database, and no hosted role was touched.

**Cost:** each call copies the eight catalog tables and renders every served page twice per language. That is fine at a personal journal's size. Step 3 should measure it on a realistic synthetic catalog before wiring it into every edit.

## Step 3 prerequisites

- Map PostgreSQL errors (`40P01`, a missing `TEMPORARY` privilege) to fixed codes.
- The `catalog_change` purpose and `previewCatalogChange`.
- Guarded writers set the subject's `updated_at` strictly increasing in SQL, and the fingerprint reads it as text (ADR 0013 § 3.5).
- Show every bound atom in the dialogs.
- Measure the impact's cost.
- The pre-deployment inventory (ADR 0013 § 5) before deploying step 2 anywhere. No database is assumed to hold no real writing.
