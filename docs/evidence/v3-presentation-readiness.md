# Evidence: v3 presentation readiness (2026-11-17)

**Status: a draft pull request on `fix/v3-presentation-readiness`, based on `main` at `4ec634b`. Not merged, not deployed.** It records what was checked for the presentation of late November 2026 (the target is a protected Preview on Monday, 2026-11-23), the two fixes it found, and the owner's steps to a verified Preview. Every public-release gate stays open ([below](#what-stays-open)).

Nothing hosted was changed: no deployment, no variable, no database write, no protection change, and no credential was read. The staging audit used only reads (`vercel inspect`, the Vercel API's `GET`s, and `GET` requests through `vercel curl`).

## The protected Preview, as it is (read-only audit)

| Check | Result |
| --- | --- |
| What the alias serves | `refrain-v3-rc.vercel.app` → `dpl_5NvrbDxvVA2Y2f9xdP4sj6xbR9hS`, Ready, built from the CLI on 2026-11-15 at **`b0b124de`** (the release candidate, [evidence](v3-rc.md#the-protected-preview-2026-11-15)), region `gru1` |
| Does staging match `main`? | **No.** `main` is 29 commits ahead: #107 to #111 (no-JavaScript album journal, G2 `no-store`, canonical-host redirect off by default, client-aware sign-in limits off by default, the G1 request-form fixes) and documentation. 50 files differ outside `docs/` |
| Schema | `src/db/` and `drizzle.config.ts` are **identical** between `b0b124de` and `main`: the same six migrations (`0000` to `0005`), so deploying `main` needs **no migration**. The migration count on the hosted database itself was not read (that needs its credentials); [step 2](#the-shortest-sequence-to-a-verified-preview) has the owner read it |
| Neon connection | Working: the Preview's Home, Albums, Artists, Memories, `/pt`, and the sitemap answer `200` with the synthetic `[Test]` records (one album journal, its artist, one memory, in EN and PT) |
| Isolation | The Preview variables (`DATABASE_URL` and the Neon set, `BETTER_AUTH_*`, `REFRAIN_AUTHOR_EMAIL`, `REFRAIN_PUBLIC_READS_ENABLED`) are scoped to **Preview only**; Production has its own. `REFRAIN_COVER_DISPLAY_ENABLED` is unset in Preview, so no cover shows there |
| Protection | `ssoProtection: all`. Anonymous `GET /`, `/studio`, `/api/auth/get-session`: `302` to Vercel's sign-in |
| **Automation bypass** | **One `automation-bypass` secret exists on the project, created 2026-11-15 21:31 UTC**, nine minutes before the RC deployment. The RC evidence says "no bypass token". Most likely `vercel curl` created it. Its value was not read. It lets whoever holds it pass Vercel Authentication on every deployment of the project: [owner decision](#owner-actions) |
| Git deployments | Still suppressed: every Git-triggered deployment of `refrain` since 2026-11-16 is `CANCELED` (Ignored Build Step) |
| Headers through the protection | `X-Robots-Tag: noindex, nofollow` on every response; public pages `no-store`; the Studio `private, no-store, max-age=0, must-revalidate`; `/no-such-page` is `404` with `public, max-age=0, must-revalidate` (the G2 gap, fixed on `main` by #108, not yet deployed) |
| Production | Untouched: `refrain.raioviajante.com` still serves `dpl_BzRwrBYXiX9U7dDVp23kbXxhDWr7` (2026-11-06) |

## `main`, verified locally

At `4ec634b`, on 2026-11-17, every check run and its output read:

| Check | Result |
| --- | --- |
| `pnpm lint`, `pnpm format:check`, `pnpm typecheck` | Clean |
| `pnpm test` | 59 files, **1,356 passed** |
| `pnpm test:integration` on PostgreSQL 18.6 (the hosted major version) | 38 files, **813 passed** |
| `pnpm build` | Succeeded (see the [advisory](#nextjs-advisory) note) |
| `pnpm test:http` | 22 files, **809 passed** |
| `pnpm test:e2e:run` (every project, desktop and 390 px) | **359 passed**, 4 skipped (the conditional screenshot jobs) |

The same on this branch (the sleeve fix, its test, and the documents): lint, format, and types clean; unit **1,356**; integration **813** on a freshly created PostgreSQL 18.6 container; build succeeded; HTTP **809**; browser **361 passed** (the two new sleeve checks, desktop and 390 px, included), 4 skipped.

A first integration run on this branch failed 74 tests: the rehearsal below had provisioned an author in the same disposable PostgreSQL 18 database, and the identity tests require that none exists. On a recreated container every test passed. The rehearsal now belongs on its own database, or must be followed by `pnpm db:test18:down`.

## The academic demonstration, rehearsed

The [M4 CRUD demonstration](m4.md#crud-demonstration) was rehearsed end to end by a script (kept outside the repository). It drove a real browser through the production build, on a freshly migrated disposable **PostgreSQL 18.6** database (6 migrations, 22 tables), with the synthetic `author@example.com` provisioned by `pnpm author:provision`. After each step it ran the [SQL evidence](m4.md#sql-evidence) A to F:

| Step | Result |
| --- | --- |
| Sign-in: the page, a wrong password refused ("don't match"), the right one opens the Desk | PASS |
| 1 Create an artist; 2 an album (three tables, one transaction), **SQL A (`JOIN`)** one credit at position 1 | PASS |
| 3 Two tracks on the album, **SQL B (`COUNT … GROUP BY`)** `2` | PASS |
| 4 `/studio/albums` after a reload: "1994 · 2 tracks · used in 0 entries", **SQL C (correlated subquery)** `0` | PASS |
| 5 Update the album's title; it persists after a reload; `updated_at` advanced | PASS |
| 6 Delete an unused artist: a real `DELETE`, count 1 then 0 | PASS |
| 7 Delete a credited artist: refused, "It is credited on an album." | PASS |
| 8 A journal written; "used in 1 entry"; deleting the album refused, "Journals are written about it…" | PASS |
| F A track reflection: the Desk's "1 of 2 tracks written" equals **SQL F** | PASS |
| 9 Move to Recently deleted and restore: SQL C reads 0, then 1 | PASS |
| Publish through the review: Cancel publishes nothing; the confirmation publishes | PASS |
| A memory created and saved; the Library; the Desk in `/pt/studio` (`lang="pt-BR"`) | PASS |
| Public pages, reads on (local `127.0.0.1` only): Home, Albums, Artists, Memories, About, the album journal in EN and `/pt`, the artist page; an unknown album `404` | PASS |
| 10 A rename made in SQL appears in the Studio after a reload (AC-06, both directions) | PASS |
| **E** Keys and refusals in SQL | PASS, with **PostgreSQL 18's wording**: see below |
| After stopping and restarting the server: sign in again, the SQL rename still shown, the published journal still served (AC-01) | PASS |
| Browser console | No error except the deliberate wrong password's `401` |

**33 of 33 checks passed.** Every record was `[Test] Demo …` in the disposable database.

**A correction for Neon, made in [M4 § E](m4.md#e-keys-and-a-refused-delete):** the expected output there was PostgreSQL 17's. PostgreSQL 18, which Neon runs, words a `RESTRICT` refusal as "violates RESTRICT setting of foreign key constraint …" (and "is referenced", not "is still referenced"), and `pg_constraint` lists the three `NOT NULL` constraints of `album_artists` as type `n`. Both outputs are now in the document.

## Music providers, live

Run on 2026-11-17 through the real adapters, in the order the Studio calls them (`searchReleaseGroups` and the Studio's ranking, `getReleaseGroup`, `listReleases`, `getRelease`, `listReleaseImages`, then the cover display functions), with the built-in 1.1 s spacing and the repository's `User-Agent`:

| Search | Top result after ranking | Tracks | Cover (Cover Art Archive) |
| --- | --- | --- | --- |
| grace jeff buckley | Grace, Jeff Buckley, 1994 | 11 | front image, `200 image/jpeg` |
| ok computer radiohead | OK Computer, Radiohead, 1997 | 12 | `200 image/jpeg` |
| disintegration the cure | Disintegration, The Cure, 1989 | 12 | `200 image/jpeg` |
| clube da esquina milton nascimento lô borges | Clube da Esquina, Milton Nascimento & Lô Borges, 1972 | 21 (2 discs) | `200 image/jpeg` |

Failures stay inside the adapter's errors: an empty or overlong query is refused before any request, a nonsense query returns no results, search operators are escaped, and an unknown identifier is `not_found`. The cover display functions return nothing unless `REFRAIN_COVER_DISPLAY_ENABLED` is `true` (they fail closed).

**Music Story** stays the preferred future provider, but not for this presentation. Its API needs a commercial agreement ([product page](https://music-story.com/en/metadata-monitor-api)); the self-serve trial (15 days, 200 requests a day) is "for testing, metadata preview, and evaluation purposes only", and the [terms of use](https://metadata.music-story.com/en/terms-of-use) forbid republishing its content without written authorization. Present it as the planned provider, waiting on a written licence (ADR 0012 § 1).

## Visual fidelity

Compared with the v3 reference screens at 1440 and 390 px, in the settled state (reduced motion), with the rehearsal's synthetic records:

- **Fixed: a long title or artist broke the album journal's sleeve** (recorded on the RC Preview as "a long album title is clipped inside the sleeve's white label"). The title wrapped to five lines, pushed the cover out of the square sleeve, where it was clipped, and pushed the year and the handwritten artist below it, over the eyebrow and the `h1`, at both widths. Now (`src/app/v3/v3.css`) a title of the reference's length renders unchanged. A longer one keeps two lines in the sleeve (the `h1` beside it gives it in full), the cover may shrink rather than overflow, and the handwritten artist keeps three lines (two on a phone), as a record label's lines are already cut. A browser test (`e2e/public.spec.ts`, "a long title and artist stay inside the sleeve") renames the seeded album and checks that every part stays inside the sleeve at 390 and 1440 px. **It fails without the fix** (the foot 122 px below the sleeve at 390 px) and passes with it.
- The public pages, the Desk, the Library, and sign-in were already compared with the reference on 2026-11-15 ([v3 evidence](v3-public.md#visual-comparison)); nothing new was found there. The remaining differences are recorded ones: content (synthetic titles, no photographs, white labels while covers are off), and features not built yet (autosave, Music Story, artist journals, translations, the Settings page).
- The Studio's phone header keeps its documented differences from the reference: a second row with "View the site", the 44 px language switch, and sign-out ([v3 evidence](v3-public.md)). They are not changed here.
- The album journal's text, tracks, and notes appear as the reader scrolls; a full-page capture that never scrolls shows that band empty. That is the design's reveal, not missing content: under reduced motion, or after scrolling, everything is there.

## Readiness matrix

"PASS" means checked on 2026-11-17 with the result shown; "local" means on the production build with PostgreSQL 18.6, not on the host.

| Area | Item | Result | Evidence |
| --- | --- | --- | --- |
| Pages | Home, Albums, Artists, Memories, About, album journal, artist, memory, 404, in EN and `/pt` | PASS (local); PASS on the Preview for the RC build | Rehearsal; e2e 359; [staging audit](#the-protected-preview-as-it-is-read-only-audit) |
| Pages | Album journal with a long title or artist | **FAIL on `main`, PASS with this fix** | [Visual fidelity](#visual-fidelity) |
| Studio | Desk, Library, catalog, journals, memories, Recently deleted, publish dialogs, EN and PT | PASS (local) | Rehearsal; e2e |
| CRUD | Artist create, read, update, delete, refused delete | PASS (local) | Steps 1, 4, 6, 7, 10 |
| CRUD | Album create, read, update, refused delete | PASS (local) | Steps 2, 4, 5, 8 |
| CRUD | Tracks and tracklist (create, add, order) | PASS (local) | Step 3; e2e `tracks`, `catalog` |
| CRUD | Album journal write, edit, track reflection, soft delete, restore, publish, unpublish | PASS (local) | Steps 8, F, 9, publish; e2e `journal`, `recovery`, `publication` |
| CRUD | Memory create, save, publish | PASS (local) | Rehearsal; e2e `memories` |
| SQL | Primary and foreign keys, `RESTRICT` refusals | PASS (local, PostgreSQL 18) | E |
| SQL | `JOIN` | PASS (local) | A, and the six-table join in `e2e/academic.spec.ts` |
| SQL | `COUNT … GROUP BY` | PASS (local) | B, F |
| SQL | Correlated subquery | PASS (local) | C |
| SQL | Browser → PostgreSQL → browser, and data outliving a restart | PASS (local) | Steps 10, restart |
| Authentication | Sign-in, wrong password refused, Studio closed without a session, sign-out | PASS (local); PASS on the RC Preview (2026-11-15) | Rehearsal; e2e `authentication` |
| Neon | Connection and data on the Preview | PASS (RC build, read-only) | Staging audit |
| Neon | Schema matches `main` | PASS by source comparison; the hosted migration count is not read | Staging audit |
| Neon | `main` deployed on the Preview | **Not done** | [Owner actions](#owner-actions) |
| Artwork | MusicBrainz search and Cover Art Archive images, live | PASS | [Providers](#music-providers-live) |
| Artwork | Covers shown on a hosted page | **Off by design** until the rights review (Deployment gate item 6) | Preview variables |
| Visual | v3 fidelity, public | PASS, with the recorded differences | [Visual fidelity](#visual-fidelity) |
| Visual | v3 fidelity, Studio | PASS for the built screens, with the recorded differences; unbuilt editors not compared | Same |
| Gates | F-02 / G6 backups, R1, G1 to G8 on a host | **OPEN** | [Below](#what-stays-open) |

## The shortest sequence to a verified Preview

Each step needs the owner's authorization; none touches Production, its database, DNS, or the protection setting.

1. **Merge.** Review this pull request and merge it into `main` (CSS and a test; no migration, no dependency, no authentication change). Deploying `main` without it is also possible; the long-title defect then stays.
2. **Read the hosted migration count** (read-only) in the Neon console's SQL Editor, on the `refrain-v3-staging` project only: `select count(*) from drizzle.__drizzle_migrations;` must be `6`. If it is not, stop.
3. **Deploy `main` to the Preview**, as the RC was, from a fresh clone with no `.env`. (`vercel link` writes an untracked `.vercel/`, which is why the RC deployment is marked `gitDirty`; that is expected.)
   ```sh
   git clone https://github.com/RaioViajante/refrain refrain-preview && cd refrain-preview
   git checkout <the merged main commit>
   vercel link --yes --project refrain --scope raioviajando
   vercel deploy --target=preview -e REFRAIN_PUBLIC_READS_ENABLED=true --scope raioviajando
   vercel alias set <the new deployment's URL> refrain-v3-rc.vercel.app --scope raioviajando
   ```
   The alias must stay `refrain-v3-rc.vercel.app`: it is the Preview's `BETTER_AUTH_URL`, and sign-in checks the origin. Reads on for that deployment only, behind Vercel Authentication, with synthetic data: the same Hosted Launch § 9 Tier B decision as on 2026-11-15.
4. **Verify on the host** (it writes synthetic records and a session to the staging database, so it needs the owner's go-ahead): the rehearsal above against the alias, through Vercel Authentication, signed in as the synthetic staging author, and the SQL evidence in the Neon SQL Editor. Then the anonymous `302` check and the header table above again.
5. **For the presentation:** the CRUD demonstration on the Preview, the SQL in the Neon SQL Editor (A, B, C, F read-only; E inside `begin … rollback`), and covers either off (the white labels) or shown only from the local server.

Undoing step 3: point the alias back at `dpl_5NvrbDxvVA2Y2f9xdP4sj6xbR9hS`.

## Owner actions

- Authorize steps 1 to 5 above, separately.
- **Decide on the automation bypass secret** (created 2026-11-15 21:31 UTC): keep it, or revoke it in the project's Deployment Protection settings. `vercel curl` may create a new one when it is next used.
- **Covers on the Preview:** keep them off (the default), or complete the rights review (Deployment gate item 6) first.
- **Music Story:** request a written licence if it is to replace MusicBrainz and the Cover Art Archive.
- <a id="nextjs-advisory"></a>**Next.js 16.4.3 advisory** [GHSA-mfr8-8qww-v76h](https://github.com/advisories/GHSA-mfr8-8qww-v76h) (moderate: an information disclosure in a `use cache` function called through `unstable_cache()`; patched in 16.4.5). Refrain uses neither `use cache` nor `unstable_cache`, so the vulnerable path is not reached. Next.js's build now stops once per environment to recommend the upgrade, and the same command succeeds when run again. Upgrading is a separate pull request with the full suite, because the G1 and proxy evidence was measured on 16.4.3's internals; it is not done here.

## What stays open

Nothing here closes a gate.

- **F-02 / G6, hosted backups:** nothing provisioned. Real writing must not be hosted.
- **R1** (the album a memory names) and the rest of **G8**: ADR 0013's steps 1 to 4 are draft pull requests #116 to #119, not merged; R1 needs the owner's decision.
- **G1 to G8 on a host**, the canonical redirect and client-aware sign-in limits (built, off), the indexing check, and the independent review of the deployed surface: as in [Launch gates](launch-gates.md).
- The Preview is not public: Vercel Authentication stays on every deployment.
