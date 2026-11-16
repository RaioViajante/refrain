# Evidence: the v3 release candidate

**Status: on branch `release/v3-rc`, a draft pull request. Not merged.** Deployed only to a protected Preview with synthetic data ([The protected Preview](#the-protected-preview-2026-11-15)); never to Production. Recorded on 2026-11-15.

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

**Scope.** The tests' servers and any self-hosted `next start -H <address>`. On Vercel the platform routes the proxy's rewrites, and the M5 checks recorded the identical `404` for public routes on the host ([Evidence: M5 hosting](m5-hosting.md)). On this candidate's protected Preview, 120 of 120 concurrent requests to hidden and unknown addresses answered `404` ([hosted checks](#hosted-checks)).

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

**The same on the Preview** (JavaScript off, 1440 and 390 px): the album journal's main region holds 8 characters (the loading line), while the memory page (188), the Home, and Albums read in full.

The v3 rebuild kept the M3.1 route's prerendered shell and Suspense boundary. **Fixed by PR #107** (`fix/album-journal-no-js`): the route renders per request in one pass (`instant = false`), as the memory and artist pages do. The build holds an empty fallback, and a browser test reads the journal with JavaScript off in EN and PT at 1440 and 390 px. The independent security review gave GO, with Low findings only, all addressed in the same PR.

## The protected Preview (2026-11-15)

**Deployed and verified: `https://refrain-v3-rc.vercel.app`**, behind Vercel Authentication. It runs the candidate's code at `b0b124de379bbb01a1aa28ac1231efe47ec82455` on an isolated staging database holding synthetic `[Test]` data only, with public reads on **for this deployment only**. The owner authorized each step: the staging database, the Preview-only variables, the Preview deployment, and public reads behind Vercel Authentication with synthetic data, Hosted Launch § 9, Tier B, option 2. That is not a gate closure and not a public launch. Production, its database, its variables, DNS, and `refrain.raioviajante.com` were not touched.

| What | Value |
| --- | --- |
| Alias (the Better Auth origin) | `https://refrain-v3-rc.vercel.app`, now on deployment 2 |
| Deployment 1, reads off | `dpl_BYJAV3drVunUu6ZNEncUiq2wTKbR` (`refrain-98hrzl3la-raioviajando.vercel.app`) |
| Deployment 2, reads on | `dpl_5NvrbDxvVA2Y2f9xdP4sj6xbR9hS` (`refrain-hktp7ar96-raioviajando.vercel.app`), the same commit with `REFRAIN_PUBLIC_READS_ENABLED=true` passed to `vercel deploy -e` for that deployment alone; the project's Preview value stays `false` |
| Source | A fresh `git clone` detached at `b0b124de`, clean, with no `.env` file except the tracked `.env.example`; `vercel deploy --target=preview`, never `--prod` |
| Protection | `ssoProtection: all` (Vercel Authentication on every deployment), no password, no trusted IPs, **no bypass token**; Git deployments still disabled |

### Staging isolation

- **A new Neon resource**, `refrain-v3-staging` (Neon project `gentle-bread-14426853`, resource `store_4G5gDNhzR1fHfWLA`), on the **Free plan** (`free_v3`), region `gru1`, Neon Auth off. It was created with `vercel integration add neon` and connected to the **Preview environment only**. It is not a branch or copy of any database.
- **It is not production's database:**
  - its `NEON_PROJECT_ID` differs from the existing `refrain-db` resource's;
  - its host differs (SHA-256 prefixes `f9154f7d…` against `8d08193c…`; the hosts themselves are not recorded);
  - it was empty before the migrations: **0 tables**, PostgreSQL 18.7.
- **Migrations:** the repository's 6 migrations applied with `pnpm db:migrate`, which leaves 22 public tables.
- **The author:** one synthetic account, `staging-author@example.com`, made with `pnpm author:provision`:
  - its password is generated, never printed, and kept only in the owner's macOS Keychain (service `refrain-v3-staging-author`);
  - the provisioning connection used `PGSSLMODE=verify-full`: the client socket was encrypted, and the certificate verified.
  - The command refuses a URL with query parameters, so it was given the direct URL without `?sslmode=require`, with TLS from `PGSSLMODE`.
- **Preview-only variables** added:
  - `BETTER_AUTH_SECRET`, newly generated and Sensitive;
  - `BETTER_AUTH_URL=https://refrain-v3-rc.vercel.app`;
  - `REFRAIN_AUTHOR_EMAIL`, Sensitive;
  - the Neon integration's `DATABASE_URL` and the Postgres variables.
  - `REFRAIN_COVER_DISPLAY_ENABLED` is unset, so no cover shows.
  - The Production variables are unchanged.

### Hosted checks

**Anonymous** (plain `curl`, no Vercel session), on the alias and on both generated URLs, with reads off and with reads on: every path answered `302` to Vercel's sign-in. That covers `/`, the archives, a published journal and memory, `/pt`, the Studio, `/sitemap.xml`, `/robots.txt`, a static image, a `/_next/static` file, and `/api/auth/get-session`. The alias answered `404` for a few seconds after it was first set, before it pointed at a deployment, then `302`.

**Authenticated past Vercel Authentication**, as the owner's team. `vercel curl` was used for headers, and the browser used the CLI's short-lived development token as `x-vercel-trusted-oidc-idp-token`, sent only to the preview's origin.

| Check | Result |
| --- | --- |
| Reads off: public routes, unknown addresses, `/sitemap.xml`, `/robots.txt` | The identical `404`, `no-store`; the Home and `/pt` the generic page (A4) |
| Reads on: Home, Albums, Artists, Memories, About, a published album journal and memory, in EN and PT | `200`, `no-store` |
| Reads on: a draft journal's address (EN and PT), an unpublished journal, an unknown album | The identical `404`, `no-store`; the draft's text is absent from the page |
| `X-Robots-Tag` | `noindex, nofollow` on **every** response checked, in both deployments |
| The Studio | `private, no-store, max-age=0, must-revalidate` |
| `robots.txt` | No `Sitemap:` line; `/studio`, `/pt/studio`, `/api/` disallowed |
| The sitemap | Only the served pages: the published album journal, its artist page, and the memory, in EN and PT |
| Studio sign-in | Without a session, `/studio` goes to sign-in; a wrong password is refused ("That email and password don't match."); the right one opens the Desk |
| Catalog CRUD | Artist created; album with release year and two tracks created; a second artist created, then deleted (gone from the database) |
| Album journal | Saved as draft, opening and text; album rating 4.5 stars saved in the editor |
| Publishing | The review showed the text and the rating; **Cancel published nothing**; the confirmation published |
| Memory | Created without a song, published through "Publish this memory?" |
| Transitions, each measured on the very next public request | Published `200`, unpublished `404`, republished `200`, moved to Recently deleted `404`, restored (private; "Restoring publishes nothing") `404`, published again `200` |
| Sign-out | `/studio` goes to sign-in again |
| Studio crawl, every page reachable from `/studio` and `/pt/studio` | **70 pages at 1440 px and 70 at 390 px**: all `200`, no page error, no server error, no horizontal overflow |
| Public crawl, from every archive, page, `/pt`, and two unknown addresses | **26 pages at each width**: all `200` except the two intended `404`s; no page error, no server error, no horizontal overflow |
| Browser console | The only error was the deliberate wrong-password sign-in's `401` |
| Hidden addresses under load (two rounds of 60 concurrent requests to a draft journal and an unknown memory) | **120 of 120 answered `404`**; no `500`; the internal rewrite header is not exposed |

**What the host shows that local runs did not:**

- **The self-proxy `500` does not occur on Vercel.** The platform routes the proxy's rewrites itself (above). The defect stays a local and CI one, in the test servers' `next start -H 127.0.0.1`.
- **#76 is visible:** every `404` from the proxy's rewrite carries `x-vercel-cache: HIT` with a growing `Age`. All unknown and hidden addresses share one cached not-found render. Every transition above still showed on the next request, because the proxy decides each request before the cache.
- **A G2 gap:** an address that no route matches (`/no-such-page`) answers `Cache-Control: public, max-age=0, must-revalidate`, not `no-store`. It is the framework's own not-found page, generic and the same for everyone, but G2 asks for `no-store` on every response class. Recorded for G2.
- **Public pages answer `x-vercel-cache: PRERENDER`:** the framework's generic shell, which ADR 0006 A2 allows. Each served page's content was the current state on every request.
- **A visual defect (minor):** on a phone, a long album title is clipped inside the sleeve's white label on the album journal.

### Signing in as the owner

1. Sign in to Vercel in the browser as a member of the team; Vercel Authentication requires it.
2. Open `https://refrain-v3-rc.vercel.app/studio`, exactly this address: the sign-in's origin check fails on a generated deployment URL.
3. Sign in as `staging-author@example.com`. The password is in the macOS Keychain under "Refrain v3 staging author (synthetic, Preview only)"; `security find-generic-password -s refrain-v3-staging-author -w` prints it.

Everything in it is synthetic. Real writing must never be entered there: the staging database has no backup, and it is not a gate-reviewed environment.

### Undoing it

Each step can be undone separately, and none touches Production:
- point the alias elsewhere, or remove it: `vercel alias rm refrain-v3-rc.vercel.app`;
- remove the Preview variables;
- disconnect and remove the Neon resource `refrain-v3-staging`;
- delete the Keychain item.

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
| 10 | **#44, the album journal without JavaScript** | **Fixed in PR #107**, combined on `release/v3-integration` (draft PR #112); not merged or deployed ([above](#without-javascript-issue-44)) | A PR applying `instant = false` to the album route, with the build-output tests rewritten to the memory page's properties |
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
