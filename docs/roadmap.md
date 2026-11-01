# Roadmap

**Presentation:** Monday, November 16, 2026. The dates below are targets, not commitments or completion claims. Each milestone is complete only when its acceptance criteria are verified.

| Milestone | Target | Scope | Acceptance |
| --- | --- | --- | --- |
| **M0 — Documentation foundations** | Oct 31 | Product, requirements, architecture, data model, design system, security, workflow, ADR 0001; agent instructions; design references committed | Documents reviewed and merged |
| **M1 — Scaffold and relational core** | Nov 6 | Next.js and TypeScript scaffold with pnpm; compatibility-checked versions; Docker Compose PostgreSQL; Drizzle schema and migrations for the catalog (with reference editions) and album journals with track reflections; catalog CRUD and album-journal CRUD through simple studio pages; the JOIN and aggregate queries surfaced in the UI; integration tests on real PostgreSQL; CI | AC-01 to AC-06 demonstrable locally ([Requirements](requirements.md)) |
| **M2 — Writing Studio** | Nov 10 | Better Auth single author (delivered early, in M1.3A); Desk; album journal editor (Tiptap JSON) with track reflections, ratings, favourite, still-writing, and per-track publication flags; memories; artist journals; per-language draft, private, and published states; featured journals; slugs; Recently deleted with restore (built in M1.3C) and "Delete now" | Author can write, save, publish, unpublish, delete, and restore without data loss; studio requires authentication; **the publishing control satisfies the [ADR 0005 condition](#adr-0005-condition-for-the-m2-publishing-interface)** (no undisclosed publication of track reflections) |
| **M3 — Public journal** | Nov 13 | Approved V4.4 visual design; public pages governed by the publication predicate; `en` and `pt-BR` interface; footer language selector; accessibility pass | Privacy tests pass; no draft, private, or deleted content reachable publicly |
| **M4 — Academic release** | Nov 15 | Evidence capture, demonstration script rehearsal on a clean database, documentation update | Every requirement row has evidence; rehearsal done |
| **Later** | After Nov 16 | MusicBrainz search and import, Cover Art Archive, Wikimedia Commons photos, author translations, revisions, Markdown export, backups and a tested restore, then automatic purge (gated on those), deployment, additional editions when needed | Scoped individually |

### M1 increments

M1 is delivered in increments, each authorized separately by the author:

- **M1.1 — Application foundation** (merged, #3): the Next.js and TypeScript application with pnpm and compatibility-checked versions, Docker Compose PostgreSQL 17, a server-only Drizzle client with a connectivity check, Vitest unit and real-PostgreSQL integration tests, and GitHub Actions CI. See [Development](development.md#local-setup).
- **M1.2 — Relational domain** (merged, #5): an isolated, disposable test database with fail-closed safety checks; the full relational schema for ADR 0002 (catalog with reference editions, entries with per-language visibility, album and artist journals, memories, track reflections, ratings, featured journals, slugs) with versioned migrations; the publication predicate and public read queries; the JOIN and aggregate queries; publication history per language version and retention of published slugs after permanent deletion, with transactional commands; integration tests for the constraints, transactions, and the database-level parts of INV-1 to INV-5; [ADR 0003](decisions/0003-relational-schema-conventions.md) (accepted). See [Data Model](data-model.md).
- **Security and engineering skills foundation** (authorized by the author before M1.3; issue #7): [`SECURITY.md`](../SECURITY.md); implemented and planned protections recorded separately, with a public-release gate, in [Security](security.md#implemented-and-planned-protections); and two Claude Code skills, `/refrain-security-review` and `/refrain-db-change` ([`CLAUDE.md`](../CLAUDE.md#skills)). It includes no application features and no migrations.
- **M1.3A — Identity and authorization** (authorized by the author; issue #9): Better Auth 1.7.12 on PostgreSQL and Drizzle with migration 0004; the single author account, created only by a local command, with public sign-up disabled at all times; database sessions, sign-in, sign-out, and sign-in rate limiting; the fail-closed authorization boundary and the [authorization contract](security.md#authorization-contract) for later work; a minimal sign-in page and protected studio entry point; integration tests and HTTP tests of the production build; [ADR 0004](decisions/0004-single-author-identity.md) (accepted). This brings the "Better Auth single author" part of M2 forward.
- **M1.3B — Catalog and album-journal CRUD** (authorized by the author; issue #15): transactional catalog commands (artists, albums with their reference edition and ordered credits, tracks, ordered tracklists; archive, restore, guarded delete) and album-journal commands (create as a private draft with a reserved slug, save with the `entries.version` check, draft or private only, soft delete); Server Actions that each authorize first; the desk, artists, albums, tracks, and journals screens with plain-text writing stored as the accepted Tiptap document; the JOIN, aggregate, and subquery surfaced in the UI; a real multi-connection slug-race test; HTTP tests that call every Server Action with and without a session; [evidence](evidence/m1-3b.md). No migration. **Deliberately not built:** publishing controls, public pages, restoring a journal and "Delete now" (the owner has since accepted the restoration policy below; both are still to be built), track reflections, ratings, margin notes, translations, featuring, external providers, Tiptap. Status: merged (#16).

- **M1.3C — Recovery, browser tests, and academic verification** (authorized by the author; issue #18; implemented on its branch, complete once its pull request is merged): restoring an album journal from a private *Recently deleted* page under the owner-accepted policy ([ADR 0005](decisions/0005-restoring-deleted-journals.md), accepted), with no schema change and no permanent-delete control; a maintained Playwright suite (Chromium, the production build, the disposable database, a synthetic author, a fixed port, desktop and 390 px) that also runs in CI; a backup tool and a restore check that restores an archive into a scratch database and compares it with its source (`pnpm db:backup`, `pnpm db:backup:verify`); reproducible [evidence](evidence/m1-3c.md) for AC-01 to AC-06; two rendering defects that only a browser exposed, fixed (the new-album form and the track pages failed in the production build; an add-track select widened the page on a phone). No migration. **Catalog edit concurrency is not resolved**: see [below](#catalog-edit-concurrency-last-write-wins). **Deliberately not built:** publishing controls, public pages, "Delete now", automatic purge, track reflections, Tiptap, external providers, translations.

- **M2.1 — Command boundary** (authorized by the author; issue #27; implemented on its branch, complete once its pull request is merged): the safe publication boundary specified by [ADR 0006](decisions/0006-publication-decision-and-acknowledgement.md), backend only. The Identity module signs and verifies confirmation tokens (HKDF-SHA-256 key from `BETTER_AUTH_SECRET`, HMAC-SHA-256, 15 minutes by the database clock, bound to the author's session, the entry, the language, `entries.version`, and a fingerprint of the disclosure). `previewPublication` reads the disclosure from the real database state, with the same SQL as the public queries (the predicate fragments are parameterized by status, in their own reviewed commit), and mints the token. The checked `publishLanguageVersion(db, author, {entryId, locale, expectedVersion, confirmation})` is the only way to make a version public; the unchecked signature is gone, the write of `published` is not exported, and static scans enforce the allowlist of writers, the export surface, and the no-mint-and-consume rule. `unpublishLanguageVersion` takes the author. Interim, fail-closed: `saveAlbumJournal` refuses a published version (`published_text_locked`) until the confirmed save of M2.2 exists. No migration, no new dependency, no Studio action, no public route. **Deliberately not built:** `previewPublicChange` and the confirmed save, reflection and rating editing (M2.2), the dialogs and Server Actions (M2.3), "Delete now" (M2.4), the public-reads switch (M3.1). Gates G1 to G8 stay open.

### Follow-ups from the M1.3B review

- **Restoring a journal (owner decision accepted; built in M1.3C, [ADR 0005](decisions/0005-restoring-deleted-journals.md)).** Until M1.3C the studio moved a journal to Recently deleted and kept it, but could not restore it. At the M1.3B merge (PR #16) the owner accepted this restoration policy, which settles the question that ADR 0003 § 5 and issue #6 left open. M1.3C built it and formalized it as [ADR 0005](decisions/0005-restoring-deleted-journals.md), which is Accepted. The studio still does not offer "Delete now".
  - A language version that was **draft** is restored as a **draft**.
  - A language version that was **private** is restored as **private**.
  - A language version that was **published** is restored as **private**.
  - Restoring **never republishes** writing automatically: a restored entry and each of its language versions is never made publicly visible by the restore, and becomes public again only when the author explicitly publishes it.
  - Restoring preserves the authored content and the publication history (`first_published_at` on the version and on the entry), and **all existing slug rules** of ADR 0002 and ADR 0003 remain enforced (a published slug stays reserved and a current slug stays current).
  - The **publication predicate** ([Security](security.md#publication-predicate)) and ADR 0002's privacy invariants **INV-1 to INV-5** remain enforced: only a language version whose own status is `published`, on an entry that is not deleted, is publicly visible, and a restore never changes that on its own.
  - Automatic permanent deletion stays disabled (ADR 0002, D4.4). The Writing Studio restores album journals from *Recently deleted* since M1.3C; the policy above is what the restore command does and what its tests assert.
- **A maintained browser test (built in M1.3C).** `pnpm test:e2e` signs in, runs the Studio journey, deletes and restores a journal, and checks the 390 px layout, against the disposable test database with no personal credentials ([Development § Browser tests](development.md#browser-tests)). Behavior over real HTTPS is still not verified.
- **Catalog edits have no version counter** (unchanged in M1.3C): see [Catalog edit concurrency](#catalog-edit-concurrency-last-write-wins).
- **Typography.** Alegreya Sans is the approved reading face for the functional Studio; long-form reading typography is revisited in the later visual refinement.

### Carry-forward requirements for M1.3C

Recorded at the M1.3B merge, and what M1.3C did about each. M1.3C was authorized by the author afterwards (issue #18).

| Requirement | State after M1.3C |
| --- | --- |
| A maintained, reproducible browser end-to-end suite (sign-in, the Studio journey, the 390 px layout), runnable from a clean checkout against the disposable test database without personal credentials | Done: `pnpm test:e2e`, and in CI. See [Development § Browser tests](development.md#browser-tests) |
| Full CRUD academic verification, with evidence for AC-01 to AC-06 | [Evidence](evidence/m1-3c.md). The *Verified* column of [Requirements](requirements.md#traceability) stays empty until the author reviews it and the clean-database rehearsal (M4) is done |
| Studio restoration of a journal, following the accepted policy | Done ([ADR 0005](decisions/0005-restoring-deleted-journals.md)) |
| Public and private authorization regression tests (Required tests in [Security](security.md#required-tests)) | Extended for the new action and page (HTTP and browser). The public half still waits for the public routes (M3) |
| Catalog edit concurrency safeguards, or an explicit documented resolution of last-write-wins | **Documented, not fixed**: [below](#catalog-edit-concurrency-last-write-wins) |
| A review of malformed Server Action body behavior (HTTP 500 before any session check; [Security § Deployment gate](security.md#deployment-gate), item 3) | Reviewed: the 500 is the framework's own and nothing leaks or is written; it is a deployment-review item, not an application defect. See [Security § Deployment gate](security.md#deployment-gate) |
| Browser behavior under real HTTPS, before any public deployment (issue #11) | **Not verified.** The browser tests run over plain `http://127.0.0.1` |
| Accurate reporting of limitations, as in every milestone | [Evidence § Limitations](evidence/m1-3c.md#limitations) |

### Catalog edit concurrency (last write wins)

Artists, albums, and tracks have no version counter. Two tabs that each loaded the same record and then saved can overwrite each other's named fields: the second save wins, silently. Journal text is protected (`entries.version`, a stale save is refused as a conflict); catalog metadata is not, and **nothing in the interface claims otherwise**.

- **Why it was not fixed in M1.3C.** A correct fix is optimistic concurrency like the journal's: an additive migration adding `version integer NOT NULL DEFAULT 1` (with a `CHECK (version >= 1)`) to `artists`, `albums`, and `tracks`; a required `expectedVersion` on `updateArtist`, `updateAlbum`, and `updateTrack` (an optional one would leave last-write-wins in place for any caller that omitted it, and present it as protection); the three forms carrying the version and showing the existing conflict message; and changes to about fifty test call sites plus the HTTP tests. A token based on `updated_at` would avoid the migration but has the same call-site cost and is weaker. That is a focused change, but not one to rush into the same pull request as restoration, the browser suite, and the backup tool.
- **What it can and cannot damage.** It can overwrite a title, a year, a label, a sort name, a credit list, or a tracklist order with a stale value. It cannot touch the author's writing: journals, their versions, and their slugs are separate, and a catalog record that writing refers to is never deleted.
- **Follow-up.** One small pull request after M1.3C: the migration above (through `/refrain-db-change`, tested on a fresh and an upgraded database), the required `expectedVersion`, the form changes, and conflict tests over real connections. Until then, edit one catalog record in one tab at a time.

### ADR 0005 condition for the M2 publishing interface

Required by the owner in the M1.3C review, clarified on 2026-11-01, and recorded in [ADR 0005 § 5](decisions/0005-restoring-deleted-journals.md#5-required-condition-for-the-m2-publishing-interface), which is the authoritative text. A restore keeps each track reflection's own publication flag, so when a language version is published again after being unpublished, deleted, or restored, reflections that were flagged earlier would become public with it. M2's publishing **system** (any interface, script, bulk operation, or API that publishes or republishes a journal language version) **must not allow that silently**. Whenever publishing may expose individual track reflections, it must:

1. determine the exact set of reflections that would become public, per language (flag set and text in that language);
2. disclose that set to the author, identifying each reflection and its language;
3. let the author review or change individual publication selections;
4. require explicit acknowledgement of the effective set;
5. **enforce that acknowledgement at the Publication command boundary**, not only in the UI;
6. reject missing, outdated, or mismatched acknowledgements when the effective set has changed;
7. check this **atomically** with the visibility change, so nothing can fall between confirmation and publication;
8. apply to **every caller**, with no path around it;
9. never expose a previously published reflection as an undisclosed side effect of publishing the parent version.

Versioned acknowledgements or an equivalent concurrency-safe mechanism may be used; no command signature is fixed yet, and the design is reviewed with M2. **Accepted design (the command boundary is built in M2.1, on its branch; the studio dialogs and the confirmed save are not):** [ADR 0006](decisions/0006-publication-decision-and-acknowledgement.md) (issue #25, accepted by the owner on 2026-11-01) specifies a stateless, server-authenticated (MAC) confirmation token bound to the author's session, the entry version, the locale, and the disclosed set, with a table showing how each of the nine requirements is met. The token is evidence of a server-issued disclosure, not proof that the author acknowledged it. ADR 0005 § 5 remains the authoritative requirement either way.

Not done: M2.1 builds the command boundary that enforces this (a token for the exact disclosure, checked under the entry lock), but no publishing control exists in the studio, and nothing can set a reflection's flag yet (M2.2, M2.3). M2 is not done until the whole condition is met through the studio. Tests must show, at the command boundary and not only through the UI, that a reflection flagged before a restore does not become public without a matching acknowledgement, and that a stale or mismatched acknowledgement is refused.

### M2 increments (planned)

M2 is split into increments, each authorized separately by the author. **M2.0 (documentation) has merged (#26) and M2.1 is authorized (issue #27), implemented on its branch and awaiting review.** The rest is the planned split of the M2 and M3 rows above (the split replaces their scope). [ADR 0006](decisions/0006-publication-decision-and-acknowledgement.md) is accepted; only its M2.1 part is built, and each remaining increment needs the author's separate authorization.

**M2 acceptance is for local use only.** ADR 0005 § 5.8 ("every caller") is met for application code in M2 but not for out-of-process writers (a script, `psql`, a migration, a backup restore) until the [public page release gates](decisions/0006-publication-decision-and-acknowledgement.md#14-public-page-release-gates) G3 and G4 are closed. No M2 or M3 work may be hosted publicly before gates G1 to G8 are closed, which includes resolving, or independently verifying a safe alternative for, the catalog-wording gap (G8).

| Increment | Scope | Depends on |
| --- | --- | --- |
| **M2.0 — Publication contract** (issue #25, pull request #26; merged) | ADR 0006 (Accepted) and the documentation it changes. No code, migration, UI, or API. | The author's merge |
| **M2.1 — Command boundary** (issue #27; implemented on its branch, awaiting the author's review) | `previewPublication` and the checked `publishLanguageVersion` (author, version, locale, confirmation token); the Identity module's signing functions; the unchecked signature removed; the one-writer, export-surface, and no-mint-and-consume scans; command-level tests, concurrency tests, and mutation checks. No UI. | M2.0 merged |
| **M2.2 — Reflections** | Commands for track-reflection text, flags, still-writing, favourite, ratings, and the album rating, with the version rule and confirmed saves; the track-by-track editor in plain text. | M2.0 merged |
| **M2.3 — Publish in the studio** | Publish and Unpublish dialogs that list the disclosed reflections, confirmation for changes to a public version, Server Actions, HTTP and browser tests. | M2.1, M2.2 |
| **M2.4 — Delete now** | The studio control and its author-bound command, with the interim copy (INV-4). | M2.1 |
| **First public slice (M3.1)** | One public album-journal page by address, redirects, and identical `404`s, through the Publication queries only, with `no-store`, and the server-only, default-disabled `REFRAIN_PUBLIC_READS_ENABLED` switch with its tests (every public content-serving surface answers the unknown-address `404` unless it is exactly `true`; it never replaces the predicate). It starts with a spike that proves real `308`/`404` statuses and `no-store` under Cache Components ([ADR 0006 § 11](decisions/0006-publication-decision-and-acknowledgement.md#11-public-reads-and-caches)). Building and demonstrating it locally is not deployment: **hosting it publicly is blocked by the [public page release gates](decisions/0006-publication-decision-and-acknowledgement.md#14-public-page-release-gates)**. | M2.3 |
| After November 16, or if time allows | Author-written translations, featuring and address-change controls, memories and artist journals, the full `en` and `pt-BR` interface, Tiptap. Translations stay on the roadmap but do not block the first public demonstration. | Scoped individually |

## Critical path

AC-01 to AC-06 depend only on **M1**. M2 and M3 deliver the product, but the academic presentation must not depend on them. If time runs short, cut in this order:

1. External integrations (catalog entry remains manual).
2. Author translations and artist journals (translations are not a blocker for the first public demonstration, by the author's decision of 2026-11-01).
3. Visual polish beyond the core layout and typography.
4. Rich-text editing. A plain textarea storing the same structured format is acceptable temporarily.

Never cut database integrity, CRUD, the SQL evidence, privacy protections, or recoverable deletion.

## Risks

| Risk | Mitigation |
| --- | --- |
| Sixteen days from M0 to the presentation | Make M1 alone sufficient for the academic requirements; treat M2 and M3 as product work |
| Stack compatibility (Next.js, Better Auth, Tiptap, next-intl) | Check versions at scaffold time; record the choices; replace through an ADR if needed |
| Unclear interpretation of "backend" | Confirm with the instructor early (see [Requirements](requirements.md#notes-on-interpretation)) |
| Remaining data-model questions | Resolve those in [Data Model](data-model.md#open-questions) during M1, recording them as ADRs where they are significant |
| Studio controls beyond the V4.4 screens | Build them to the [Writing Studio controls](design-system.md#writing-studio-controls-for-adr-0002) specification, reusing existing components |

## First journal subject

The intended first real album journal is **Grace** (Jeff Buckley, 1994). The author writes it. Development uses synthetic fixtures.
