# Security and Privacy

**Status:** this document is mostly requirements for implementation. Only part of it is implemented, and [Implemented and planned protections](#implemented-and-planned-protections) says which parts.

- **M1.1 and M1.2 implement the database layer's protections.** They are tested against real PostgreSQL.
- **Nothing that serves or accepts HTTP requests exists yet.** There are no public routes, no studio actions, no authentication, and no sessions.
- **Passing tests do not make the application secure.** They show that the database rules hold, and nothing about an HTTP surface that does not exist yet.
- **The remaining controls arrive with the features they protect.**

The publication rules implement [ADR 0002](decisions/0002-domain-model-decisions.md) and its implementation invariants (INV-1 to INV-5). How to report a vulnerability is in [`SECURITY.md`](../SECURITY.md).

Refrain's most valuable asset is the author's writing: personal, unpublished, and irreplaceable. The two failures that matter most are **private writing becoming public** and **writing being lost**. Every control below protects against one of them.

## Public code, private writing

The repository is private today and is intended to become public. **Security never depends on the source code being secret.** Assume that an attacker has read all of it:

- the code;
- the SQL schema and the migrations;
- the route structure and the validation rules;
- the Git history;
- the review procedures.

Access to the repository must never grant access to:

- personal memories or unpublished writing;
- unpublished translations or unpublished track reflections;
- administrator sessions;
- database credentials or authentication secrets;
- production configuration;
- private backups.

Protection comes from:

- **authorization**, verified on the server for every request;
- **sessions** that are handled securely;
- **isolation** of private data, behind the [publication predicate](#publication-predicate);
- **least privilege**;
- **tested behavior.**

Unguessable or unlinked URLs, hidden interface elements, client-side checks, and the secrecy of identifiers are not controls. Code, schema, and configuration in the repository hold no secrets. Real values exist only in the environment of the system that uses them.

## Trust model

| Actor | Trust | Access |
| --- | --- | --- |
| Author | Authenticated, single account | Full Writing Studio |
| Reader | Anonymous | Publicly visible content only, read-only |
| Anyone who can read the repository (everyone, once it is public) | Untrusted | Source code, schema, and history. No data, sessions, or secrets. |
| External providers | Untrusted input | Responses are validated before use |
| Coding agents and contributors | Repository access only | No access to production data or secrets |

## Publication predicate

This section is the **single authoritative definition** of what a reader may see. Every public read uses it: pages, listings, metadata (`<title>`, Open Graph), sitemaps, any future feeds or search, and cache population. It is implemented once, in the Publication module ([`src/modules/publication/predicate.ts`](../src/modules/publication/predicate.ts)), and is never re-implemented elsewhere. Other modules and presentation code read public data only through the Publication module's query functions.

A **language version** of an entry is publicly visible when:

- `entries.deleted_at IS NULL`, and
- that version's `entry_texts.status = 'published'`.

An **entry** is publicly visible when at least one of its language versions is publicly visible.

A **track reflection** is publicly visible in a language when:

- the parent journal's language version is publicly visible, and
- `track_reflections.is_published` is true (explicit per-track authorization, ADR 0002, D5), and
- a reflection text exists in that language.

A **link to an author's translation**, or any mention that one exists, appears only when that translation is itself publicly visible (ADR 0002, INV-3).

The "still writing" flag plays no part in visibility (INV-2). A published reflection that is still in progress is shown with the "still writing" label; an unpublished one is not shown at all. The same applies to its rating and favourite mark.

Catalog metadata (albums, artists, tracks) is not personal, but public pages show it only in the context of publicly visible entries.

## Access control

- **Single author.** The author account is created by a one-off setup command that reads credentials from the environment, not through a web form. Public sign-up is disabled in the authentication configuration, and a test asserts the sign-up endpoint is unavailable.
- **Authorization at every entry point.** Every studio server action and route handler verifies the session itself. Middleware or proxy redirects are a convenience, not the control.
- **Hiding something in the UI is not authorization.** Only the publication predicate decides public visibility.
- **Preview** renders inside the authenticated studio route and is never served from a cacheable public URL.
- **URLs.** Entries are addressed publicly by slug (ADR 0002, D7). A slug, current or previous, that resolves to an entry that is not publicly visible returns **404**, not 403 and not a redirect, so its existence is not revealed. Previous slugs of a visible entry redirect (308) to the current slug. A slug that once identified published writing stays reserved after the entry is permanently deleted, so it never leads to unrelated writing; it then returns the same 404 as an unknown slug ([ADR 0003](decisions/0003-relational-schema-conventions.md)).

## Caching

- Studio responses use `Cache-Control: no-store` and are never statically generated.
- Public pages may be cached or statically generated only from data that satisfies the publication predicate.
- Any change that affects the predicate revalidates the affected public pages and listings: a visibility change, deletion or restore, a change to a track's publication flag, featuring a journal, or a slug change.
- Verify that no private content is rendered at build time.

## Input and output

- Validate all input with Zod at the server boundary: lengths, enums, rating range, locale values, and slug format.
- Rich text is stored as Tiptap JSON and rendered through an allow-listed node and mark schema. Raw HTML from the editor is never rendered.
- Limit request body sizes. Rate-limit sign-in attempts.
- Use the CSRF and cookie protections of the authentication library and of Next.js server actions. Session cookies are `HttpOnly`, `Secure` in production, and `SameSite=Lax` or stricter.
- Image hosts are allow-listed: Cover Art Archive, Wikimedia Commons, and the application's own assets.

## Secrets

- Secrets live only in environment variables. `.env*` files are ignored by Git, except `.env.example`, which holds variable names with non-secret placeholder values for a local, disposable development database. Real or production credentials never appear in it.
- Secrets never reach client bundles. Only intentionally public variables use the framework's public prefix.
- CI uses scoped GitHub secrets and minimal workflow `permissions`.
- If a secret is committed, rotate it first and then remove it from history. Deleting the file is not enough.
- The Next.js build output (`.next/`) contains keys generated for each build, such as the preview and server-action encryption keys. It is ignored by Git and is never committed, published, or shared.

## Data protection

- **No cascade from catalog to writing.** Catalog records referenced by writing are archived, never deleted ([Data Model](data-model.md#deletion-and-recovery)).
- **Minimal retention after permanent deletion.** "Delete now" removes the entry and everything it owns. Only its published slugs remain, as reserved strings with no link to any writing; slugs that were never public are deleted ([ADR 0003](decisions/0003-relational-schema-conventions.md)).
- **Recoverable deletion.** Deleted entries stay in Recently deleted for at least 30 days. **Automatic permanent deletion stays disabled** until backups exist, a restore has been performed successfully, and the purge job is designed and covered by tests (ADR 0002, D4.4).
- **Optimistic concurrency** on saves, so a stale browser tab cannot silently overwrite newer writing.
- **Unsaved text survives a failed save** on the author's device, as the design requires, and never in a shared or server-side log.
- **Backups.** Before real writing is stored in any hosted database, scheduled `pg_dump` backups must exist, stored outside the database host, and a restore into a scratch database must have been performed. The procedure is recorded in [Development](development.md) once it exists.
- **Export.** A portable export, Markdown with front matter plus the original JSON (ADR 0002, D6), is part of long-term ownership.
- **Migrations** that touch authored tables are reviewed for data loss, include a recovery plan, and are never applied automatically to production.

## Logging

Logs record events and identifiers. They never contain entry titles or bodies, session tokens, passwords, or full request bodies. Error reports scrub the same fields.

## Repository hygiene

- Never commit real journal writing, personal ratings, database dumps, `.env` files, or screenshots that contain private entries.
- Test fixtures and seed data are synthetic and labeled as such (for example `[Test] Album`). Public catalog metadata, such as Grace by Jeff Buckley, may be used, but the author's opinions about it may not be invented.
- The local `reference/` mockups contain only bracketed placeholders, not personal writing. `reference/` is ignored by Git. Local mockups, screenshots, and design experiments are never committed without the author's explicit authorization.

## Implemented and planned protections

This matrix records what exists on `main` today and what is still a requirement. *Implemented* means the control is in the code and verified as shown. *Planned* means it is a requirement in this document with no implementation yet. Carry-forward requirements for the coming milestones are tracked in issue #6.

### Implemented (M1.1, M1.2)

| Control | Where | Verified by |
| --- | --- | --- |
| Integrity in PostgreSQL: keys, `NOT NULL`, `CHECK`, `UNIQUE`; authored-to-catalog foreign keys `ON DELETE RESTRICT` | [`src/db/schema.ts`](../src/db/schema.ts), [`src/db/migrations/`](../src/db/migrations/) | Integration tests that assert rejections by SQLSTATE and constraint name, with the exceptions listed in [Data Model § Validation](data-model.md#validation); delete rules read from `pg_constraint` |
| Publication predicate, defined once in SQL; public read queries return projections without private fields | [`src/modules/publication/predicate.ts`](../src/modules/publication/predicate.ts), [`queries.ts`](../src/modules/publication/queries.ts) | Database-level tests for INV-1, INV-2, INV-3, and INV-5 ([Required tests](#required-tests)) |
| Transactional publication, slug, and "Delete now" commands, which lock the entry and refuse deleted entries | [`src/modules/publication/commands.ts`](../src/modules/publication/commands.ts), [`src/modules/journals/commands.ts`](../src/modules/journals/commands.ts) | Integration tests, including rollback of failed multi-row writes |
| Published slugs reserved after permanent deletion; only marked slugs served ([ADR 0003](decisions/0003-relational-schema-conventions.md)) | Same | Integration tests of `resolvePublicSlug`, `changeEntrySlug`, and `permanentlyDeleteEntry` |
| No automatic purge (ADR 0002, D4.4; INV-4, database part) | No trigger, rule, or job exists | An integration test asserts that the database has no trigger or rule that removes entries |
| Test-database isolation: tests read only `TEST_DATABASE_URL`; five fail-closed checks, including the server-side disposable marker | [`src/testing/test-database.ts`](../src/testing/test-database.ts), [`global-setup.ts`](../src/testing/global-setup.ts) | Unit tests of each check; an integration test that the client under test reaches only the test database ([Development § Test database](development.md#test-database)) |
| Server-only database access: the client imports `server-only`, configuration stays server-side, and the build needs no database | [`src/db/client.ts`](../src/db/client.ts), [`src/db/env.ts`](../src/db/env.ts) | `next build` without `DATABASE_URL` in CI proves that the build needs no database. `next build` also fails if a Client Component reaches a `server-only` module, which was checked once when the foundation was built ([Architecture § Enforcement](architecture.md#enforcement)); no automated test covers it. |
| Connection details never appear in errors or logs | `src/db/env.ts`, `src/db/health.ts`, `src/db/client.ts` | Unit tests that the configuration and health-check errors exclude connection strings. The pool's idle-error log, which records only the error code, is checked by review and has no test. |
| Module boundaries: presentation code cannot import the database client, schema, or driver | [`eslint.config.mjs`](../eslint.config.mjs) | `pnpm lint`; [`src/module-boundaries.test.ts`](../src/module-boundaries.test.ts) proves that the rules fire. Static imports only. |
| Repository hygiene: `.env*` (except `.env.example`), `*.pem`, `*.dump`, `.next/`, and `reference/` are ignored | [`.gitignore`](../.gitignore) | `git check-ignore`; secret scanning ([Public-release gate](#public-release-gate)) |
| CI least privilege: `contents: read`, no secrets, actions pinned to commit SHAs, checkout without persisted credentials | [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) | Review of the workflow |
| Supply chain: exact versions, a frozen lockfile, a seven-day minimum release age, and install scripts blocked unless allowed | `package.json`, [`pnpm-workspace.yaml`](../pnpm-workspace.yaml) | `pnpm install --frozen-lockfile` in CI proves that the lockfile matches `package.json`. Exact versions, the release age, and `allowBuilds` are checked by review. |

### Planned (not implemented)

| Control | Arrives with | State today |
| --- | --- | --- |
| Single author account; no public sign-up; secure sessions and cookies; sign-in rate limiting | M2 (Better Auth) | No authentication library, account, or session exists |
| Server-side authorization in every studio action and route handler | M2 | No server action or route handler exists, so nothing can mutate data over HTTP |
| Zod validation at every server boundary; request size limits | The first route or action (M1.3, M2) | Zod is not installed; there is no server boundary yet |
| Allow-listed rich-text rendering | M2, M3 (Tiptap) | No editor or renderer exists; the database checks only the outer document shape |
| Public caching only from predicate data; revalidation on every visibility change; `no-store` studio responses | M2, M3 | Nothing is cached; Cache Components makes data dynamic by default |
| Predicate applied to metadata, sitemaps, feeds, and search | M3 | None of these exists; the only metadata is the static site title and description |
| HTTP-level privacy tests (404 versus 308, metadata, caches) | M2, M3 | Only the database-level parts exist ([Required tests](#required-tests)) |
| Optimistic concurrency on saves | M2 | `entries.version` exists; no save command uses it yet |
| Backups and a tested restore | Before any hosted database holds real writing | Local `pg_dump` commands only ([Development](development.md#local-database)) |
| Private vulnerability reporting channel | Before the repository becomes public | Not available while the repository is private ([`SECURITY.md`](../SECURITY.md)) |
| Branch protection | When the plan allows it, or when the repository becomes public | Followed by convention ([Development § Repository protection](development.md#repository-protection)) |
| Automated dependency advisory alerts | Not decided | Advisories are checked manually with `pnpm audit` |

## Required tests

These must exist before the public journal ships (M3). The *Database level (M1.2)* column records what is already tested against real PostgreSQL through the Publication queries and the schema; the HTTP-level part of each test needs the routes and arrives with them.

1. Unauthenticated requests to every studio action and route are rejected.
2. Draft, private, and deleted content returns 404 from every public route. This is checked per language version, including a published original with a private translation: the translation is not served, not linked, and not mentioned (INV-3).
3. Track reflections without `is_published` are absent from public pages, whatever their "still writing" state. Their ratings and favourite marks are absent too (INV-2, INV-3).
4. Visibility changes, deletions, and per-track publication changes take effect on public pages immediately, and revalidation is verified.
5. Previous slugs redirect only for publicly visible entries. Otherwise the response is identical to an unknown slug's 404 (INV-5).
6. Featured resolution returns the same journal for the same data in every interface language, and falls back as defined in ADR 0002, D1.2 (INV-1).
7. The sign-up endpoint is unavailable.
8. Hard-deleting a catalog record that writing references is refused by the database.

| Test | Database level (M1.2) | Remaining |
| --- | --- | --- |
| 1. Unauthenticated studio requests rejected | — | All of it (M2, with authentication) |
| 2. Draft, private, deleted content hidden per language version (INV-3) | Public queries return nothing for draft, private, or deleted entries, and never a private translation | 404 from every public route, metadata, sitemaps, caches (M3) |
| 3. Unpublished track reflections absent, with their ratings and favourites (INV-2, INV-3) | Absent whatever their "still writing" state; toggling the flag changes nothing public; publishing a journal publishes no reflection | Rendered public pages (M3) |
| 4. Changes take effect immediately, revalidation verified | Queries reflect a visibility change at once | Cache revalidation (M3) |
| 5. Previous slugs redirect only for visible entries (INV-5) | `resolvePublicSlug` returns the same `not_found` for unknown, draft, private, deleted, and permanently deleted (retired) entries' slugs, and for previous slugs that were never public; redirects stop when the destination is unpublished and resume when it is republished | HTTP 308 and 404 responses (M3) |
| 6. Featured resolution identical in every interface language, with the D1.2 fallbacks (INV-1) | All fallback cases, tie-break, and version choice, checked in both languages; at most one featured journal enforced by the database | Rendered album and artist pages (M3) |
| 7. Sign-up endpoint unavailable | — | All of it (M2) |
| 8. Referenced catalog records cannot be hard-deleted | Done. Runtime refusals by each writing-side rule: `album_journals_album_fk`, `artist_journals_artist_fk`, `memory_music_track_fk`, `memory_music_album_fk`, `track_reflections_album_track_fk`. All writing-to-catalog delete rules are also read from `pg_constraint`. | — |

INV-4 (truthful recovery copy) has a database-level test that deleted entries are never purged: a long-deleted entry remains, and the database has no trigger or rule that could remove it. The codebase has no purge job. Its interface-copy part is checked when the Recently deleted screens exist (M2).

## Deployment gate

The application must not be reachable from the public internet until authentication and the tests above are in place. Until then, academic demonstrations run locally.

## Public-release gate

Making the **repository** public is a separate decision from deploying the application, and only the repository owner makes it. Agents and contributors never change the repository's visibility. Before visibility changes, every item below must be checked and its result recorded in the issue or pull request that prepares the release:

1. **No committed credentials.** No real secret is present in any tracked file: tokens, passwords, keys, or connection strings. The placeholder values for disposable local and CI databases are not secrets.
2. **History reviewed for secrets.** The full Git history of every branch is scanned, for example with `gitleaks git --redact --log-opts="--all"`, and every finding is resolved. If a real secret is found, it is rotated first, and only then removed from history (see [Secrets](#secrets)).
3. **No private journal data.** No real writing, ratings, personal dates, database dumps, or screenshots of private entries in the working tree or the history.
4. **Authorization verified.** Every studio action and route handler is covered by the unauthenticated-request test (Required test 1).
5. **Authentication and sessions tested.** Sign-in, sign-out, session expiry, cookie flags, and the unavailable sign-up endpoint (Required test 7).
6. **Production secrets isolated.** Production credentials exist only in the deployment environment. None is shared with development, CI, or the repository.
7. **Public metadata and caching reviewed.** Metadata, sitemaps, feeds, search, and cached pages apply the publication predicate (Required tests 2 to 5).
8. **Dependency advisories evaluated.** `pnpm audit` is run and each advisory is either fixed or recorded as not applicable, with the reason.
9. **A working private reporting channel.** GitHub private vulnerability reporting is enabled once the repository is public, and [`SECURITY.md`](../SECURITY.md) describes how to use it.
10. **Licenses decided.** Licenses for the source code and for the original artwork are chosen separately and recorded. The artwork includes the homepage character illustration. No license is added without the owner's decision.
11. **Independent review.** A security review of the whole repository by someone who did not write the code. A review agent run in a separate context counts.

The design references that were tracked before M1.1 (`reference/`, removed from tracking in #3) remain in the Git history **by the owner's decision**. They contain bracketed placeholders, not personal writing, so rewriting history to remove them is not required. Rewriting history is reserved for actual secrets or personal data.

## Security reviews

Changes that touch a trust boundary get a security review before they are merged. Trust boundaries include routes, server actions, authentication, the publication predicate and public queries, caching, metadata, slugs and redirects, secrets, dependencies, and CI. Two procedures are written down as Claude Code skills, and human reviewers can follow them as checklists too:

- [`refrain-security-review`](../.claude/skills/refrain-security-review/SKILL.md): a read-only review.
- [`refrain-db-change`](../.claude/skills/refrain-db-change/SKILL.md): schema and migration changes.

These procedures apply this document and the accepted ADRs, and do not replace them. A passing test suite is evidence, not approval.
