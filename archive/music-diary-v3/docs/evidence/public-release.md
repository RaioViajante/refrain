# Evidence: Public Release of the Repository

The record that [Security § Public-release gate](../security.md#public-release-gate) requires before the repository's visibility changes, and of the publication itself. **The repository has been public since 2026-11-06** ([Publication](#publication)). This record covers the **source repository** only. The hosted application stays private and protected, and public pages stay behind the release gates G1 to G8 ([#47](https://github.com/RaioViajante/refrain/issues/47)).

**Owner decisions (2026-11-06):**
- The **existing** repository becomes public with its complete, authentic history. No history is rewritten or filtered, and no replacement repository is created.
- Historical `reference/` material, the personal email address in the commits made through GitHub's merge buttons (33 on `main` so far), and the existing issues, pull requests, and reviews may all become public.
- **Only the owner changes the visibility**, after this gate passes. The owner then specifically authorized the agent to perform this one change on the owner's behalf ([One-time authorization](#one-time-authorization)).

Audited: `main` at `5b050e229a3663abe7ac5f068c9f4f459b184eb6`, plus this pull request.

## The gate

| # | Item | Status | Evidence |
| --- | --- | --- | --- |
| 1 | No committed credentials | **Met** | gitleaks found no secret in the tree. The only connection strings are the documented placeholders for disposable local and CI databases (`.env.example`, `compose.yaml`, CI). |
| 2 | History reviewed for secrets | **Met** | See [Secret scanning](#secret-scanning). The one finding, a synthetic test value, is recorded as reviewed in [`.gitleaksignore`](../../.gitleaksignore). |
| 3 | No private journal data | **Met** | No real writing, ratings, dates, database dump, or screenshot of a private entry is in any tracked file or historical blob. Every fixture is labeled `[Test]`. The historical `reference/` mockups hold bracketed placeholders and sample music names. |
| 4 | Authorization verified | **Met by existing tests** | Required test 1: every studio action and route handler refuses unauthenticated requests over HTTP. 561 HTTP tests passed on PostgreSQL 17 and 18 in CI run 42156403500 on `5b050e2`. |
| 5 | Authentication and sessions tested | **Met by existing tests** | Sign-in, sign-out, session expiry, and cookie flags, plus Required test 7 (the sign-up endpoint is unavailable). Covered by the HTTP and browser suites (316 browser tests) in the same run. |
| 6 | Production secrets isolated | **Met for the repository** | Production credentials exist only in the hosting provider's encrypted environment. None is in the repository, CI (which has no secrets), or the development `.env`. Temporary local copies made during hosted verification sit outside the repository, in the owner's private working folder, and are awaiting the owner's separate clean-up. |
| 7 | Public metadata and caching reviewed | **Met by existing tests** | Required tests 2 to 5 (predicate, metadata, sitemap, caches), and the F-01 fix (studio responses private and `no-store`), verified on the host (#63, #64). |
| 8 | Dependency advisories evaluated | **Met** | See [Advisories](#dependency-advisories). |
| 9 | A working private reporting channel | **Met: enabled 2026-11-06, right after publication** | GitHub only allows private vulnerability reporting on public repositories. After the visibility change it was enabled, and the API read back `enabled: true`. The repository's Security page shows **Report a vulnerability** to signed-out visitors. [`SECURITY.md`](../../SECURITY.md) describes the procedure and a fallback ([Publication](#publication)). |
| 10 | Licenses decided | **Met: confirmed by the owner on 2026-11-06** | [MIT](../../LICENSE), copyright RaioViajante, for the original source code and documentation. **All rights reserved** for the owner's original artwork, illustrations, and visual identity. No licence for the historical design references ([`LICENSE-ARTWORK.md`](../../LICENSE-ARTWORK.md)). Third-party components keep their own licensing status ([`THIRD-PARTY-NOTICES.md`](../../THIRD-PARTY-NOTICES.md)). Claude Design's runtime in the history remains an [owner-accepted uncertainty](#historical-design-references), not verified permission. |
| 11 | Independent review | See [Independent review](#independent-review) | A full-repository review in a separate context (Codex, read-only). |

## Secret scanning

The final full-history scan on 2026-11-06 used a fresh mirror of every reference at `aa575cb`, this pull request's last commit that changed anything but this file's wording: 35 branches and the refs of 34 pull requests, 390 commits, and no tags. The first scan, of the 386 commits before this pull request, gave the same results. The commits after `aa575cb` change only this file and `THIRD-PARTY-NOTICES.md`. gitleaks on the final tree found no leaks.

| Check | Result |
| --- | --- |
| `gitleaks git --redact --log-opts=--all` (v8.24.2) | 1 finding: `63889a5…:src/modules/identity/config.test.ts:generic-api-key:5`, the known synthetic value ([Security § Public-release gate](../security.md#public-release-gate)). With [`.gitleaksignore`](../../.gitleaksignore): no leaks |
| gitleaks on every distinct historical blob, which includes the content of merge commits | The same single finding |
| TruffleHog 3.88 (`--no-verification`, so no candidate was sent to any provider) | 0 findings |
| Exact match of the real production, provider, demonstration, and local secret values against every blob | 0 real matches. The only match was the local loopback-only development password, which is identical to the published placeholder in `.env.example` |
| Sensitive file types ever committed (`.env`, dumps, keys, archives, logs) | None except `.env.example` |
| Issues, pull requests, comments, and reviews (33 issues, 33 pull requests, 17 comments), and the logs of 166 Actions runs | No secret, credential, token, cookie, or private writing. No artifacts, releases, tags, environments, secrets, variables, or webhooks exist |

The values compared were never printed. The temporary pattern file holding them was deleted after the scan.

**Accepted by the owner:**
- The personal address in 33 commits on `main`: 32 merges made with GitHub's merge button or `gh pr merge`, and one squash merge (`87f2b2a`, #10). GitHub also uses it for its own test-merge commits of open pull requests (`refs/pull/*/merge`), which it regenerates. Every other commit uses the account's noreply address. Each further merge through GitHub adds one, unless the owner turns on **Keep my email addresses private** in GitHub's email settings.
- Hosting-provider preview comments that show the team's slug. Their deployments are protected and were cancelled.

## Dependency advisories

`pnpm audit` reports two moderate advisories. CI fails on high or critical (`pnpm audit --audit-level=high`). Neither is reachable in the application.

| Advisory | Path | Assessment |
| --- | --- | --- |
| esbuild ≤ 0.24.2: a development server answers cross-origin requests (GHSA-67mh-4wv8-2f99) | `drizzle-kit` → `@esbuild-kit/esm-loader` → `esbuild` | **Not applicable.** It affects `esbuild`'s development server, which Refrain never starts. drizzle-kit uses the loader only to read its configuration. It is a development dependency, absent from the production build. |
| minimatch 7.0.0 to < 11.0.1: denial of service through brace-pattern amplification (GHSA-g3hv-75wg-m249) | `eslint-config-next` → `typescript-eslint` → `minimatch` | **Not applicable.** It runs only in the linter, on the repository's own patterns, never on untrusted input, and is a development dependency. |

They are re-checked when those development tools are updated.

## Historical design references

`reference/` was added in `24ccad7` and removed from the tracked tree in `fa9c2ba`. It is reachable from every branch, so it becomes public with the history, by the owner's decision. Its contents:
- the V4.4 mockups: 29 pages and their captures;
- a favicon kit, a cursor kit, and hand-off notes.

None of it is used by the application, and no licence is granted for it.

**Third-party material.** `reference/refrain/pages/support.js` (blob `08e782a`, 188 KB, minified) is the runtime that **Claude Design** included in its downloadable project export with the mockups. The owner states this; the file itself names no product:

- **Lines 1 to about 300** are React and ReactDOM 18 production builds, with an embedded Modernizr build. They are redistributable under the MIT License. Their headers in the file point to licence texts that the historical tree never contained, so [THIRD-PARTY-NOTICES.md](../../THIRD-PARTY-NOTICES.md) now carries those texts.
- **The rest** is Claude Design's own runtime (`__dcBoot`, `__dc_design_mode`, and related code). It has **no licence notice, no copyright line, and no product name**. It is Anthropic's, not the owner's. This repository does not license it, and the MIT License does not apply to it.

**Owner-accepted uncertainty (2026-11-06).** The owner explicitly accepts that this exported file stays readable in the repository's public history. The file came directly from Claude Design's downloadable export. This is recorded as an **accepted third-party redistribution uncertainty**:
- it is **not** an independently verified licence to redistribute Claude Design's runtime;
- no separate authorization from Anthropic was sought;
- the owner decided that none is a prerequisite for this release.

If Anthropic or any rights holder asks, the owner will respond. The file is kept unchanged, and the history is not rewritten. Every other historical reference file is the owner's design output.

The mockups also name real albums, artists, tracks, and labels as sample content. Their placeholder covers are not real artwork, and they load fonts and libraries from public servers instead of embedding them.

## Confirmed compliance versus accepted risk

**Confirmed by evidence:**
- **No secret** in the tree or in any historical blob: gitleaks, TruffleHog, and the exact-value match ([Secret scanning](#secret-scanning)).
- **No private writing or personal data,** apart from the accepted email address.
- **React, ReactDOM, and Modernizr** in the historical `support.js`: MIT, with their notices reproduced in [THIRD-PARTY-NOTICES.md](../../THIRD-PARTY-NOTICES.md) as their publishers ship them.
- **Fonts, dependencies, album artwork, and photographs** are not vendored. They are fetched under their own licences.
- **The CI workflow is fork-safe:** no secrets, a read-only token, `pull_request` only, and pinned actions.
- **The two moderate advisories** are in development tools only.
- **The existing test suites** cover authorization, sessions, and public caching.

**Accepted by the owner (2026-11-06), not verified compliance:**
1. **Claude Design's runtime** stays in the public history without a verified redistribution licence ([Historical design references](#historical-design-references)).
2. **The historical `reference/` material** becomes public, including real music names used as sample content in the mockups.
3. **The personal email address** in the merge commits made through GitHub.
4. **The reviewed synthetic test value** in `63889a5` stays in history.
5. **Hosting-provider preview comments** that show the team's slug, and the public issues about the fixed F-01.

**Done:**
- The licences confirmed on 2026-11-06 (gate item 10).
- The readiness pull requests merged: #67 (`342bc41`) and #68 (`e201d5a`).
- The repository made public, and its settings enabled and verified ([Publication](#publication)).

**Nothing is left open in the source-publication gate.** The hosted application's gates are separate: see the start of this record.

## Public GitHub Actions

[`ci.yml`](../../.github/workflows/ci.yml):
- runs on `pull_request` and pushes to `main` only, never `pull_request_target` or `workflow_run`;
- has `permissions: contents: read`;
- uses no secret, and pins every action to a full commit SHA;
- never deploys or merges.

The repository's default token is read-only, and Actions cannot approve pull requests. The settings to enable at publication are listed in [Development § Repository protection](../development.md#repository-protection).

The hosted-backup workflow templates (`ops/backup/automation/`) do not run in this repository. They are meant for a separate private repository.

## Hosting boundary

Making the repository public changes nothing in hosting:
- Vercel Authentication covers every deployment, with no bypass;
- the public-reads switch is off;
- the Ignored Build Step and "create deployments: disabled" stay;
- the production aliases still point at the protected deployment;
- the database and its credentials are untouched.

Changing visibility triggers no deployment.

## Publication

**The visibility change.**
- **What:** `RaioViajante/refrain`, repository ID `1440036347`, changed from private to public on **2026-11-06 between 16:15:09 and 16:15:14 UTC**, with the official GitHub CLI: `gh repo edit RaioViajante/refrain --visibility public --accept-visibility-change-consequences`.
- **`main` at publication:** `e201d5a338d6e100fb39dfe65922dfdf4d061f03`. Its post-merge CI (run 42246886266) was green.
- **Same repository:** no new repository was created, and nothing was renamed, rewritten, filtered, or force-pushed.

**Checks made just before the change:** the repository was private; `main` matched the approved commit; #68 was merged and its CI green; gate 10 was recorded as met. Snapshot: 36 branches, 35 pull-request refs, 69 issues and pull requests, root commit `24ccad7`.

### Evidence after the change

| Check | How it was checked | Result |
| --- | --- | --- |
| Visibility and identity | `gh repo view`, and the unauthenticated REST API (`api.github.com/repos/RaioViajante/refrain`, no token) | `PUBLIC`, `private: false`, the same ID `1440036347`; GitHub detects the licence as MIT |
| Anonymous web access | `curl` with no credentials | HTTP 200 for the repository, `LICENSE`, `SECURITY.md`, `LICENSE-ARTWORK.md`, issue #65, pull request #67, and commit `24ccad7` |
| History preserved | An anonymous mirror clone (no token, no credential helper) | 36 branches and 35 pull-request refs, the same as just before; 397 commits; `main` at `e201d5a`; root commit `24ccad7`, where `reference/` is readable |
| Private vulnerability reporting | `PUT …/private-vulnerability-reporting`, then a read-back | `enabled: true`; the signed-out Security page shows **Report a vulnerability** |
| Secret scanning and push protection | `PATCH` of the repository's `security_and_analysis`, then a read-back | both `enabled` |
| Dependabot alerts | `PUT …/vulnerability-alerts`, then `GET` | enabled (`204`) |
| Workflows from forks | `PUT …/actions/permissions/fork-pr-contributor-approval`, then a read-back | `all_external_contributors` (it was `first_time_contributors`) |
| Workflow token | `PUT …/actions/permissions/workflow`, then a read-back | `read`; Actions cannot approve pull requests (unchanged) |
| Protection of `main` | `PUT …/branches/main/protection`, then a read-back | Pull request required (0 approvals, so the sole maintainer can merge their own); required checks `Verify` and `Database tests (PostgreSQL 18)`, from GitHub Actions (app 15368), the exact names on `main`'s latest commit; branches not required to be up to date; force pushes and deletion blocked |
| Hosting unchanged | The hosting provider's API, and an anonymous request | No deployment created after the change. Both production aliases still point at the protected deployment. Authentication on every deployment, no bypass, the Ignored Build Step, "create deployments: disabled", and fork protection all unchanged. The public-reads switch is `false`. An anonymous `/studio` request is redirected to the provider's sign-in |

### Deliberate choices and limits

- **Not verified, assumed:**
  - The anonymous checks were made from a terminal with `curl` and `git`, without credentials, not in a browser.
  - **Report a vulnerability** was seen in the page's HTML; no report was submitted.
  - The settings were read back through the same owner's API access. Their effect on a real fork pull request or a real secret push has not been exercised.
- **Admin enforcement is off** (`enforce_admins: false`). Admins can override the protection, and GitHub shows an override as such. The project's rule is never to bypass it ([`AGENTS.md`](../../AGENTS.md) § 10). It is off so that an outage or a flaky test (#69) cannot lock out the sole maintainer, and the owner may turn it on.
- **Not enabled, because they were not requested:** Dependabot security-update pull requests, and secret scanning's validity checks and non-provider patterns.
- **What cannot be undone:** once public, clones, forks, and caches made since then outlive any later return to private.

### One-time authorization

The project's rule is that agents never change the repository's visibility ([`AGENTS.md`](../../AGENTS.md) § 5, [Security § Public-release gate](../security.md#public-release-gate)). For this publication, the owner gave an explicit, written, one-time authorization for the agent to run the single visibility change above, on the owner's behalf, after the final checks.

- **It covers only this completed operation:** making `RaioViajante/refrain` public on 2026-11-06.
- **It does not authorize** any other visibility change, of this or any other repository, in any future task.
- **The general rule is unchanged:** agents do not change a repository's visibility without the owner's specific authorization for that change.

## Independent review

Codex ran a read-only review of the whole repository on 2026-11-06, in a separate context: its history, the trust boundaries of the application, the public workflow, licensing, and these documents. It found no credential, no private writing, no material hosting identifier, and no Critical or High issue. The authorization, session, publication-switch, predicate, provider, caching, and backup boundaries showed no new issue. The global sign-in rate-limit bucket remains a documented availability risk, not a publication risk.

| Finding | Severity | Disposition |
| --- | --- | --- |
| The design-tool runtime in `support.js` has no licence notice. Also, React's headers point to licence texts that the history lacks | Medium | **React, ReactDOM, and the embedded Modernizr:** fixed. [THIRD-PARTY-NOTICES.md](../../THIRD-PARTY-NOTICES.md) reproduces the notices as `react-dom` 18.3.1 ships them, and what Modernizr's licence page states, without naming holders the sources do not name. **Claude Design's runtime:** the owner identified the tool and accepted the redistribution uncertainty on 2026-11-06 ([above](#historical-design-references)). It is recorded as an accepted risk, not as verified compliance |
| This record was stale (commit count, merge-commit wording) and described the review before it happened | Low | Fixed: the counts come from the full-history scan at `aa575cb` ([Secret scanning](#secret-scanning)), with the final tree scanned separately, and the wording is corrected |
| Security and development docs still called merged milestones branch-only, and memories unbuilt | Low | Fixed: a note on the matrix headings (kept so links work), and the two sentences corrected |
| "A fork's workflows run only after approval" depends on a setting, not on the workflow | Low | Fixed: stated as a repository setting enabled at publication |
