# Evidence: Public Release of the Repository

The record that [Security § Public-release gate](../security.md#public-release-gate) requires before the repository's visibility changes. It covers the **source repository** only. The hosted application stays private and protected, and public pages stay behind the release gates G1 to G8 ([#47](https://github.com/RaioViajante/refrain/issues/47)).

**Owner decisions (2026-11-06):**
- The **existing** repository becomes public with its complete, authentic history. No history is rewritten or filtered, and no replacement repository is created.
- Historical `reference/` material, the personal email address in 33 GitHub merge commits, and the existing issues, pull requests, and reviews may all become public.
- **Only the owner changes the visibility**, after this gate passes.

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
| 9 | A working private reporting channel | **Pending: the owner, at publication** | GitHub only allows private vulnerability reporting on public repositories (the API returns *Not Found* while private). [`SECURITY.md`](../../SECURITY.md) describes the procedure and a fallback. The owner enables it right after the visibility change. |
| 10 | Licenses decided | **Pending: owner confirmation** | Proposed: [MIT](../../LICENSE) for the source code and documentation; **all rights reserved** for the original artwork; no licence for the historical design references ([`LICENSE-ARTWORK.md`](../../LICENSE-ARTWORK.md)). Open question: [the design-tool runtime](#historical-design-references). |
| 11 | Independent review | See [Independent review](#independent-review) | A full-repository review in a separate context (Codex, read-only). |

## Secret scanning

The scan of 2026-11-06 used a mirror of every reference: 34 branches and 33 pull-request refs, 386 commits in all.

| Check | Result |
| --- | --- |
| `gitleaks git --redact --log-opts=--all` (v8.24.2) | 1 finding: `63889a5…:src/modules/identity/config.test.ts:generic-api-key:5`, the known synthetic value ([Security § Public-release gate](../security.md#public-release-gate)) |
| gitleaks on every distinct historical blob, which includes the content of merge commits | The same single finding |
| TruffleHog 3.88 (`--no-verification`, so no candidate was sent to any provider) | 0 findings |
| Exact match of the real production, provider, demonstration, and local secret values against every blob | 0 real matches. The only match was the local loopback-only development password, which is identical to the published placeholder in `.env.example` |
| Sensitive file types ever committed (`.env`, dumps, keys, archives, logs) | None except `.env.example` |
| Issues, pull requests, comments, and reviews (33 issues, 33 pull requests, 17 comments), and the logs of 166 Actions runs | No secret, credential, token, cookie, or private writing. No artifacts, releases, tags, environments, secrets, variables, or webhooks exist |

The values compared were never printed. The temporary pattern file holding them was deleted after the scan.

**Accepted by the owner:**
- The personal address in the 33 merge commits made through GitHub's merge button. Every other commit uses the account's noreply address.
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

**Third-party material, unresolved: an owner decision before publication.** `reference/refrain/pages/support.js` (blob `08e782a`, 188 KB, minified) is the runtime the design tool exported with the mockups:

- **Lines 1 to about 300** are React and ReactDOM 18 production builds. They are redistributable under the MIT License, and their notices are kept.
- **The rest** is the design tool's own runtime (`__dcBoot`, `__dc_design_mode`, and related code). It has **no licence notice, no copyright line, and no product name**. Its authors' terms are unknown, so publishing it is a redistribution this repository cannot license.

The owner's approval to make the history public does not settle the tool author's rights. Before publication, the owner identifies the tool and confirms that its terms allow users to share exported files, including the runtime, or accepts that risk in writing. The alternative is removing the file from history, which the owner has ruled out. Every other historical reference file is the owner's design output.

The mockups also name real albums, artists, tracks, and labels as sample content. Their placeholder covers are not real artwork, and they load fonts and libraries from public servers instead of embedding them.

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

## Independent review

Codex ran a read-only review of the whole repository, its history, and this pull request on 2026-11-06. The findings and their resolution are in the pull request that adds this file.
