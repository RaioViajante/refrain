# AGENTS.md

Canonical instructions for anyone, human or agent, changing this repository. Tool-specific files such as [`CLAUDE.md`](CLAUDE.md) add to these instructions and never override them. Details live in [`docs/`](docs/); this file states the rules and points to them.

## 1. Project

Refrain is a **single-author personal music journal**: memories, artist journals, and album journals with per-track reflections, plus optional independent album and track ratings. There is one administrator, and the public can read only explicitly published entries. → [Product](docs/product.md)

- **Out of scope:** reader accounts, social features, streaming, recommendations, multiple authors, multi-tenancy, and machine translation. Do not add these without an ADR and the author's approval.
- **Academic deadline:** the presentation is on **2026-11-16**. Work that the requirements in [Requirements](docs/requirements.md) depend on takes priority over polish.
- **Current state:** M1.3C, recovery, browser tests, and academic verification, on top of M1.3B's catalog and album-journal CRUD, M1.3A's identity and authorization, and M1.2's relational domain: the Next.js application, the domain schema with versioned migrations, the publication predicate and read queries, transactional publication and deletion commands, single-author authentication (Better Auth), the studio's authorization boundary, catalog commands and album-journal commands (private drafts, version-checked saves, soft delete, and **restore from Recently deleted**, which never publishes), the desk, artists, albums, tracks, and journals screens plus a private *Recently deleted* page, driven by Server Actions that each authorize first, a disposable test database, integration, concurrency, HTTP, and **Playwright browser tests**, a local backup tool whose archives can be restored into a scratch database, and CI. The Studio's visual layer follows the V4.4 design ([Studio visual fidelity](docs/design/studio-visual-fidelity.md)). M2.2 (on its branch) adds the Track by track editor and the confirmed save. Nothing publishes: there are no public pages, publishing controls, or "Delete now" yet. Catalog edits are still last-write-wins ([Roadmap](docs/roadmap.md#catalog-edit-concurrency-last-write-wins)). Every administrative operation follows the [authorization contract](docs/security.md#authorization-contract). Each M1 increment needs the author's authorization. → [Roadmap](docs/roadmap.md), [Data Model](docs/data-model.md), [Development](docs/development.md#local-setup)
- **Accepted decisions:** [ADR 0001](docs/decisions/0001-modular-monolith.md) (modular monolith), [ADR 0002](docs/decisions/0002-domain-model-decisions.md) (domain model), [ADR 0003](docs/decisions/0003-relational-schema-conventions.md) (schema conventions, publication history, slug retention), [ADR 0004](docs/decisions/0004-single-author-identity.md) (single-author identity and access), [ADR 0005](docs/decisions/0005-restoring-deleted-journals.md) (restoring deleted journals, with a required safety condition on the M2 publishing interface), and [ADR 0006](docs/decisions/0006-publication-decision-and-acknowledgement.md) (publication decision and acknowledgement: a server-authenticated confirmation token, the rules for editing published writing, and the public page release gates; accepted; its command boundary is merged (M2.1), and the confirmed save of M2.2 is built on its branch, where the studio refuses a change to a public page until the M2.3 dialogs: no publish control, no preview action, no public route, no public-reads switch). ADR 0002's implementation invariants (INV-1 to INV-5) are binding and each needs a test.

## 2. Before you change anything

1. Run `git status` and `git branch`, and read the files you are about to touch. Do not assume a file, script, command, dependency, or asset exists. Check first.
2. Read the documents relevant to the task and every accepted ADR in [`docs/decisions/`](docs/decisions/).
3. For visual work, read [Design System](docs/design-system.md), the tracked specification. If you have the author's local design references, also open the matching screen in `reference/refrain/pages/` or its capture in `reference/refrain/previews/`. They are not in the repository.
4. For anything beyond a trivial change, state the scope and the acceptance criteria before starting.
5. If the task conflicts with a documented decision, stop and raise it. Do not resolve it silently.

## 3. Architecture constraints

→ [Architecture](docs/architecture.md), [ADR 0001](docs/decisions/0001-modular-monolith.md)

- One Next.js and TypeScript application, one PostgreSQL database, organized as a modular monolith. No extra services, queues, or caches without an ADR.
- Modules: Catalog, Journals, Publication, Identity, Integrations, and Persistence. Import other modules only through their `index.ts`. Presentation code never imports the database client.
- Business rules belong in server-only modules, not in React components, server actions, or route handlers. Those stay thin.
- Prefer plain functions. Do not add repository layers, DI containers, or generic abstractions without a concrete second use.
- The planned stack (Tailwind CSS, Drizzle, Zod, Tiptap, Better Auth, next-intl, Rough.js, Vitest, Playwright, pnpm, Docker Compose, GitHub Actions) is a target. Check compatibility before installing, record the versions you chose, and replace a technology only through an ADR. Never write a version number you have not verified.
- External providers (MusicBrainz, Cover Art Archive, Wikimedia Commons) are optional. Their failure must never block catalog edits or writing. Never call them inside a database transaction.

## 4. Database integrity

→ [Data Model](docs/data-model.md)

- Declare integrity in PostgreSQL: PKs, FKs, `NOT NULL`, `UNIQUE`, and `CHECK` constraints. ORM relations and TypeScript types do not count.
- **Never cascade from catalog tables to authored content.** FKs from writing to the catalog are `ON DELETE RESTRICT`. Catalog records that writing references are archived, not deleted.
- Deleting an entry sets `deleted_at` and is recoverable. Writing is permanently deleted only by the author's explicit "Delete now". **Do not implement or enable automatic purge** until backups, a tested restore, and a tested purge exist.
- Wrap multi-row writes in one transaction, using the boundaries listed in the data model.
- Read every generated migration's SQL. Test migrations against a database with data in it. Never apply them automatically to production.
- The data model is preliminary. Resolve its open questions, and record the resolutions as ADRs, before or during the first migration.

## 5. Privacy and security

→ [Security](docs/security.md), [`SECURITY.md`](SECURITY.md)

- **Security never depends on the source code being secret.** The repository is intended to become public. Assume that an attacker has read all the code, the schema, the routes, the validation, and the history. Unlinked URLs, hidden UI, and client-side checks are not controls ([Security § Public code, private writing](docs/security.md#public-code-private-writing)).
- Report suspected vulnerabilities privately, as described in [`SECURITY.md`](SECURITY.md), never in a public issue or pull request. Never change the repository's visibility; only the owner does, after the [public-release gate](docs/security.md#public-release-gate).
- Every studio action and route checks authorization itself. Middleware alone is not enough.
- All public reads use the [publication predicate](docs/security.md#publication-predicate), implemented once in the Publication module. It covers metadata, sitemaps, and caches too. Visibility is per language version, and track reflections need their own explicit publication. "Still writing" never affects visibility.
- No public sign-up. Exactly one author.
- Never commit secrets, `.env` files, database dumps, or real journal writing.
- **Never fabricate personal data:** no invented memories, reflections, ratings, favourites, dates, or biographical claims about the author. Use synthetic fixtures labeled as tests (`[Test] …`). Bracketed placeholders in the mockups are not content.
- Do not deploy anything publicly before authentication and the privacy tests exist.

## 6. Design-system boundaries

→ [Design System](docs/design-system.md)

- Implement the approved V4.4 design. Do not redesign it, restyle it, or add components it does not show without the author's approval. The rendered screens outrank the exported CSS ([authority](docs/design-system.md#authority)). Studio controls required by ADR 0002 follow the [Writing Studio controls](docs/design-system.md#writing-studio-controls-for-adr-0002) specification. Administrative controls never appear on public pages.
- Monochrome interface: color comes only from artwork and photographs. Typefaces are Kalam and Alegreya Sans, nothing else.
- The original character illustration appears only on the public homepage, never as a header logo. Use the original file, `public/artwork/refrain-home-character.png`; never generate, trace, or alter it.
- The public header has no logo or wordmark. The language selector (`en`, `pt-BR` only) lives only in the footer.
- Rough.js strokes are pre-generated with fixed seeds, `aria-hidden`, and drawn behind real semantic elements.
- Accessibility is required: keyboard operation, visible focus, 44px targets, `prefers-reduced-motion`, and correct `lang` attributes.
- **`reference/` is a local-only workspace** for the author's design references: mockups, screenshots, explorations, and working files. Git ignores it, and anything in it is read-only. Do not edit, move, rename, recompress, or delete it. → [Design System § Assets](docs/design-system.md#assets)
  1. Files in `reference/` are not production assets.
  2. Application code, tests, CI, the README, and committed documentation never import, load, or link to files in `reference/`. The repository must build, test, and run without it.
  3. Committed documentation uses tracked assets only.
  4. An approved asset is promoted deliberately: copied byte-for-byte into `public/` when the application uses it, or into `docs/assets/` when only documentation uses it.
  5. Never copy an entire reference directory into the application.
  6. Never commit local mockups, screenshots, or design experiments without the author's explicit authorization.

## 7. Engineering conventions

- TypeScript strict mode. Validate input with Zod at every server boundary.
- Use pnpm with the committed lockfile, once one exists.
- Name things after the domain: `albumJournal`, `trackReflection`, `publish`. Avoid generic names such as `item` or `data`.
- Repository text is in English: docs, comments, commits, issues, PRs. Interface strings exist in English and Brazilian Portuguese.
- Keep changes focused. Do not reformat or refactor unrelated code in the same change.

## 8. Testing

→ [Development § Testing approach](docs/development.md#testing-approach)

- Unit-test domain rules. Integration-test persistence against **real PostgreSQL**; never mock the database to prove constraints, transactions, or SQL.
- Integration tests run only against the disposable test database (`TEST_DATABASE_URL`, `pnpm db:test:up`). Never weaken its safety checks, and never point tests, fixtures, or resets at a database whose contents matter. → [Development § Test database](docs/development.md#test-database)
- Every privacy rule has a test, as listed in [Security § Required tests](docs/security.md#required-tests).
- Use Playwright for critical flows at desktop width and at 390px.
- **Never report a check as passing unless you ran it and saw the output.** If you could not run it, say so.

## 9. Documentation

- Update the affected documents in the same change as the behavior.
- Distinguish implemented from planned functionality, and never describe planned work as done.
- Record significant decisions as ADRs ([format](docs/decisions/README.md)).
- Add commands to [Development](docs/development.md) only after they have run successfully.
- Every relative link must resolve.

## 10. Git and pull requests

→ [Development § Branches and commits](docs/development.md#branches-and-commits)

- Work on a focused branch (`<type>/<topic>`). Never commit directly to `main`.
- Use Conventional Commits.
- Open a PR describing its scope, decisions, verification, risks, and follow-ups.
- Merge only after the checks pass and, where available, an independent review. Never merge your own work automatically. Never bypass branch protection or force-push `main`.
- Destructive operations (deleting files or branches, rewriting history, dropping data, rewriting migrations) require explicit approval first.

## 11. Definition of Done

A change is done when:

1. its stated acceptance criteria are met;
2. the relevant checks were **run** and pass: format, lint, types, tests, build, once those exist;
3. privacy, data-integrity, and accessibility implications have been considered and, where applicable, tested;
4. the documentation and requirements evidence reflect the new state;
5. it is on a branch with a PR, and nothing unrelated is included.

## 12. Handoff

End every work session with a short handoff covering:

- **State:** branch, last commit, PR, and whether the working tree is clean.
- **Done:** files changed and why.
- **Verified:** the commands run and their actual results.
- **Not verified / risks:** what remains uncertain, and any assumptions made.
- **Next:** the next concrete step, and anything waiting on the author.

If work stops midway, commit or record enough that someone else can continue without the conversation history.
