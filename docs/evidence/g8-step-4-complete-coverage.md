# Evidence: G8 step 4, tracklists, permanent refusals, and the writer inventory

**Status: draft pull request, stacked on step 3 (#118), not merged, not deployed.** Recorded on 2026-11-16. It is step 4 of [ADR 0013 § 7](../decisions/0013-confirmed-catalog-changes-to-published-pages.md#7-implementation-in-small-reviewable-pull-requests), authorized by the owner on 2026-11-16.

**Not in it:**
- no migration;
- nothing of R1;
- no deployment.

**G8 stays open** until R1 is decided and built, and the final gate verification is done on a protected host.

## What it adds

- **Tracklists confirmed:**
  - `setAlbumTracklist`, `addTrackToAlbum`, `removeTrackFromAlbum`, `moveTrackInAlbum`, and `createTrack` with an album go through the `catalog_change` gate, with the album as the subject. The gate is step 3's: verify the token before the locks, recompute the impact and fingerprint after § 4.1's locks, check expiry by the database clock, refuse with nothing written, and always check a presented token.
  - **One shared computation:** the review and the commands compute the resulting tracklist with the same function (`desiredTracklist`), so they cannot disagree.
  - **A new track** enters the impact under a fixed placeholder id. Pages never render a track's id, and nothing links a new track, so the preview and the command agree whatever id the insert gets.
  - **Replay:** the album's `updated_at` moves strictly forward after each tracklist write, so a token is used once.
  - **The dialog's single consumer** is `editTracklist`: one input, the same commands as the editor's own saves.
- **The Studio:**
  - the tracklist editor opens "Update the published pages?" in EN and PT-BR for an add, a removal, a move, or a new track;
  - the dialog shows each affected page's track titles, positions, order, credits, and links before and after;
  - Cancel keeps the order; Confirm saves it.
- **Permanent refusals** (ADR 0013 § 1.3), decided under the locks, in a statement after them, before any write:
  - **`deleteAlbum`** is refused (`public_page`) while a publicly visible memory links one of the album's tracks. `lockAlbumCatalogChange` already holds those memories' entries `FOR SHARE`, so no publication can change the answer before the delete commits.
  - **`importMusicRelease`** is refused (`public_page`) when reusing a recording would change the album a served memory names.
    - It is decided by the impact of the new album holding the reused recordings, computed with the new album's id at both ends of the order, so the answer holds whatever id the insert gets. A tie that changes no rendered wording is allowed. A recording that gains a reused identifier after the locks were planned makes the import answer `retry`.
    - **New in this step, so the decision is reliable:** the import also share-locks the journals of the albums that already contain the reused recordings. A publication or unpublication of one of them, which would change which album is named, waits for the import, or the import sees it.
  - **A3 and A5** are unchanged: artwork, photograph, a credit that would open a page, and a restore that would open a page are all still refused.
- **Failing closed for real:** the impact's limits can be lowered by tests, never by the application (`impactLimits`, not exported from the module's entry points).

## The writer inventory

`src/modules/catalog/catalog-writers.test.ts` lists every exported function of the Catalog module's three command files, and **fails when one is missing**. For each it checks, in order, the guard text that its class requires. It also fails if any production file outside the Catalog module writes a catalog table (in SQL or through Drizzle), or if the Studio imports a Catalog internal. The temporary copies that the impact writes are `pg_temp.<table>`, checked by the impact's own static test.

| Class | Functions |
| --- | --- |
| **Confirmation when a page changes** | `updateArtist`, `updateAlbum`, `updateTrack`, `createTrack` (with an album; without one a new track is on no page), `setAlbumTracklist`, `addTrackToAlbum`, `removeTrackFromAlbum`, `moveTrackInAlbum`, `editTracklist` |
| **Refused in the protected case, otherwise harmless** | `restoreArtist` (would open a page; A5), `deleteAlbum` (a served memory's track; journals and memory album links are `RESTRICT`), `importMusicRelease` (a served memory's named album), `setAlbumArtwork` and `removeAlbumArtwork` (A3; A8 in #102 would make the removal a reduction), `setArtistPhoto` (A5) |
| **Reductions, allowed by A5 and ADR 0013 § 1.3** | `archiveArtist` (its page closes; credits become plain text), `removeArtistPhoto` (the page shows its fallback) |
| **Harmless to served pages** | `createArtist`, `createAlbum`, `importMusicArtist` (new records: on no page); `deleteArtist` and `deleteTrack` (`RESTRICT` while anything uses them); `archiveAlbum`, `restoreAlbum`, `archiveTrack`, `restoreTrack` (no public read selects their `archived_at`); `linkArtistToMusic` (an identifier no page renders); `linkAlbumToMusic` (identifiers; a created reference edition has no label and no tracks, which the page renders as before) |
| **Readers** (no write, checked) | `previewArtistChange`, `previewAlbumChange`, `previewTrackChange`, `previewTracklistChange`, `searchMusic`, `listMusicEditions`, `reviewMusicRelease`, `reviewMusicArtist`, `listAlbumArtworkChoices`, `listArtistPhotoChoices`, `reviewArtistPhoto` |

**Paths in:**
- the Studio's Server Actions call these through the module's entry point only (checked);
- `editTracklist` dispatches to the commands above;
- the publication scans list every preview that mints a `catalog_change` token, and every consumer;
- the HTTP every-action test covers `editTracklistAction` and `previewCatalogChangeAction`.

## Tests

| Property | Test |
| --- | --- |
| **The five tracklist commands** on a published album, each in turn: `confirmation_required` without a token with every table unchanged; a review that lists the album journal's track atoms; saved with its token; the same token refused on replay. The final tracklist is what was confirmed | `catalog-step4.integration.test.ts` |
| An expired token, another session's token, and a publication's token (another purpose), for a tracklist; each replay answers its exact code (`confirmation_stale`, or `not_found` for a removal) | the same |
| An unpublished album's tracklist: saved as before, no token | the same |
| A journal served only in Portuguese: listed under both interface languages | the same |
| `deleteAlbum` refused while a served memory links its track, nothing written; a private memory's track does not hold it | the same |
| `importMusicRelease` refused when the 1994 fixture release would become a served memory's named album (over a 2000 album), nothing written; allowed when the named album is earlier (1980) | the same |
| **A real statement timeout:** another session holds `album_tracks` exclusively, so the impact's read waits until its 200 ms timeout ends it with SQLSTATE `57014`. The gate's own mapping (`computeImpact`) turns it into `impact_unavailable` with no SQL in the message, and the session's `statement_timeout` is back to `0` afterwards. A command cannot be run under that lock in the test, because its own lock reads wait without a timeout; the deadline and page-cap tests show the command refusing and writing nothing | the same |
| **The deadline and the page cap:** each refuses the rename with `impact_unavailable`, the exact message `Catalog operation refused: impact_unavailable`, and every table unchanged | the same |
| **A role without `TEMPORARY`:** a fresh session, a role created and the database's `TEMPORARY` revoked from `PUBLIC`, both only in a rolled-back transaction. The role cannot create a temporary table (`42501`, probed), the rename answers `impact_unavailable`, and the name is unchanged | the same |
| The step 1 oracle tests now confirm their tracklist edits, and assert that deleting an album a served memory names is refused while the impact still describes the change | `catalog-impact.integration.test.ts` |
| **Browser, EN and `/pt`, 390 px and desktop:** moving a track on a published album opens the review with the page and the moved title; Cancel keeps the stored order; Confirm saves the new order; 44 px Cancel; no horizontal overflow | `e2e/catalog-confirmation.spec.ts` |
| The writer inventory and the no-outside-writer scan | `catalog-writers.test.ts` (45 checks) |
| Steps 1–3's tests (token isolation, replay, A→B→A, namesakes, A5, races, privacy) | unchanged, all pass |

## Performance

`catalog-impact.bench.integration.test.ts`, run with `REFRAIN_BENCH=1` on the disposable PostgreSQL 18.6 server. The synthetic catalog: 200 artists, 300 albums of 12 tracks (3,600 tracks), 120 served journals (40 also in Portuguese), and 80 served memories.

| Measurement | Result |
| --- | --- |
| An artist rename's impact | 1,099, 1,082, 1,077 ms |
| Its review (preview with token) | 1,080 ms |
| A tracklist reorder's impact | 1,369 ms |

The import's refusal computes the impact twice, at about 1.1 to 1.4 s each at this size.

## Checks run

| Check | Result |
| --- | --- |
| `pnpm install --frozen-lockfile` | Lockfile unchanged |
| `pnpm lint`, `pnpm format:check`, `pnpm typecheck` | Clean |
| `pnpm test` | 63 files, **1,459 passed** before the review fixes; the changed unit suites after them: 57 (inventory) and 26 (lock order) passed |
| `pnpm test:integration`, PostgreSQL 17.11 and **18.6** | 43 files each, **899 passed**, 1 skipped (the benchmark); the step 4 suite after the review fixes: 11 passed |
| `pnpm build` | Succeeded |
| `pnpm test:http` | 22 files, **809 passed** |
| `pnpm test:e2e:run` | Run before the review fixes; result in the pull request. CI runs every suite on the final head |

## Independent security and concurrency review

Read-only, in a separate context, at `3c1348c`. **GO** for a draft, with **no Critical, High, or Medium finding**. It confirmed that no tracklist edit or new track changes a served page without a valid token, and that the refusals are decided under the right locks.

| Finding | Done |
| --- | --- |
| Low: the import read the reused recordings once to plan its locks and again to decide; a recording gaining an identifier in between would be unlocked | After the locks, an id that was not planned makes the import answer `retry` |
| Low: the inventory scanned only `export async function` in three files, and Drizzle writes only through `schema.` | It now matches `export function` and `export const … = async`, inventories every exported helper (as a reader where it writes nothing), requires every other file of the module to write nothing, and matches bare table names |
| Low: a lock assertion lost `addedTrackIds` | Restored in `catalog-locks.test.ts` |
| Low: the replay assertion was loose; the "another purpose" test presented no such token; the timeout test runs no command | Exact codes per operation; a publication's token is presented and refused as invalid; the evidence now says what the timeout test shows (the gate's mapping), and that the deadline and page-cap tests show the command refusing with nothing written |
| Info: the "tie refused" wording | Corrected: a tie that changes no rendered wording is allowed |
| Info: `impactLimits` is mutable, protected only by lint; the timeout test's exclusive lock could stall another suite on the same database; `onNothingToConfirm` could loop if preview and command disagreed; a retried `create` after `unreachable` could duplicate a track | Recorded |

## Remaining risks

- **R1 is not resolved.** It is not a claim of this step. Publishing or unpublishing another album's journal still changes the album a served memory names, with no token: the journal's own publication confirms it, but the memory's page changes as a side effect that no review of that memory showed. What R1 needs before G8 can close:
  1. An owner decision between ADR 0010 § 4's stable named-album approaches. Option B, a stored named album, is a migration, which is not authorized.
  2. If the derived rule stays: the album journal publication review must disclose and bind every served memory whose named album or link changes. Step 2 binds those memories' ids, but does not show the change.
  3. Tests of publication and unpublication racing the memory pages.
  4. The owner's review of the evidence.
- **The limits on a hosted database:** the `TEMPORARY` privilege and the cost there are not checked; no hosted access is authorized. Without the privilege, every confirmable edit to a public record is refused (`impact_unavailable`).
- **The scope filter:** its completeness rests on the oracle tests' coverage, plus the step 3 post-check, which fails closed when a moved address is out of scope.
- **Flaky runs seen:** two long-running oracle tests in other files exceeded their own time limits once, during an overlapping PostgreSQL 18 run. A rerun on its own passed everything (899 on PostgreSQL 18 and 899 on PostgreSQL 17).
- **The final gate verification** (G1, G2, and G8 on a protected deployment) remains, with the pre-deployment inventory of ADR 0013 § 5.
