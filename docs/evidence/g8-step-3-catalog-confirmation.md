# Evidence: G8 step 3, confirmed catalog edits and the review dialog

**Status: draft pull request, stacked on step 2 (#117), not merged, not deployed.** Recorded on 2026-11-16. It is step 3 of [ADR 0013 § 7](../decisions/0013-confirmed-catalog-changes-to-published-pages.md#7-implementation-in-small-reviewable-pull-requests), authorized by the owner on 2026-11-16.

**Not in it:**
- the tracklist commands and `createTrack` are not gated (step 4);
- no migration;
- nothing of R1;
- G8 is **not** closed.

## What it adds

- **The token:** ADR 0006's `ct1` gains a third purpose, `catalog_change`. The purpose is a signed claim checked on verification, so a `catalog_change` token is never accepted as `publish` or `change_public`, nor the reverse. `e` is the subject (`artist:<id>`, `album:<id>`, `track:<id>`) and `n` is `1`.

  The fingerprint binds:
  - the subject and the exact operation and values;
  - every affected page (kind, interface language, address, and the address after a move);
  - every changed atom before and after, **and every catalog atom the page renders before the change**;
  - every moved artist address, namesakes included;
  - each affected entry's version, stamps, and language-version statuses;
  - the subject's `updated_at`, read as text with microseconds.
- **The engine** ([`src/modules/publication/catalog-confirmation.ts`](../../src/modules/publication/catalog-confirmation.ts)):
  - **`previewCatalogChange`** reads the impact in one REPEATABLE READ snapshot and mints the token. It mints none when nothing served changes, or when the change would open an artist page.
  - **`verifyCatalogChangeConfirmation`** authenticates the token before any lock: the MAC, the purpose, the author's session, and the subject.
  - **`requireCatalogChangeConfirmation`** is the gate. It runs inside the command after § 4.1's locks, recomputes the impact and the fingerprint, and checks the expiry by the database clock read after the locks. It answers `confirmation_required`, `_expired`, or `_stale` before anything is written. **A token that was presented is always checked**, even when nothing served changes any more, so an applied or outdated token is refused, never ignored.
- **The commands** `updateArtist`, `updateAlbum`, and `updateTrack`:
  - **no public impact:** behaviour unchanged;
  - **an impact with no token:** refused, nothing written;
  - **a valid token:** the change is applied as reviewed, and the subject's `updated_at` then moves strictly forward (`greatest(clock_timestamp(), updated_at + 1 µs)`), so the token can never match again, even after A → B → A;
  - **a change that would open an artist page:** `public_page`, token or not (A5), on top of the existing credit refusal.

  Fields no page renders (sort name, kind, identifiers, an edition's date and country, a track's length) make no operation.
- **Failing closed:** a deadlock or serialization failure (`40P01`, `40001`) is `retry`. Any failure to compute the impact is `impact_unavailable`: a missing `TEMPORARY` privilege, a statement over 5 s, a computation over 20 s, more than 5,000 served pages, a temporary copy in the way, or any other database error. No database message reaches the Studio, and nothing is written.
- **The Studio:**
  - **The dialog:** "Update the published pages?" (`src/app/studio/catalog/catalog-change-dialog.tsx`), in English and Portuguese. It lists every affected page by kind, language, and localized address, with each changed piece of wording before (struck through) and after. It also lists every artist address that moves, opens, or closes, and states in words that an old artist address will answer 404 because no redirect is kept. Focus starts inside the dialog, not on Confirm; Confirm and Cancel are distinct 44 px controls; Cancel keeps the edit in the form and saves nothing.
  - **The token's path:** the preview action is alone in its own file and is the only place a Studio request mints a `catalog_change` token. The token lives only in the dialog's state and is sent only from its confirm control, inside the edit's input.
  - **The scans:** the publication scans and the Studio's no-publishing test list the new preview, consumers, dialog, and token file.
- **The existing reviews:** the publication review and the confirmed-save review of an album journal now show the catalog wording their fingerprints bind: the album's title, year, label, credits with artist addresses, and the tracklist ("The album on the published page"). This closes step 2's recorded discrepancy. A memory's review already showed its music.

## Tests

| Property | Test |
| --- | --- |
| No impact: saved as before, no token; a field no page renders on a public record: saved as before | `catalog-confirmation.integration.test.ts` |
| An impact without a token: `confirmation_required` for the three commands, every catalog and entry table unchanged | the same |
| A valid token: saved exactly as reviewed; the review lists the album journal, artist page, archives, Home, and sitemap, and the address, with no internal id | the same |
| Another value (`stale`), another artist (`invalid`), a token re-signed for another subject (`stale`), another session (`invalid`), the `publish` and `change_public` purposes (`invalid`), and a catalog token at the publication command (`invalid`); nothing written | the same |
| Expired by the database clock | the same |
| A replay at once, and A → B → A with the first token, are stale; `updated_at` moves forward even inside one transaction | the same |
| Another confirmed edit to the same page after the review: stale, nothing written | the same |
| A5: a credit that would open an artist page is `public_page` at the preview and at the command | the same |
| A namesake: both addresses move, the namesake's own journal is listed for its link, refused without the token, applied with it | the same |
| Fails closed: a temporary copy in the way gives `impact_unavailable`, nothing written | the same |
| **Concurrency on PostgreSQL:** two confirmed edits of one artist race (one saved, one stale); a publication between the review and the confirmation makes it stale | the same |
| Error mapping: `40P01` and `40001` to `retry`; the gate's refusals passed on; a missing privilege (`42501`), a timeout (`57014`), or anything else to `impact_unavailable`, with no database detail | `catalog-failures.test.ts` |
| The impact, still the real commands' oracle, with the pages limited to a superset of those the change can touch | `catalog-impact.integration.test.ts` (unchanged expectations, all pass) |
| **Browser, EN and `/pt`, 1280 and 390 px:** the review opens on saving a published artist's rename and lists the journal, the new name, and the 404 notice; nothing is saved; Confirm is not focused first; both controls are 44 px; no horizontal overflow; Cancel keeps the edit and saves nothing; Confirm with the keyboard saves the reviewed name; an unpublished artist's rename saves with no dialog | `e2e/catalog-confirmation.spec.ts` (projects `desktop`, `catalog-confirmation-390`) |

Tests that edit public records through the commands now go through the confirmed path (`src/testing/confirmed-catalog-edits.ts`: the review, then the edit with its token). No assertion was loosened.

## Performance

`catalog-impact.bench.integration.test.ts` runs only with `REFRAIN_BENCH=1`, on the disposable PostgreSQL 18.6 server, in a rolled-back transaction. The synthetic catalog:
- 200 artists;
- 300 albums of 12 tracks (3,600 tracks);
- 120 served album journals, 40 of them also in Portuguese;
- 80 served memories.

| Measurement | Result |
| --- | --- |
| Rendering every served page twice (step 1's method) | **over 20 s**: hit the limit and failed closed |
| With the pages limited to those that can render a touched record (`candidatePages`): an artist rename | **≈1.3 s** per impact (1,293, 1,267, 1,278 ms), preview 1,277 ms, 9 affected pages |

The scope is a deliberate superset:
- the touched albums, tracks, and artists, one level of containment both ways;
- the artists credited on them;
- every public namesake of a touched artist's name, before or after.

The lists (archives, Home, sitemap) are always rendered. The tests that compare against the real commands' full renders all pass with it.

## Independent security and concurrency review

Read-only, in a separate context, at `4617097`. It reran 89 integration tests on PostgreSQL 18 and the unit suite. **GO** for a draft. It confirmed:
- the token's purpose, subject, and session isolation;
- the expiry by the database clock after the locks;
- single use, including A → B → A within a millisecond;
- the gate placed before every write, and A5 at both the preview and the command;
- privacy unchanged, and no test weakened.

| Finding | Done |
| --- | --- |
| **High:** the page scope missed pages when a rename collides with another artist's *suffixed* address, not only a namesake's base. Reproduced: 11 pages listed against 15 changed; the confirmed edit succeeded | Fixed. The scope now starts from the artists whose address actually differs: both address maps are computed over every public artist, the change applied to copies in an always-rolled-back savepoint. **A post-check fails closed** (`impact_unavailable`) if any moved address is outside the scope. Regression test with the reviewer's case, against the full-render oracle |
| Low: a token sent with an edit that makes no operation (a sort name only) was not checked | Refused as `confirmation_stale`; tested |
| Low: the limits (statement timeout, deadline, page cap, `TEMPORARY`) are tested only through the error mapping | Recorded. Exercising them needs injectable limits or a role without `TEMPORARY` on the shared disposable database; left for step 4 |
| Info: the dialog shows the stale message for an expired or invalid token too; `onNothingToConfirm` resaves without a token | Recorded. The author's action is the same (review again); both fail closed |

**A flaky check found while fixing these:** two refusal tests compared checksums of whole tables under READ COMMITTED. They failed when another suite committed rows to the shared disposable database at the same moment. They now read one REPEATABLE READ snapshot, as the impact tests do; the assertion that a refusal writes nothing is unchanged. The HTTP suite's test that enumerates every Server Action now includes the new preview action.

## Not verified, and risks

- **Hosted databases:** the `TEMPORARY` privilege and the cost there are not checked; no hosted access is authorized. Without the privilege, every confirmable edit to a public record answers `impact_unavailable`, writing nothing.
- **Larger catalogs** than the benchmark's could reach the 20 s limit. That fails closed: the edit is refused, nothing written.
- **The scope filter's completeness** rests on the oracle tests' coverage. A page kind or relation added later must be added to `candidatePages`.
- **Step 4 remains:** the tracklist commands and `createTrack` with an album, the refusals of § 1.3 (`deleteAlbum` with a served-memory track, the `importMusicRelease` reuse case), and the static coverage test over every catalog writer. Until then those still change served pages unconfirmed.
- **R1** remains, and **G8 stays open.**
