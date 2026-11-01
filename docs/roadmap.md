# Roadmap

**Presentation:** Monday, November 16, 2026. The dates below are targets, not commitments or completion claims. Each milestone is complete only when its acceptance criteria are verified.

| Milestone | Target | Scope | Acceptance |
| --- | --- | --- | --- |
| **M0 — Documentation foundations** | Oct 31 | Product, requirements, architecture, data model, design system, security, workflow, ADR 0001; agent instructions; design references committed | Documents reviewed and merged |
| **M1 — Scaffold and relational core** | Nov 6 | Next.js and TypeScript scaffold with pnpm; compatibility-checked versions; Docker Compose PostgreSQL; Drizzle schema and migrations for the catalog (with reference editions) and album journals with track reflections; catalog CRUD and album-journal CRUD through simple studio pages; the JOIN and aggregate queries surfaced in the UI; integration tests on real PostgreSQL; CI | AC-01 to AC-06 demonstrable locally ([Requirements](requirements.md)) |
| **M2 — Writing Studio** | Nov 10 | Better Auth single author (delivered early, in M1.3A); Desk; album journal editor (Tiptap JSON) with track reflections, ratings, favourite, still-writing, and per-track publication flags; memories; artist journals; per-language draft, private, and published states; featured journals; slugs; Recently deleted with restore and "Delete now" | Author can write, save, publish, unpublish, delete, and restore without data loss; studio requires authentication |
| **M3 — Public journal** | Nov 13 | Approved V4.4 visual design; public pages governed by the publication predicate; `en` and `pt-BR` interface; footer language selector; accessibility pass | Privacy tests pass; no draft, private, or deleted content reachable publicly |
| **M4 — Academic release** | Nov 15 | Evidence capture, demonstration script rehearsal on a clean database, documentation update | Every requirement row has evidence; rehearsal done |
| **Later** | After Nov 16 | MusicBrainz search and import, Cover Art Archive, Wikimedia Commons photos, author translations, revisions, Markdown export, backups and a tested restore, then automatic purge (gated on those), deployment, additional editions when needed | Scoped individually |

### M1 increments

M1 is delivered in increments, each authorized separately by the author:

- **M1.1 — Application foundation** (merged, #3): the Next.js and TypeScript application with pnpm and compatibility-checked versions, Docker Compose PostgreSQL 17, a server-only Drizzle client with a connectivity check, Vitest unit and real-PostgreSQL integration tests, and GitHub Actions CI. See [Development](development.md#local-setup).
- **M1.2 — Relational domain** (merged, #5): an isolated, disposable test database with fail-closed safety checks; the full relational schema for ADR 0002 (catalog with reference editions, entries with per-language visibility, album and artist journals, memories, track reflections, ratings, featured journals, slugs) with versioned migrations; the publication predicate and public read queries; the JOIN and aggregate queries; publication history per language version and retention of published slugs after permanent deletion, with transactional commands; integration tests for the constraints, transactions, and the database-level parts of INV-1 to INV-5; [ADR 0003](decisions/0003-relational-schema-conventions.md) (accepted). See [Data Model](data-model.md).
- **Security and engineering skills foundation** (authorized by the author before M1.3; issue #7): [`SECURITY.md`](../SECURITY.md); implemented and planned protections recorded separately, with a public-release gate, in [Security](security.md#implemented-and-planned-protections); and two Claude Code skills, `/refrain-security-review` and `/refrain-db-change` ([`CLAUDE.md`](../CLAUDE.md#skills)). It includes no application features and no migrations.
- **M1.3A — Identity and authorization** (authorized by the author; issue #9): Better Auth 1.7.12 on PostgreSQL and Drizzle with migration 0004; the single author account, created only by a local command, with public sign-up disabled at all times; database sessions, sign-in, sign-out, and sign-in rate limiting; the fail-closed authorization boundary and the [authorization contract](security.md#authorization-contract) for later work; a minimal sign-in page and protected studio entry point; integration tests and HTTP tests of the production build; [ADR 0004](decisions/0004-single-author-identity.md) (accepted). This brings the "Better Auth single author" part of M2 forward.
- **M1.3B — Catalog and album-journal CRUD** (authorized by the author; issue #15): transactional catalog commands (artists, albums with their reference edition and ordered credits, tracks, ordered tracklists; archive, restore, guarded delete) and album-journal commands (create as a private draft with a reserved slug, save with the `entries.version` check, draft or private only, soft delete); Server Actions that each authorize first; the desk, artists, albums, tracks, and journals screens with plain-text writing stored as the accepted Tiptap document; the JOIN, aggregate, and subquery surfaced in the UI; a real multi-connection slug-race test; HTTP tests that call every Server Action with and without a session; [evidence](evidence/m1-3b.md). No migration. **Deliberately not built:** publishing controls, public pages, restoring a journal and "Delete now" (issue #6 asks for the restore decision first), track reflections, ratings, margin notes, translations, featuring, external providers, Tiptap. Status: implemented on its branch; complete once its pull request is merged.

### Follow-ups from the M1.3B review

- **Restoring a journal (a requirement, not built).** The studio moves a journal to Recently deleted and keeps it, but cannot restore it, and does not offer "Delete now". Before any restore interface exists, the owner decides what restoring does to visibility (ADR 0003 § 5, issue #6). **Proposed, not accepted, for the owner's review:** a restore returns language versions that were published as **private**, keeps drafts as **drafts**, keeps private versions **private**, and never republishes writing automatically; publishing again is the author's explicit act. It becomes policy only when the owner accepts it and it is recorded in an ADR or the data model.
- **A maintained browser test (M1.3C).** The studio's journey is covered without a browser by `pnpm test:http`, and was driven once in a real browser; a Playwright test of sign-in, the journey, and the 390 px layout is still to be added (it also serves issue #11). Until then, [Development § Trying the Studio with synthetic data](development.md#trying-the-studio-with-synthetic-data) reproduces the manual journey on the disposable test database.
- **Catalog edits have no version counter**, so two sessions can overwrite each other's named fields; journal text is protected by `entries.version`. Revisit if it matters in practice.
- **Typography.** Alegreya Sans is the approved reading face for the functional Studio; long-form reading typography is revisited in the later visual refinement.

## Critical path

AC-01 to AC-06 depend only on **M1**. M2 and M3 deliver the product, but the academic presentation must not depend on them. If time runs short, cut in this order:

1. External integrations (catalog entry remains manual).
2. Author translations and artist journals.
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
