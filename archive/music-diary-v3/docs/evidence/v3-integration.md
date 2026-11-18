# Evidence: the v3 integration branch

**Status: `release/v3-integration`, draft PR #112. Not merged, not deployed.** Recorded on 2026-11-15. It combines the v3 release candidate (#106) with the five reviewed launch-blocker PRs, so the whole is verified once. Each PR stays open for its own review.

## What it is

| Part | PR | Head | Evidence |
| --- | --- | --- | --- |
| Base: v3 release candidate (#104 + #105) | #106 | `5fc316f` | [v3-rc](v3-rc.md) |
| #44: album journal without JavaScript | #107 | `9be838b` | [v3-rc § Without JavaScript](v3-rc.md#without-javascript-issue-44) |
| G2: `no-store` on every address except exact static assets | #108 | `64d02c4` | [g2-no-store](g2-no-store.md) |
| Canonical-host `308`, **off by default** | #109 | `a2eea60` | [canonical-host](canonical-host.md) |
| #11: client-aware sign-in limits, **inactive until opt-in** | #110 | `f12faa7` | [issue-11-sign-in-limits](issue-11-sign-in-limits.md) |
| G1: test servers without the self-proxy; crawler fix; **ADR 0006 A13** (owner-approved) | #111 | `3b64dac` | [self-proxy-and-g1](self-proxy-and-g1.md) |

- **Merged in that order** with `--no-ff`, keeping each PR's history. Every branch has the same merge base, `5fc316f`.
- **Two conflicts, each resolved by keeping both sides:**
  - `src/next-config.test.ts`: #108's `getPathMatch` import and #109's `matchHas` import;
  - `.env.example`: #109's and #110's entries.
- **Left out:**
  - #102 (cover removal, A8), pending its own review of A8;
  - #105, already in #106, so not merged again.
- **ADR status:** ADR 0006 **A13** is accepted (the owner, 2026-11-15). ADR 0011, ADR 0012, and the proposed amendments A8 to A12 stay **Proposed**: see the [owner packet](v3-owner-packet.md).
- **Added on this branch, from the combined review:**
  - assertions that the sign-in `429` and `503` refusals are `no-store` and `noindex, nofollow`, and carry only their code, not the client's address, a cookie, or a counter key;
  - doc corrections: statuses, why `x-forwarded-for` is trusted only on Vercel, and the canonical `308` as a recorded exception to G2.

## Verification of the combination

Run on `4542dd8` (the five merges), on the disposable test database, reset before each database suite. The later commits add only the test and documents above; that test was run on its own (below).

| Check | Result |
| --- | --- |
| `pnpm install --frozen-lockfile` | Lockfile unchanged |
| `pnpm lint`, `pnpm format:check`, `pnpm typecheck` | Clean |
| `pnpm test` | 59 files, **1,356 passed** |
| `pnpm test:integration` | 38 files, **813 passed** |
| `pnpm build` | Succeeded |
| `pnpm test:http` | **22 files, 808 passed, 0 failed** |
| `pnpm test:e2e:run` (every project, `E2E_KEEP_SERVER_LOG=1`) | **359 passed, 0 failed, 4 skipped**; no `Failed to proxy` in any of the three servers' logs |
| The sign-in refusal test, added afterwards (`sign-in-limits.http.test.ts`, on the PostgreSQL 18 disposable database) | **4 passed** |

### Where each required property is held

| Property | Held by |
| --- | --- |
| **G1 under A13:** hidden and unknown answer the same in every form | `public-router-forms.http.test.ts`: the empty-against-populated database comparison (30 answers byte-identical), plus hidden journals, memories, and six artist states against unknown, per URL form, EN and `/pt`. `public-archives.http.test.ts`: A13's properties for `.rsc` and `.segments`, and byte identity for every other form. `public-album-journal`, `public-memory`, `public-artist`, and `public-request-forms` (crawlers included) |
| **No private text, identifier, or cookie through URL router forms** | The raw scans in `public-router-forms.http.test.ts` (markers, `[Test]`, titles, the run's slug prefix, the probe cookie). The cookie checks in `public-archives.http.test.ts` and `public-album-journal.http.test.ts` (no `x-middleware-request-*` copy) |
| **G2:** `no-store`, and static assets kept cacheable | `next-config.test.ts` (the rule, its order, and its exact exclusions, through the framework's matcher). `route-structure.http.test.ts` (`/_not-found`, `/_global-error`, missing assets, `/_next/imagex`, and the Studio's private policy) |
| **#44 without JavaScript** | `e2e/public.spec.ts`, "reads in full without JavaScript, in both languages", at 1440 and 390 px. `public-album-journal.http.test.ts` (no hidden streamed markup, EN and PT). `public-build-output.http.test.ts` (empty fallback, EN and `/pt`) |
| **Sign-in limits and spoofing** | Unit: `config.test.ts` and `sign-in-limits.test.ts`. Integration (40 concurrent attempts allow exactly the limit): `sign-in-limits.integration.test.ts`. HTTP: `sign-in-limits.http.test.ts` and `studio.http.test.ts`. With no trusted header, a forged `X-Forwarded-For` buys no bucket |
| **Canonical redirect, off** | `next-config.test.ts`: no rule unless listed, `redirects()` equal to the environment's. HTTP and browser suites: no redirect anywhere. Verified on builds: a listed host emits exactly one rule, and a looping configuration stops the build |
| **EN and PT navigation, Studio CRUD** | `e2e/i18n-public`, `i18n-studio` (every Studio page at five widths), `catalog`, `tracks`, `music`, `journal`, `editor-journal`, `memories`, and `studio-actions.http.test.ts` |
| **Publish, unpublish, delete, restore** | `e2e/publication.spec.ts`, `recovery.spec.ts`, `memories.spec.ts`, and `public-transitions.http.test.ts` (the next request after each change) |
| **Desktop and mobile navigation** | Every public and Studio browser project at 1440 and 390 px (`mobile-390`, `public-390`, `home-390`, `archives-390`, `memory-390`, `artist-390`, and others), `layout.spec.ts`, and `accessibility.spec.ts` |

## Independent security review of the combined diff (`4542dd8`)

**GO**, with no Critical, High, or Medium finding.
- **The merge is lossless.** Each of the 34 files that only one PR changed is identical to that PR's version. For each of the 5 files two PRs changed, both diffs are present, checked in both directions.
- **The interactions were checked:**
  - #108's catch-all rule against the section rules and the Studio's private policy;
  - #110's refusals against the header rules;
  - #111's not-found rewrite against #107's one-pass album journal;
  - the canonical `308` against #108.
- No test was weakened.

| Finding | Done |
| --- | --- |
| Low: the canonical `308` carries neither `no-store` nor the indexing header, even with #108 (a framework redirect returns before the header rules) | Recorded as an exception in [g2-no-store](g2-no-store.md), and as part of the hosted G2 check. Already an owner decision ([canonical-host](canonical-host.md)) |
| Low: no test held the `429` and `503` refusals' headers and body | Added (above) |
| Low: `docs/security.md` said a forwarding header never counts, next to a design that trusts `x-forwarded-for` on Vercel | Reworded: on Vercel the platform sets it, and only there, by explicit opt-in, does it name the client |
| Low: three status lines said "draft PR" or "draft branch" | Updated to name this integration branch |
| Info: a comment's position in `next.config.ts`; a race-window rendering note | No change; recorded |

## Not verified

- **Anything on a host.** The checks that need a protected deployment of the approved `main` are in the [launch checklist](launch-gates.md):
  - G1 and G2 in every request form, including A13's forms and the canonical `308`;
  - Vercel's request-header override, used by the crawler fix;
  - Vercel's overwrite of `x-forwarded-for` (#110);
  - the indexing policy.
- **CI on the final head** is recorded in the pull request.

## Review of the complete diff into `main` (`origin/main...4cf6c3c`)

Before the merge into `main`, an independent review covered the whole diff: 166 files, 76 commits, #103 to #113.

**GO**, with no Critical, High, or Medium finding. It verified:
- every public v3 screen reads only through the Publication module's reading entry point, behind the switch;
- A13 is scoped to the router's URL forms, and the proxy's only behaviour change is the not-found request's `User-Agent`;
- `no-store` and the indexing constant hold;
- every Studio screen, `/studio/system` included, authorizes first, and no Server Action changed;
- there is no authentication-method change, and the sign-in limits fail closed;
- `gitleaks` over the 69 non-merge commits found no secret;
- the Music Story code is server-only and unwired;
- the ADR Status lines match the owner's decision;
- no test was skipped or weakened.

| Finding | Done |
| --- | --- |
| Low: `AGENTS.md` and the Design System called v3 "on draft PR #104 (not merged)" | Updated to "integrated through #112" |
| Low: `AGENTS.md` § 1 said the Studio follows V4.4 | Updated: the Studio follows v3 since #112 |
| Low: "Administrative controls never appear on public pages" sat inside a bullet marked superseded | Restated as its own **binding** rule in `AGENTS.md` § 6 |
| Low: the v3 rewrite of the artist, memory-page, and archives browser specs (#104) no longer runs their forced-colours, layout-shift, and visible-focus-ring checks. The 44 px target and axe checks remain | **Open follow-up**, not a security issue: restore those accessibility checks for the v3 pages in a test-only pull request |
