# Evidence: G8 step 1, the public impact of a catalog change

**Status: draft pull request, not merged, not deployed.** Recorded on 2026-11-16. It is step 1 of [ADR 0013 § 7](../decisions/0013-confirmed-catalog-changes-to-published-pages.md#7-implementation-in-small-reviewable-pull-requests), the only step the owner has authorized. **Nothing calls it yet:** no command, Server Action, or page changes behaviour, and gate G8 stays open.

## What it adds

`catalogPublicImpact(db, change)` in [`src/modules/publication/catalog-impact.ts`](../../src/modules/publication/catalog-impact.ts). It is server-only, Studio-only, and not exported from the module's entry points yet.

- **Input:** a catalog change as a list of operations, validated with Zod:
  - `update_artist` (name, archived);
  - `update_album` (title, year, the reference edition's label, the complete credit list);
  - `delete_album`, `create_album`;
  - `update_track` (title, credit, artists), `create_track`;
  - `set_tracklist` (the complete list, in reference-edition order, with discs).

  Step 3 maps each command's input onto these.
- **Output:** every served page whose catalog wording would change, per interface language (EN and `/pt`). Each page carries every changed **atom** before and after. The output also lists every public artist address that moves (namesakes included), and whether an artist page would **open**, which A5 refuses.
- **The atoms** are catalog wording and links only:
  - titles, years, labels;
  - credits and their artist links;
  - track lists, artist names and addresses;
  - the album a memory names, and its link;
  - counts and list order.

  Writing, ratings, dates, version languages, and images are never in it.
- **The surfaces:**
  - album-journal pages and memory pages;
  - artist pages;
  - the album, artist, and memory archives;
  - the Home;
  - the sitemap.

  Page metadata is built from the same atoms (album title and credits, artist name), so it is covered.

## How it is computed, and why it cannot disagree with the pages

1. **Before:** every served page is rendered by the public read functions themselves, in both interface languages. They select through the publication predicate and never consult a switch, so pages count with public reads off (ADR 0013 § 1.1).
2. **After:** the same functions render again over **temporary copies** of the eight catalog tables, with the change applied to the copies:
   - a temporary table is private to the session and, unqualified, is found before the permanent one, so the unchanged reads see the changed catalog;
   - entries, versions, slugs, reflections, and memory links are not copied.
3. **The comparison:** atom by atom.

**It writes nothing to any permanent table:**
- **always rolled back:** the computation runs in a transaction (or, inside a caller's transaction, a savepoint) that is always rolled back, which drops the copies;
- **copies only:** each copy is `on commit drop`, and every write names its table literally as `pg_temp.<table>`;
- **checked before and after:** the computation refuses to start if a copy already exists, and checks afterwards that none is left;
- **consistent reads:** called on its own, it reads one REPEATABLE READ snapshot; inside a caller's transaction, it reads under the caller's locks (ADR 0013 § 4.2, for step 3).

## Tests

| Property | Test |
| --- | --- |
| **The impact is exactly what the real command does.** In one rolled-back snapshot: render, compute, run the real catalog command, render again, and compare. Done for `updateArtist`, `updateAlbum` (title, year, label), `updateTrack`, `setAlbumTracklist`, `createTrack` with an album, `deleteAlbum`, and `archiveArtist` | `catalog-impact.integration.test.ts`, every "what a change affects" test |
| An artist rename: album journal, memory, artist page (with its new address), the archives, the Home, and the sitemap, in EN and `/pt` | the same, "lists every served page an artist rename changes" |
| A namesake's address moves, and the pages linking it are listed although their wording did not change | "lists a namesake whose address moves" |
| The album a memory names: an unnamed containing album changes nothing; moving it earlier, or deleting it, changes the memory | "follows which album a memory names" |
| An opening is reported (a credit, a restore), and a closing is not an opening | "reports an artist page that would open, and one that closes" |
| Draft, private, deleted, and unpublished-translation entries: an empty impact | "has an empty impact for records that nothing served shows" |
| No writing, rating, title, or body in the output (marker text) | "carries no writing, rating, or private text" |
| The public-reads and cover switches never change the result | "does not depend on the public-reads or cover switch" |
| A journal served only in Portuguese is listed under both interface languages | "lists a journal served only in Portuguese" |
| No permanent table changes (catalog and entry checksums); no copy is left; the caller's next write reaches the permanent table | "writes nothing" |
| It refuses to start when a copy already exists; it refuses invalid input | "refuses …" (two tests) |
| Validation, the comparison (absent against null, moved addresses, openings) | `catalog-impact.test.ts` |
| Every write names `pg_temp.<table>` and no `sql.raw` is used; the copies are exactly the eight catalog tables | `catalog-impact.test.ts`, the static checks. The publication boundary scan (`publication-boundary.test.ts`) is unchanged and passes |

**Mutation checks**, run by hand and reverted:
- numbering the tracklist copy wrongly made 1 test fail;
- dropping the credit links from the atoms made 3 fail.

## Checks run

| Check | Result |
| --- | --- |
| `pnpm lint`, `pnpm format:check`, `pnpm typecheck` | Clean |
| `pnpm test` | 60 files, **1,371 passed** |
| `pnpm test:integration` (disposable database) | 39 files, **826 passed** |
| `pnpm build` | Succeeded |
| `pnpm test:http`, `pnpm test:e2e:run` | Not run locally: no route, page, or action changes. CI runs both on the pull request |

## Not verified, and risks

- **The database role must be able to create temporary tables** (`TEMPORARY` on the database, which PostgreSQL grants to every role by default). Not checked on a hosted database; no hosted access is authorized. If it is missing, the computation fails closed with an error, and nothing is written.
- **Cost:** it renders every served page twice per language. Fine at a personal journal's size; measured only on the test database.
- **Step 3 must map each command's input onto the operations faithfully.** The oracle tests here show the copies match the commands for the cases listed. Step 3 repeats them for every command it gates.
- `importMusicRelease` (a new album reusing recordings) can be expressed as `create_album` plus `set_tracklist`, but has no oracle test yet; step 4 adds it with its refusal.
