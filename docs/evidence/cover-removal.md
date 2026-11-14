# Evidence: removing an album's cover

The owner asked for this change on 2026-11-14 ("remoção segura de capas", PR #102): the cover takedown that [ADR 0009 § 7](https://github.com/RaioViajante/refrain/pull/98) proposes, recorded as [ADR 0006 A8](../decisions/0006-publication-decision-and-acknowledgement.md#a8-removing-an-albums-cover-is-always-allowed). Only that row of ADR 0009 § 7 is adopted. ADR 0009 and ADR 0010 stay proposed, and nothing else in them is built. **Local only:** nothing is deployed, no hosted environment variable changes, public reads stay off on every reachable host, and gates G1 to G8 stay open.

## What changes

| | Before (A3) | Now (A8) |
| --- | --- | --- |
| Remove the cover while a journal about the album is public | Refused (`public_page`): the journal had to be unpublished first | **Allowed.** The journal stays published, and its page shows the fallback frame |
| Remove the cover of an archived album | Refused (`archived_reference`) | **Allowed.** The album stays archived |
| Remove with the cover display switch off | Allowed | Allowed |
| Remove while the Cover Art Archive is unreachable | Allowed (no request is made) | Allowed (no request is made) |
| Locks | The album's journal entries `FOR SHARE`, then the album row | **The album row only** (`FOR NO KEY UPDATE`) |
| A cover other than the one the author saw | `review_stale` | `review_stale` (unchanged) |
| No cover stored | `review_stale` unless the view also saw none | **Succeeds and writes nothing**, whatever the view saw (a repeated removal) |
| Choose or change a cover (`setAlbumArtwork`) | A3's guard, the switch | **Unchanged** |

A removal writes `cover_url` and `cover_source` to null on one album row and nothing else. No publication binds the cover (it is not among ADR 0006 § 1's atoms), so a removal never makes a confirmation stale, never publishes or unpublishes anything, and the publication predicate gives the same answer before and after.

**The Studio.** *Remove artwork…* moved out of the cover chooser, which a status panel replaces when no cover can be chosen. It now sits under the current cover on the artwork page and is shown whenever a cover is stored, in every state: a journal is public, the album is archived, the album is not linked to MusicBrainz, the archive is unreachable, the switch is off. It asks first, and Cancel sends nothing. After a removal, the page says so and moves focus to its heading. The album's page links to the artwork page whenever a cover is stored, also on an unlinked album. The panels for a public journal and an archived album now say that the cover can still be removed. English and Portuguese, with the existing V4.4 components only ([Design System](../design-system.md)).

## Not changed

- `setAlbumArtwork`: still refused while a journal shows the album, for an archived album, and while the switch is off.
- The publication predicate, the confirmation token and its atoms, every lock rule of ADR 0006 § 7, and the public reads.
- Authentication and authorization: the Server Action authorizes first.
- The schema: no migration.
- Imports, linking, and restores never write a cover to an existing album, so a removed cover never comes back by itself.

## Recorded residual

A recovery from a backup taken before a removal brings the cover back with the album row ([ADR 0007 § 3](../decisions/0007-hosted-backups-and-retention.md#3-what-a-recovery-may-do)). That procedure demotes every publication to private, so nothing is public, but the owner must repeat any later takedown before republishing. Backups' inventories carry no covers, so this is a review step, not a mechanical check (A8).

## Tests

| Layer | File | What it shows |
| --- | --- | --- |
| Integration (disposable PostgreSQL) | [`cover-removal.integration.test.ts`](../../src/modules/catalog/cover-removal.integration.test.ts) | Removal for a private album; with the original, only a translation, or both published; for an archived album (published, and then private); with the switch unset, empty, `false`, `TRUE`, and `true`. Every row of every table is identical before and after, apart from the album's two cover columns: entries, versions and statuses, reflections, ratings, favourites, a memory naming the album and its track, and another album's cover. The journal is still public afterwards. A repeated removal leaves the row's physical version (`ctid`) unchanged. A view of another cover, or of none, is `review_stale` with nothing written. Unknown album and malformed input are refused. Archiving and restoring do not bring a cover back; a new choice does. `setAlbumArtwork` is still `public_page` and `archived_reference`. |
| Integration, real connections | the same file | A removal completes while another connection holds the journal entry `FOR UPDATE` (what a publish, unpublish, delete, or restore holds). A removal waits for a cover choice holding the album row, then refuses `review_stale`. A cover choice waits for a removal, then refuses `review_stale`. Two removals at once both succeed. |
| Integration | [`music.integration.test.ts`](../../src/modules/catalog/music.integration.test.ts) | The A3 guard case: a choice is refused while a translation is published, and the removal succeeds |
| HTTP (production build) | [`cover-removal.http.test.ts`](../../src/testing/cover-removal.http.test.ts) | Two servers of one build, public reads on, the switch on and unset. The artwork page offers *Remove artwork…* (*Remover a capa…*) for a public journal's album, an archived album with a served journal, an archived private album, and an unlinked album, in English and Portuguese, with `X-Robots-Tag`. A visitor's removal is `unauthorized` with nothing written. With the switch off, a stale view is refused, the removal succeeds, and a repetition succeeds. The public album journal, the Home, and the album archive are still `200` and show the fallback (EN and PT, document and RSC) with no trace of the removed cover. An archived album's cover is taken down while its journal is served. Another album's cover is untouched. |
| HTTP | [`music.http.test.ts`](../../src/testing/music.http.test.ts) | A choice is `public_page` while the journal is published, the page offers the removal, the removal succeeds and the journal stays published, and after unpublishing a cover can be chosen again |
| HTTP | `studio-actions.http.test.ts` | Unchanged: a visitor's call of `removeAlbumArtworkAction` is refused |
| Browser | [`e2e/cover-removal.spec.ts`](../../e2e/cover-removal.spec.ts) (projects `cover-display-desktop` and `cover-display-390`) | At 1280 and 390 px, in English and Portuguese: a published journal's album shows the public-page panel and *Remove artwork…*; axe passes on the page and the dialog; the button is a 44 px target and nothing scrolls sideways; Cancel writes nothing; the removal shows the fallback, says so, focuses the heading, and leaves the journal published; a reader's page is still `200` with the fallback and requests no cover |
| Browser | `e2e/music.spec.ts` | Unchanged: the removal flow from the artwork page with a confirmation |

**Mutation checks** (each made once on `removeAlbumArtwork`, the file restored from a copy afterwards; each failed at least one test in `cover-removal.integration.test.ts`): the entry locks and the `public_page` refusal restored (6 tests failed); the entry locks alone, with no refusal (the real-connection test failed: the removal waited for the entry); the `archived_reference` refusal restored (1); the stale comparison removed (2); a write even when no cover is stored (1); the album row read without its lock (1).
