# Evidence: v3 presentation readiness (2026-11-17)

**Status: merged as `b997233` (#120) and deployed to the protected Preview on 2026-11-17, each step with the owner's authorization ([below](#deployed-and-verified-on-the-preview-2026-11-17)).** It records what was checked for the presentation of late November 2026 (the target is a protected Preview on Monday, 2026-11-23), the fixes it found, the hosted verification, and what is left. Every public-release gate stays open ([below](#what-stays-open)).

The audit before the deployment changed no variable, database, or deployment. It used `vercel inspect`, the Vercel API's `GET`s, and `GET` requests through `vercel curl`. `vercel curl` is not strictly read-only: it can provision an automation-bypass secret, which is the likely origin of the one found below. That secret was revoked afterwards, and later checks used plain `curl` and API `GET`s only.

## The protected Preview, before the deployment (audit)

| Check | Result |
| --- | --- |
| What the alias serves | `refrain-v3-rc.vercel.app` → `dpl_5NvrbDxvVA2Y2f9xdP4sj6xbR9hS`, Ready, built from the CLI on 2026-11-15 at **`b0b124de`** (the release candidate, [evidence](v3-rc.md#the-protected-preview-2026-11-15)), region `gru1` |
| Does staging match `main`? | **No.** `main` is 29 commits ahead: #107 to #111 (no-JavaScript album journal, G2 `no-store`, canonical-host redirect off by default, client-aware sign-in limits off by default, the G1 request-form fixes) and documentation. 50 files differ, 31 of them outside `docs/` |
| Schema | `src/db/` and `drizzle.config.ts` are **identical** between `b0b124de` and `main`: the same six migrations (`0000` to `0005`), so deploying `main` needs **no migration**. The migration count on the hosted database itself was not read (that needs its credentials); [step 2](#the-shortest-sequence-to-a-verified-preview) has the owner read it |
| Neon connection | Working: the Preview's Home, Albums, Artists, Memories, `/pt`, and the sitemap answer `200` with the synthetic `[Test]` records (one album journal, its artist, one memory, in EN and PT) |
| Isolation | The Preview variables (`DATABASE_URL` and the Neon set, `BETTER_AUTH_*`, `REFRAIN_AUTHOR_EMAIL`, `REFRAIN_PUBLIC_READS_ENABLED`) are scoped to **Preview only**; Production has its own. `REFRAIN_COVER_DISPLAY_ENABLED` is unset in Preview, so no cover shows there |
| Protection | `ssoProtection: all`. Anonymous `GET /`, `/studio`, `/api/auth/get-session`: `302` to Vercel's sign-in |
| **Automation bypass** | **One `automation-bypass` secret exists on the project, created 2026-11-15 21:31 UTC**, nine minutes before the RC deployment. The RC evidence says "no bypass token". Most likely `vercel curl` created it. Its value was not read. It let whoever held it pass Vercel Authentication on every deployment of the project. **Revoked on 2026-11-17** at the owner's decision ([below](#deployed-and-verified-on-the-preview-2026-11-17)) |
| Git deployments | Still suppressed: every Git-triggered deployment of `refrain` since 2026-11-16 is `CANCELED` (Ignored Build Step) |
| Headers through the protection | `X-Robots-Tag: noindex, nofollow` on every response; public pages `no-store`; the Studio `private, no-store, max-age=0, must-revalidate`; `/no-such-page` is `404` with `public, max-age=0, must-revalidate` (the G2 gap, fixed on `main` by #108, not yet deployed) |
| Production | Untouched: `refrain.raioviajante.com` still serves `dpl_BzRwrBYXiX9U7dDVp23kbXxhDWr7` (2026-11-06) |

## Deployed and verified on the Preview (2026-11-17)

Each step was authorized by the owner, in this order.

1. **Merge.** #120 merged into `main` with a regular merge commit, `b997233` (parents `4ec634b` and `6279b71`), after checking its head and its green CI. The push started a Production deployment that the Ignored Build Step cancelled; `refrain.raioviajante.com` still serves `dpl_BzRwrBYXiX9U7dDVp23kbXxhDWr7`.
2. **Deploy.** From a fresh clone at `b997233`, `vercel deploy --target=preview -e REFRAIN_PUBLIC_READS_ENABLED=true` made **`dpl_GB4pkMdvSEwX5SvKobZj4nnaGrSs`**. Before the alias moved:
   - the deployment's metadata names `b997233`, target Preview;
   - anonymous requests answer `302` to Vercel's sign-in;
   - the project's Preview `REFRAIN_PUBLIC_READS_ENABLED` is `false`, so reads are on for this deployment only;
   - its database is the staging one: Neon project `gentle-bread-14426853`, not the Development project, and the direct host's SHA-256 prefix is `f9154f7d`, as recorded on 2026-11-15;
   - every page answered as expected through the protection, including `/no-such-page` now `404` with `no-store` (#108's fix, first seen on a host).

   Then `refrain-v3-rc.vercel.app` was pointed at it. `vercel link` had written a `.env.local` holding a short-lived token; it was deleted before the deploy, so the upload held no environment file.
3. **Neon.** Read-only, over TLS 1.3 with a verified certificate: PostgreSQL 18.7; **all 6 migrations match the repository's files by hash**; 22 tables, 22 primary keys, 24 foreign keys (9 `RESTRICT`), 18 unique, 42 check constraints; synthetic data only (3 artists and 4 albums, all `[Test]`, one account). SQL A, B, C, and E ran as in [M4](m4.md#sql-evidence).
4. **The M4 rehearsal on the host**, in a browser through Vercel Authentication (the CLI's short-lived development token, sent to the Preview's origin only), signed in as the synthetic staging author: **34 of 34 checks passed**. They cover every step of the [table below](#the-academic-demonstration-rehearsed) on Neon, plus:
   - a tracklist reorder that persists after a reload;
   - unpublishing, after which the public page answers `404` on the next request;
   - a real MusicBrainz search from the hosted server (Grace, Jeff Buckley, 1994; no cover shown, the switch is off);
   - the sleeve fix holding on the host at 390 and 1440 px;
   - data seen again from a fresh browser session;
   - `noindex` and `no-store` on every public answer, and sign-out.

   Every record the run made carried a unique `[Test] Demo <id>` prefix. A cleanup in the e2e teardown's order removed exactly those (1 album, 2 tracks, 1 artist, 1 journal, 1 memory, 2 addresses). The other records' counts were the same before and after.
5. **Bypass.** No workflow, test, or configuration used the automation-bypass secret, and the repository has no Actions secrets. It was revoked without a replacement: `protectionBypass` is now empty, and Vercel Authentication covers every deployment.

**Second deployment (#121).** With the owner's authorization, #121 was merged as `6093891` and deployed the same way as `dpl_37CLuc8TMkUYAqpQUCcXmnHascwd`, now behind `refrain-v3-rc.vercel.app`. The same checks passed before the alias moved:
- the commit and the Preview target;
- anonymous `302`;
- the project's Preview reads `false`;
- the staging database (`f9154f7d`);
- protection on every deployment, with no bypass secret;
- every page answering through the protection, with the token sent from memory, not with `vercel curl`.

On the host the rehearsal passed 35 of 37 checks, including #121's three fixes: the Home's header at 320, 390, and 1440 px in EN and PT; the long artist name; and the shelf's label. The two failures were looked at separately:
- **Sign-out:** the script asked for the Studio before the sign-out had finished. Waiting for it, sign-out leads to sign-in and the Studio stays closed. It works.
- **The Home's latest-journal sleeve at 390 px:** a real defect. It is built like the album journal's sleeve, and a long title shrank its label until the label's title ran out of it. It is fixed in a further pull request by applying the album sleeve's rules to both sleeves, with a browser test that fails without the fix.

Cleanup again removed exactly the run's records.

**Incident.** While reading the development token, `vercel env run --environment development … -- node <file>` (Vercel CLI 64.0.1) did not run the script: it deployed the file as a new project, `envkeys`. The file was a one-line script that prints variable names, with no secret in it. Both of its deployments were behind Vercel Authentication or answered `404`. With the owner's approval, after checking that it had no link, variables, or dependencies, the project was deleted. Do not use `vercel env run` this way.

**Independent review** (a separate agent, read-only, of `4ec634b..b997233` and the hosted configuration): **GO**, no Critical, High, or Medium finding. Its Low findings were stale statements in this document, corrected here, and a setup step in the sleeve test that could leave a rename behind, now one transaction. It also confirmed the protection, the alias, the deployment's commit, Production, the cancelled Git deployments, and `302` for anonymous requests.

Undoing a deployment: point the alias back at the previous one, `dpl_GB4pkMdvSEwX5SvKobZj4nnaGrSs` (`b997233`), or `dpl_5NvrbDxvVA2Y2f9xdP4sj6xbR9hS` (the release candidate).

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

The follow-up (the Home header, long artist names, long label titles): lint, format, and types clean; unit **1,360**; integration **813** on a freshly created PostgreSQL 18.6 container; build succeeded; HTTP **809**; browser **363 passed**, 4 skipped. Each new browser check fails without its fix.

On #120, a first integration run failed 74 tests: the rehearsal below had provisioned an author in the same disposable PostgreSQL 18 database, and the identity tests require that none exists. On a recreated container every test passed. The rehearsal now belongs on its own database, or must be followed by `pnpm db:test18:down`.

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
- **Fixed after the deployment** (a follow-up pull request; not deployed yet):
  - **The Home on a phone:** the three section links are 44 px targets, and the language switch, placed at 116 px, sat on top of "Memories" at every phone width, in EN and PT. It now sits below them. A browser test checks that no header link overlaps a language at 320 to 1440 px in both languages; it fails without the fix.
  - **A long artist name on the artist page (desktop):** the name sits in a 240 px column with the labels at fixed heights below it, and a name longer than the reference's two short lines ran over "albums written" (for example "Car Seat Headrest"). The name now scales down just enough to fit, estimated from the faces' measured widths (`name-fit.ts`, with unit tests); "Jeff Buckley" and "Nick Drake" keep the design's sizes. The artist spec's long-name test now checks that the name stays above the labels and inside its column at 1024, 1440, and 2560 px.
  - **A long title on a white record label** ran off the label's bottom mid-line, on the artist's shelf and on the Home at phone width. It is cut after three lines with an ellipsis; the label is decorative, and the title is always given in full beside it.
- The album journal's text, tracks, and notes appear as the reader scrolls; a full-page capture that never scrolls shows that band empty. That is the design's reveal, not missing content: under reduced motion, or after scrolling, everything is there.

## Readiness matrix

"PASS" means checked on 2026-11-17 with the result shown; "local" means on the production build with PostgreSQL 18.6, not on the host.

| Area | Item | Result | Evidence |
| --- | --- | --- | --- |
| Pages | Home, Albums, Artists, Memories, About, album journal, artist, 404, in EN and `/pt` | PASS (local and on the Preview, `b997233`) | Rehearsal; e2e 359; [staging audit](#the-protected-preview-before-the-deployment-audit) |
| Pages | Album journal with a long title or artist | PASS since `b997233` (was FAIL) | [Visual fidelity](#visual-fidelity) |
| Pages | Home on a phone: header links and languages | **FAIL on `b997233`**; PASS with the follow-up | Same |
| Pages | Artist page with a long name (desktop); long titles on record labels | **FAIL on `b997233`**; PASS with the follow-up | Same |
| Studio | Desk, Library, catalog, journals, memories, Recently deleted, publish dialogs, Add music, EN and PT | PASS (local and on the Preview) | Rehearsals; e2e |
| CRUD | Artist create, read, update, delete, refused delete | PASS (local and on the Preview) | Steps 1, 4, 6, 7, 10 |
| CRUD | Album create, read, update, refused delete | PASS (local and on the Preview) | Steps 2, 4, 5, 8 |
| CRUD | Tracks and tracklist (create, add, order) | PASS (local and on the Preview) | Step 3; e2e `tracks`, `catalog` |
| CRUD | Album journal write, edit, track reflection, soft delete, restore, publish, unpublish | PASS (local and on the Preview) | Steps 8, F, 9, publish; e2e `journal`, `recovery`, `publication` |
| CRUD | Memory create, save, publish | PASS (local and on the Preview) | Rehearsal; e2e `memories` |
| SQL | Primary and foreign keys, `RESTRICT` refusals | PASS (local PostgreSQL 18.6; Neon 18.7) | E |
| SQL | `JOIN` | PASS (local and Neon) | A, and the six-table join in `e2e/academic.spec.ts` |
| SQL | `COUNT … GROUP BY` | PASS (local and Neon) | B, F |
| SQL | Correlated subquery | PASS (local and Neon) | C |
| SQL | Browser → PostgreSQL → browser, and data outliving a restart or a new session | PASS (local and on the Preview) | Steps 10, restart; hosted fresh session |
| Authentication | Sign-in, wrong password refused, Studio closed without a session, sign-out | PASS (local and on the Preview) | Rehearsal; e2e `authentication` |
| Neon | Connection, TLS, and isolation from the other databases | PASS | [Deployed and verified](#deployed-and-verified-on-the-preview-2026-11-17) |
| Neon | Migrations and schema match `main` | PASS: 6 of 6 by hash, 22 tables | Same |
| Neon | `main` deployed on the Preview | PASS: `dpl_GB4pk…` from `b997233` | Same |
| Artwork | MusicBrainz search and Cover Art Archive images, live | PASS (locally through the adapters; search also from the hosted Studio) | [Providers](#music-providers-live) |
| Artwork | Covers shown on a hosted page | **Off by design** until the rights review (Deployment gate item 6) | Preview variables |
| Visual | v3 fidelity, public | PASS, with the recorded differences | [Visual fidelity](#visual-fidelity) |
| Visual | v3 fidelity, Studio | PASS for the built screens, with the recorded differences; unbuilt editors not compared | Same |
| Gates | F-02 / G6 backups, R1, G1 to G8 on a host | **OPEN** | [Below](#what-stays-open) |

## The shortest sequence to a verified Preview

**Steps 1 to 4 were done on 2026-11-17** ([above](#deployed-and-verified-on-the-preview-2026-11-17)). They are kept as the procedure for the next deployment, for example to bring the follow-up fixes to the Preview. Each step needs the owner's authorization; none touches Production, its database, DNS, or the protection setting. Delete the `.env.local` that `vercel link` writes before deploying, and do not use `vercel curl` (it can recreate an automation-bypass secret) or `vercel env run`.

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

Undoing step 3: point the alias back at the deployment it served before.

## Owner actions

- Review and merge the follow-up pull request (the Home header, long artist names, and long label titles), then authorize a Preview deployment of it, as in steps 3 and 4.
- The automation-bypass secret is revoked; nothing needs it. If a tool asks for one, decide again.
- **Covers on the Preview:** keep them off (the default), or complete the rights review (Deployment gate item 6) first.
- **Music Story:** request a written licence if it is to replace MusicBrainz and the Cover Art Archive.
- <a id="nextjs-advisory"></a>**Next.js 16.4.3 advisory** [GHSA-mfr8-8qww-v76h](https://github.com/advisories/GHSA-mfr8-8qww-v76h) (moderate: an information disclosure in a `use cache` function called through `unstable_cache()`; patched in 16.4.5). Refrain uses neither `use cache` nor `unstable_cache`, so the vulnerable path is not reached. Next.js's build now stops once per environment to recommend the upgrade, and the same command succeeds when run again. Upgrading is a separate pull request with the full suite, because the G1 and proxy evidence was measured on 16.4.3's internals; it is not done here.

## What stays open

Nothing here closes a gate.

- **F-02 / G6, hosted backups:** nothing provisioned. Real writing must not be hosted.
- **R1** (the album a memory names) and the rest of **G8**: ADR 0013's steps 1 to 4 are draft pull requests #116 to #119, not merged; R1 needs the owner's decision.
- **G1 to G8 on a host**, the canonical redirect and client-aware sign-in limits (built, off), the indexing check, and the independent review of the deployed surface: as in [Launch gates](launch-gates.md).
- The Preview is not public: Vercel Authentication stays on every deployment.
