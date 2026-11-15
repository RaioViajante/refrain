# Evidence: the v3 release candidate

**Status: on branch `release/v3-rc`, a draft pull request. Not merged, not deployed.** Recorded on 2026-11-15.

This is the v3 work assembled into one candidate and verified as a whole. It adds no feature. It is not a release: ADR 0011 and ADR 0012 are still **Proposed**, so nothing here may merge before the owner accepts them, and every public-release gate stays open ([Launch checklist](#launch-checklist)).

## What the candidate is

| Part | Pull request | Head | How it is in the candidate |
| --- | --- | --- | --- |
| R0 decision pack (proposed ADRs, roadmap) | #103 | `509ec44` | The base: an ancestor of #104 |
| v3 public pages and Studio shell | #104 | `32def02` | The branch point |
| Music Story adapter (server only, not wired) | #105 | `8107c03` | Merged without conflict (merge commit `243976f`). It adds `src/integrations/music-story/` and the provider name; no screen calls it, and without a token it answers "not configured" and makes no request |
| Cover removal in every state (ADR 0006 A8) | #102 | `680fc77` | **Not included.** It is based on `main`, conflicts with #103 in `AGENTS.md` and ADR 0006, and its A8 text says "approved by the owner" while the owner has approved only the request, not the text. It stays a separate decision |

Each head and its CI was checked on 2026-11-15 before the branch was made: `Verify` and `Database tests (PostgreSQL 18)` pass on all four. The Vercel check on each is "Canceled by Ignored Build Step" (Git deployments are suppressed on purpose).

No migration, no new dependency, no change to an accepted ADR, to authentication, or to a privacy rule or its tests.

## Verification

Run on `release/v3-rc` at `243976f` (the merge). Browser run 2 is at `ed9bdb8`, which changes only the browser tests' teardown (it keeps more logs). The later commits change only documentation. Every database suite ran on a disposable test database; nothing persistent or hosted was read or written.

| Check | Result |
| --- | --- |
| `pnpm install --frozen-lockfile` | Lockfile unchanged |
| `pnpm lint` | Clean |
| `pnpm format:check` | Clean |
| `pnpm typecheck` | Clean |
| `pnpm test` | 58 files, **1,307 passed** (#104's 1,296 and the adapter's 11) |
| `pnpm test:integration` (database reset first) | 37 files, **805 passed** |
| `pnpm build` | Succeeded |
| `pnpm test:http` (production build) | 20 files, **783 passed** |
| `pnpm test:e2e:run` (production build, every project; database reset first), run 1 | 356 passed, **1 failed** (`memory-page.spec.ts:189` at 390 px, a hidden memory's address answered `500`; [cause below](#the-intermittent-500-on-a-hidden-address-cause-found-not-fixed)), 4 skipped |
| The same, run 2 (`ed9bdb8`, the harness change only; database reset first; `E2E_KEEP_SERVER_LOG=1`) | **357 passed, 0 failed, 4 skipped**; no `Failed to proxy` line in any of the three servers' logs |

### What the browser suite covers, by flow

The goal's list, and the specs that drive each through the real interface on the production build (desktop, and 390 px where marked):

| Flow | Specs |
| --- | --- |
| Sign-in, sign-out, the Studio closed without a session | `authentication`, `negative`, `navigation` |
| Desk, Library, Bin | `navigation`, `layout`, `mobile` (390), `i18n-studio` (26 pages at 320 to 1440) |
| Catalog CRUD (artists, albums, tracks, reorder, archive) | `catalog`, `tracks`, `music` |
| Album-journal writing, Track by track, the confirmed save | `journal`, `editor-journal` |
| Ratings (album and track) | `ratings` |
| Publish, unpublish, "Update the published …?" (the review and the author's confirmation) | `publication`, `memories` |
| Delete and restore from Recently deleted (never publishes) | `recovery`, `memories` |
| Memories: create, publish, public page | `memories`, `memory-page` (1440, 390) |
| Public pages: Home, Albums, album journal, Artists, artist, Memories, memory, 404 | `home`, `archives`, `public`, `artist`, `memory-page`, `public-artwork` (1440, 390) |
| EN and PT, public and Studio | `i18n-public`, `i18n-studio` |
| Covers: shown only with the switch on; the fallback with it off | `cover-display`, `public-artwork` |
| Artist photographs (Studio) | `photos` |
| Accessibility (axe), 44 px targets, reduced motion | `accessibility`, `layout`, `mobile` |
| The academic kit's flow | `academic` |

### Smoke crawl (independent of the suites)

A separate script (not committed) started the same production build on a second disposable database (PostgreSQL 18, `pnpm db:test18:up`), through the repository's own safety-checked server helper. It ran two servers: the Studio's (public reads off, covers off, as a default deployment) and a public one (reads on, no author). It seeded the suites' synthetic `[Test]` journals, artists, and memories, then removed them.

- **Public pages:** crawled from `/`, `/albums`, `/artists`, `/memories`, `/about`, their `/pt` forms, `?sort=` and `?view=` links, and two unknown addresses, following every same-origin link: **61 pages at 1440 px and 61 at 390 px**.
- **Studio:** signed in through the real form, then crawled from `/studio`, `/pt/studio`, and `/studio/system` following every Studio link (GET only; no button pressed): **120 pages at each width**.
- **Result:** every page `200`, except the two unknown addresses, which answered the shared `404`. No `5xx` on any document or subresource, no uncaught page error, and no same-origin link that led to a `404`. The only console errors were the two `404` documents themselves and, on `/studio/system`, the router's prefetch of `/albums`, `/artists`, and `/memories` from the System page's sample navigation, which answer the identical `404` because public reads are off on that server. That is the designed answer, not a broken link.
- **Anonymous, public reads off:** `/` `200` (the generic Home, ADR 0006 A4); `/albums`, `/artists`, `/memories`, `/about`, `/pt/albums`, `/sitemap.xml`, `/robots.txt` the identical `404`; `/studio` and `/studio/journals` the empty `200` shell that streams the redirect to sign-in (Deployment gate item 2).

### The intermittent `500` on a hidden address: cause found, not fixed

The first full browser run failed one test: `memory-page.spec.ts:189` at 390 px, where a draft memory's address answered `500` instead of the shared `404`. #104's evidence lists the same failure at 1440 px as "not reproduced, cause not proven". This time `test-results/` was kept, and the trace showed the response:

- the proxy **had** decided correctly: `x-middleware-rewrite: http://localhost:<port>/__refrain-unknown-address`, with every public header and `no-store`;
- the `500` body was 21 bytes, Next.js's plain "Internal Server Error".

**Reproduced deterministically.** On one production server of this build (`next start -H 127.0.0.1`, as `src/testing/production-server.ts` starts it), **61 of 200 concurrent requests** to an unknown memory address answered `500`. The server's log says why:

```
Failed to proxy http://localhost:50092/__refrain-unknown-address
  connect ECONNREFUSED ::1:50092
  connect ECONNRESET 127.0.0.1:50092
```

**The cause, in Next.js 16.4.3.** The request that the proxy (`src/proxy.ts`) receives is built with the origin `http://localhost:<port>` (`next-server.js`: `this.fetchHostname || 'localhost'`). The router compares a rewrite with its own origin, which it builds from the `-H` address, `http://127.0.0.1:<port>` (`resolve-routes.js`, `getRelativeURL`). Every `NextResponse.rewrite(new URL(UNKNOWN_ADDRESS, request.url))` therefore looks external, so the server sends it **back to itself over HTTP**, to `localhost`. That fails whenever `localhost` resolves to `::1`, where nothing listens, or a pooled connection is reset. It affects every rewrite to the shared not-found view, for any hidden or unknown address. It does not depend on whether the address exists, so it reveals nothing about a hidden entry. It is the likely cause of the recorded intermittents on hidden addresses.

**Scope.** The tests' servers and any self-hosted `next start -H <address>`. On Vercel the platform routes the proxy's rewrites, and the M5 checks recorded the identical `404` for public routes on the host ([Evidence: M5 hosting](m5-hosting.md)). That is not re-verified for this candidate.

**Not fixed here**, because each fix touches the proxy that decides every public `404`, and needs its own reviewed pull request with the request-form tests:

- rewriting to the router's own origin (never one built from the client's `Host` header, which would let a client choose where the server proxies to);
- `skipProxyUrlNormalize`, which also changes the path the proxy sees for data requests;
- starting the test servers on a hostname that both sides agree on.

`E2E_KEEP_SERVER_LOG=1` now also keeps the public servers' logs (`e2e/global-setup.ts`), which is how the next occurrence in the suite is diagnosed.

### Without JavaScript (issue #44)

Checked with JavaScript disabled, at 1440 and 390 px, on the public server above:

| Page | Readable without JavaScript |
| --- | --- |
| Home, Albums, Artists, Memories, About (EN) | Yes |
| Album journal, `/albums/<slug>` and `/pt/albums/<slug>` | **No.** The main region holds only the loading line, and the footer's language links are missing (EN shows one, PT none) |

The v3 rebuild kept the M3.1 route's prerendered shell and Suspense boundary, so #44 is **still open** and still blocks a hosted public launch. The known fix is the one the Home, the artist page, and the memory page already use: `export const instant = false` on both route files and the read moved out of Suspense. It is not made here. The issue records that it changes the M3.1-approved route and the build-output tests that pin its shell (`public-build-output.http.test.ts`, `e2e/home.spec.ts`), so it needs its own decision and pull request.

## The protected preview: not deployed

**No preview was deployed, and no preview URL exists for this candidate.** The Vercel project was inspected read-only on 2026-11-15 (CLI 64.0.1, the team's own login; variable names only, no values):

- **Preview** environment: only `REFRAIN_PUBLIC_READS_ENABLED`. There is **no `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, or `REFRAIN_AUTHOR_EMAIL`** for Preview.
- **Production** holds those, pointing at the persistent hosted database, which must not be attached to a preview without the owner's approval.
- **Development** holds a Neon integration's variables (`NEON_*`). Whether that database holds only synthetic data is not recorded, so it is not a safe staging database either.
- Git deployments are off (`createDeployments: disabled` and the Ignored Build Step), so every deployment is a deliberate CLI step, and each has been a separate owner approval ([Hosted Launch § 2](../hosted-launch.md#2-stages-and-authorization)).

A deployment built now would have no database and no session secret. It could not sign in or read anything, and wiring one up needs new infrastructure that no one has authorized. The step stops here.

**What the owner would need to authorize, in order:**

1. **A staging database** holding synthetic `[Test]` data only. For example, a new Neon project or branch made from an empty database, **never a branch of production**. Migrations are applied with `pnpm db:migrate` against it, and the author is provisioned with `pnpm author:provision` (a synthetic address and a new password).
2. **Preview-scoped variables**, all new:
   - `DATABASE_URL` (the staging database);
   - `BETTER_AUTH_SECRET` (newly generated, never production's);
   - `REFRAIN_AUTHOR_EMAIL` (the synthetic address);
   - `BETTER_AUTH_URL`, set to a fixed preview alias such as `https://refrain-v3-rc.vercel.app`. A generated deployment URL cannot be used, because the origin check compares it exactly and it is unknown until the deployment exists;
   - `REFRAIN_PUBLIC_READS_ENABLED=false` (already set);
   - `REFRAIN_COVER_DISPLAY_ENABLED` left unset (gate item 6).
3. **The deployment:** `vercel deploy` (Preview, never `--prod`) from a clean checkout of the candidate's head, then `vercel alias set <deployment> refrain-v3-rc.vercel.app`. Vercel Authentication on All Deployments already covers it, and the initial indexing policy is in the code.
4. **Checks:** anonymous `curl` gets Vercel's sign-in; with the owner's Vercel session, the sign-in page renders, the author signs in, the Desk opens, a `[Test]` record is created and deleted, and every response carries `X-Robots-Tag: noindex, nofollow`.

Showing public pages on the preview would also need the owner's written decision under Hosted Launch § 9, Tier B, option 2 (reads on, behind Vercel Authentication, synthetic data only). That decision is not a gate closure.

## Launch checklist

The shortest path from this candidate to a public site at `refrain.raioviajante.com`. Today the domain serves an older protected deployment, with public reads off ([Hosted Launch](../hosted-launch.md): S1 and S2 done, S3 and S4 not started). Checked read-only on 2026-11-15: `vercel inspect refrain.raioviajante.com` names `dpl_BzRwrBYXiX9U7dDVp23kbXxhDWr7`, Ready, created 2026-11-06, and an anonymous `GET /studio` answers `302` to Vercel's sign-in.

### Mandatory: no public launch while any of these is open

| # | Gate | State today | Smallest next step |
| --- | --- | --- | --- |
| 1 | **ADR 0011 and ADR 0012 accepted** (the v3 identity and product) | Proposed (#103) | The owner reads and accepts them, or asks for changes. Nothing v3 merges before |
| 2 | **Backups, G6 / F-02** (#65) | Toolchain built and tested; nothing provisioned. No real writing may be hosted before it | The owner resumes F-02 at key generation; then seven green scheduled days and a real restore drill |
| 3 | **Client-aware sign-in protection**, Deployment gate item 1 (#11) | One shared bucket: anyone could keep the author locked out | A PR keying the limit by Vercel's trusted client address, with a global ceiling |
| 4 | **Canonical-host redirect** (Hosted Launch § 7, item 2) | Not built | A PR in `src/proxy.ts`: `308` from other production hostnames to the canonical origin, with HTTP tests |
| 5 | **G1 and G2 on the host** (status, redirects, no cache; #72, #76) | Local evidence only | Needs a protected deployment with reads on and synthetic data (the § 9 decision), then the recorded checks |
| 6 | **G3 writer inventory and G4 database enforcement** | Not started | The inventory, then an ADR on triggers, roles, or accepted risk (R9) |
| 7 | **G5 configuration on the host** | Partly (HTTPS `BETTER_AUTH_URL` in production) | The predicate and matrix tests against the hosted role; Deployment gate items 2, 4, and 5 over real HTTPS |
| 8 | **G7 independent review** of the public surface as deployed | Not done | After 3 to 7 |
| 9 | **G8 catalog wording** | A documented gap: catalog edits change public wording with no confirmation | The owner chooses a confirmation or a refusal while public (R9). No waiver |
| 10 | **#44, the album journal without JavaScript** | Still open in v3 ([above](#without-javascript-issue-44)) | A PR applying `instant = false` to the album route, with the build-output tests rewritten to the memory page's properties |
| 11 | **Album covers**, gate item 6 | The switch is off on every host, so the fallback shows | The owner's recorded rights review before setting `REFRAIN_COVER_DISPLAY_ENABLED=true` anywhere hosted. Launching **without** covers is allowed: the fallback is the safe state |
| 12 | **Artist photographs**, gate item 7 | Studio-only locally; the Jeff Buckley photograph's rights are unverified | The per-photograph review, **or** launch with no photograph chosen |
| 13 | **Initial indexing policy on the host** | In the code; not yet verified on a deployment | Verified with the owner's Vercel session before the protection change (S4 step 1) |
| 14 | **Authentication changes** stay blocked by the magic-link hazard | Unchanged; no magic link is built | Nothing needed for launch: password sign-in is enough |

### Can ship later (does not block a first public release)

- **Music Story** (MS-0 to MS-4): the adapter is in the candidate and not wired. Covers stay on the Cover Art Archive path behind the switch, or off.
- **Magic link** (R10), with its email provider.
- **Media uploads** (R5) and memory photographs (R6).
- **Autosave and pending changes** (R4); the confirmed save works without them.
- **One favourite, the margin note, translations, "Show in recently written"** (R2), and the rest of the v3 editors.
- **Artist journals and stored artist slugs** (R7): the G1 artist-slug decision can be "accept: a rename leaves the old address `404`".
- **Settings, States, share cards** (R8).
- **#102**, cover removal in every state: wanted for takedown, but with covers off on the host, takedown is the switch.
- Known intermittents to watch: the A6 Home parity check (`public-home.http.test.ts`) and a draft memory's `500` (`memory-page.spec.ts`), neither reproduced ([v3 evidence](v3-public.md#verification)).

### The order

1. The owner accepts (or amends) ADR 0011 and ADR 0012 and merges #103, then this candidate's parts.
2. The launch PRs in parallel: sign-in protection (3), canonical redirect (4), #44 (10), and the G8 decision (9).
3. F-02 provisioning (2), which takes seven days to close.
4. A staged production deployment of the approved `main` (Hosted Launch, S2's sequence), then the G1, G2, and G5 evidence on it (5, 7), and the indexing check (13).
5. G3 and G4 (6), then the independent review (7 and 8).
6. S4, only with every gate closed by owner-reviewed evidence.
