# Roadmap

**Presentation:** Monday, November 16, 2026. The dates below are targets, not commitments or completion claims. Each milestone is complete only when its acceptance criteria are verified.

| Milestone | Target | Scope | Acceptance |
| --- | --- | --- | --- |
| **M0 — Documentation foundations** | Oct 31 | Product, requirements, architecture, data model, design system, security, workflow, ADR 0001; agent instructions; design references committed | Documents reviewed and merged |
| **M1 — Scaffold and relational core** | Nov 6 | **Precondition:** [ADR 0002](decisions/0002-domain-model-decisions.md) accepted. Next.js and TypeScript scaffold with pnpm; compatibility-checked versions; Docker Compose PostgreSQL; Drizzle schema and migrations for the catalog (with reference editions) and album journals with track reflections; catalog CRUD and album-journal CRUD through simple studio pages; the JOIN and aggregate queries surfaced in the UI; integration tests on real PostgreSQL; CI | AC-01 to AC-06 demonstrable locally ([Requirements](requirements.md)) |
| **M2 — Writing Studio** | Nov 10 | Better Auth single author; Desk; album journal editor (Tiptap JSON) with track reflections, ratings, favourite, still-writing, and per-track publication flags; memories; artist journals; per-language draft, private, and published states; featured journals; slugs; Recently deleted with restore and "Delete now" | Author can write, save, publish, unpublish, delete, and restore without data loss; studio requires authentication |
| **M3 — Public journal** | Nov 13 | Approved V4.4 visual design; public pages governed by the publication predicate; `en` and `pt-BR` interface; footer language selector; accessibility pass | Privacy tests pass; no draft, private, or deleted content reachable publicly |
| **M4 — Academic release** | Nov 15 | Evidence capture, demonstration script rehearsal on a clean database, documentation update | Every requirement row has evidence; rehearsal done |
| **Later** | After Nov 16 | MusicBrainz search and import, Cover Art Archive, Wikimedia Commons photos, author translations, revisions, Markdown export, backups and a tested restore, then automatic purge (gated on those), deployment, additional editions when needed | Scoped individually |

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
| ADR 0002 not yet approved | Owner review before M1 migrations; then resolve the remaining [Data Model](data-model.md#open-questions) questions |
| V4.4 screens lack controls that ADR 0002 requires | Owner design approval of the [design gaps](design-system.md#design-gaps-from-adr-0002) before M2 editors and M3 pages |

## First journal subject

The intended first real album journal is **Grace** (Jeff Buckley, 1994). The author writes it. Development uses synthetic fixtures.
