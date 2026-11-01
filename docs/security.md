# Security and Privacy

**Status:** this document is mostly requirements for implementation. Only part of it is implemented, and [Implemented and planned protections](#implemented-and-planned-protections) says which parts.

- **M1.1 and M1.2 implement the database layer's protections.** They are tested against real PostgreSQL.
- **M1.3A implements authentication and the studio's authorization boundary** ([ADR 0004](decisions/0004-single-author-identity.md)). One author account, created by a local command; sign-in, database sessions, and sign-out; a sign-in page and a protected studio placeholder. They are tested against real PostgreSQL and over HTTP against the production build.
- **M1.3B adds the first server actions and studio pages that read and write private writing.** Each action authorizes first and is tested over HTTP with and without a session. The HTTP surface is the development page, the authentication endpoints, the studio pages, and the studio's Server Actions. There are no public journal routes, no publishing control, and no administrative route handler.
- **M1.3C adds restoring a deleted journal (an action that authorizes first, never publishes, and is covered by integration, concurrency, HTTP, and browser tests), a browser test suite, and a backup tool.** Browser tests run over plain `http://127.0.0.1`; behavior over real HTTPS is still unverified.
- **Passing tests do not make the application secure.** They show that the rules they test hold, and nothing about surfaces that do not exist yet.
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

An album journal's **rating** is publicly visible when at least one language version of the journal is publicly visible. It belongs to the journal, not to a language, and it is never visible otherwise. *Accepted in [ADR 0006](decisions/0006-publication-decision-and-acknowledgement.md#1-three-operations-and-one-definition-of-what-the-reader-will-see) (owner decision R3); no query exposes the rating today, and the rule takes effect when that query is built.*

The "still writing" flag plays no part in visibility (INV-2). A published reflection that is still in progress is shown with the "still writing" label; an unpublished one is not shown at all. The same applies to its rating and favourite mark.

Catalog metadata (albums, artists, tracks) is not personal, but public pages show it only in the context of publicly visible entries.

## Access control

- **Single author.** The author account is created by a local command, `pnpm author:provision`, never through a web form or at startup ([Development § Authentication](development.md#authentication)). It reads the password from the terminal without echo, or from standard input, and never from arguments or environment variables, which can leak through shell history and process listings. Public sign-up is disabled in the authentication configuration at all times, and tests assert that the sign-up endpoint is unavailable. The database admits at most one account (`auth_users_single_author_idx`).
- **Authorization at every entry point.** Every studio page, server action, and route handler verifies the session itself, through the Identity module ([Authorization contract](#authorization-contract)). Middleware or proxy redirects are a convenience, not the control.
- **Hiding something in the UI is not authorization.** Only the publication predicate decides public visibility.
- **Preview** renders inside the authenticated studio route and is never served from a cacheable public URL.
- **URLs.** Entries are addressed publicly by slug (ADR 0002, D7). A slug, current or previous, that resolves to an entry that is not publicly visible returns **404**, not 403 and not a redirect, so its existence is not revealed. Previous slugs of a visible entry redirect (308) to the current slug. A slug that once identified published writing stays reserved after the entry is permanently deleted, so it never leads to unrelated writing; it then returns the same 404 as an unknown slug ([ADR 0003](decisions/0003-relational-schema-conventions.md)).

## Authentication and sessions

Implemented in M1.3A with Better Auth 1.7.12. The reasons for each choice are in [ADR 0004](decisions/0004-single-author-identity.md).

- **Identity.** The single author is the account whose email is `REFRAIN_AUTHOR_EMAIL`. A valid session of any other account is not authorized (`not_author`). The database cannot hold a second account, and accounts can hold only a password credential, never a social login.
- **Sessions.** Database rows. The cookie `refrain.session_token` carries an HMAC-signed token. It is `HttpOnly`, `SameSite=Strict`, and `Path=/`. Over HTTPS it is also `Secure`, with the `__Secure-` prefix. There is no cookie cache: every check reads PostgreSQL, so deleting a session row ends it at once. A session lasts seven days from sign-in, and checking it never extends it. The raw token is never sent to scripts: the handler removes it from the JSON that sign-in and get-session return.
- **Sign-out** deletes the session row and expires the cookie. A replayed cookie grants nothing afterwards.
- **Sign-in endpoint.** The only authentication endpoints reachable over HTTP are `POST /api/auth/sign-in/email`, `POST /api/auth/sign-out`, and `GET /api/auth/get-session`. Everything else under `/api/auth/` returns a bare 404, including sign-up, password reset, user updates, and session listing.
- **Origins.** Every `POST` must carry `Origin` equal to `BETTER_AUTH_URL`, or it is refused with 403 before Better Auth runs. Better Auth's own origin and CSRF checks are also on, explicitly, in every environment.
- **Rate limiting.** Five sign-in attempts per 60 seconds, counted in PostgreSQL for **all clients together**: no client-IP header is trusted until a deployment has a known proxy, because a client can spoof `X-Forwarded-For`. Sign-out is never limited. This lets a stranger keep sign-in throttled. That is an accepted risk, and the alternative is unlimited guessing ([ADR 0004 § 6](decisions/0004-single-author-identity.md#6-rate-limiting)).
- **Passwords** are hashed by Better Auth (scrypt). The policy is 15 to 128 characters, and the password must not contain the email. Refrain never stores, logs, or prints a password.
- **Errors.** Wrong password and unknown email get the same 401. Malformed requests get generic error codes, never stack traces or SQL. Configuration failures answer 503 and deny every studio request.
- **Recovery.** `pnpm author:reset-password` replaces the password and signs out every session. It needs direct database access and is never reachable over HTTP. There is no email reset. Replacing `BETTER_AUTH_SECRET` invalidates every session cookie.

## Authorization contract

This contract applies to every administrative operation from M1.3B on: every studio page, server action, and route handler that reads private data or changes anything.

1. **Authenticate and authorize first.** The first statement is `const author = await requireAuthor(await headers())` (or `requireAuthor(request.headers)` in a route handler), from `@/modules/identity`. Pages may use `authorizeAuthor` and redirect to `/studio/sign-in`. A layout, a proxy, a hidden link, or the presence of a cookie is never the check. Server actions are public POST endpoints and check for themselves, like route handlers.
2. **Trust only the server's answer.** The identity is the `AuthorizedAuthor` returned by the Identity module. A user ID, email, role, or flag sent by the client is never trusted, and is never needed.
3. **Validate untrusted input** with Zod at the boundary: lengths, enums, rating range, locales, and slug format ([Input and output](#input-and-output)).
4. **Call a domain command**, never the database. Presentation code cannot import the database client (lint-enforced). Commands take a `DatabaseExecutor` and, for administrative mutations, the `AuthorizedAuthor`. No database helper is exposed to browser code.
5. **Preserve the transaction boundaries** in [Data Model § Transaction boundaries](data-model.md#transaction-boundaries) and the command-only invariants of ADR 0003.
6. **Return a deliberately small response.** Return only what the studio needs. A failure is a fixed code, never a database error, stack trace, or the input echoed back. Responses that contain private data are `no-store`.

Each new action or route gets a test that an unauthenticated request, a forged cookie, and a non-author session are refused (Required test 1).

A static test ([`studio-entry-points.test.ts`](../src/modules/identity/studio-entry-points.test.ts)) checks per file that each studio page calls the authorization, and per entry point that each exported function of a `"use server"` file, each inline (function-level) action, each `generateMetadata` in the studio, and each route handler under `src/app` starts with an awaited `requireAuthor` or `authorizeAuthor`. Anything it cannot read as a function literal (a re-export, a wrapped function) is reported, not skipped. The authentication handler is the one explicit exception. Probes show that each known bypass is caught. It is defense in depth: the HTTP tests call every action, and a mutation test (removing one action's check) was seen to fail them.

## Caching

- Studio pages and router payloads use `Cache-Control: no-store` and are never statically generated with data. Next.js also prerenders a static shell for each studio route (a loading line only), which a cache may keep when it answers a router prefetch; it holds no data and is identical whether or not a record exists, and tests assert both. The router's request without a session is a 307 that Next.js sends without a cache header (not cacheable by default), recorded with the redirect review in issue #11. Page titles are fixed and carry no catalog or writing.
- Public pages may be cached or statically generated only from data that satisfies the publication predicate.
- **Required for the first public release ([ADR 0006 § 11](decisions/0006-publication-decision-and-acknowledgement.md#11-public-reads-and-caches), accepted; not built, and subject to the M3.1 spike):** no shared cache at all. Journal pages, listings, metadata, the sitemap, and every `308` and `404` from slug resolution are rendered per request with `Cache-Control: no-store`, so unpublishing, deleting, restoring, and unflagging take effect on the next request and a cached redirect or `404` cannot outlive the state it described. Any later cache needs its own ADR with the invalidation and its tests. How a route sends a real `308`/`404` with `no-store` under Cache Components is an open question that an M3.1 spike must settle first: the studio's pattern answers 200 with a streamed redirect ([Deployment gate](#deployment-gate), item 2).
- If a cache of public pages is ever added (none is proposed for the first public release, see the next bullets), any change that affects the predicate revalidates the affected public pages and listings: a visibility change, deletion or restore, a change to a track's publication flag, featuring a journal, or a slug change.
- Verify that no private content is rendered at build time.

## Input and output

- Validate all input with Zod at the server boundary: lengths, enums, rating range, locale values, and slug format.
- Rich text is stored as Tiptap JSON and rendered through an allow-listed node and mark schema. Raw HTML from the editor is never rendered.
- Limit request body sizes. Rate-limit sign-in attempts. (Both done for the authentication endpoints: 4 KiB, five attempts a minute.)
- Use the CSRF and cookie protections of the authentication library and of Next.js server actions. Next.js accepts a Server Action call that has no `Origin` header, so every studio action also requires `Origin` equal to `BETTER_AUTH_URL` (`hasTrustedOrigin`, checked in `perform`; a call without it is `unauthorized`). A static test requires every exported action to call `perform` (it shows the call is there, not that the command runs through it; the HTTP suite is the proof of that), and the HTTP suite sends a missing and a trailing-slash `Origin` to all of them with a valid session. Session cookies are `HttpOnly`, `Secure` in production, and `SameSite=Lax` or stricter. (Implemented: `SameSite=Strict`, `Secure` over HTTPS.)
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
- **Backups.** Before real writing is stored in any hosted database, scheduled `pg_dump` backups must exist, stored outside the database host, and a restore into a scratch database must have been performed. The local procedure and tool are in [Development § Backup and restore](development.md#backup-and-restore). A backup holds the author's writing and the author's password hash: treat it like the writing itself.
- **Export.** A portable export, Markdown with front matter plus the original JSON (ADR 0002, D6), is part of long-term ownership.
- **Migrations** that touch authored tables are reviewed for data loss, include a recovery plan, and are never applied automatically to production.

## Logging

Logs record events and identifiers. They never contain entry titles or bodies, session tokens, passwords, or full request bodies. Error reports scrub the same fields. Everything the authentication library logs passes through a redacting logger that writes only the first line of each message up to its first colon (at most 160 characters), error names, HTTP statuses, and error codes ([`src/modules/identity/logging.ts`](../src/modules/identity/logging.ts)). Better Auth and Drizzle put values after a colon: a failed query's parameters, or values a client sent, such as an origin. This is a heuristic that depends on the library's message format; the messages reachable through the three allowed endpoints were checked, and a Better Auth upgrade re-checks them.

## Repository hygiene

- Never commit real journal writing, personal ratings, database dumps, `.env` files, or screenshots that contain private entries.
- Test fixtures and seed data are synthetic and labeled as such (for example `[Test] Album`). Public catalog metadata, such as Grace by Jeff Buckley, may be used, but the author's opinions about it may not be invented.
- The local `reference/` mockups contain only bracketed placeholders, not personal writing. `reference/` is ignored by Git. Local mockups, screenshots, and design experiments are never committed without the author's explicit authorization.

## Implemented and planned protections

This matrix records what exists on `main` today and what is still a requirement. *Implemented* means the control is in the code and verified as shown. *Planned* means it is a requirement in this document with no implementation yet. Carry-forward requirements for the coming milestones are tracked in issue #6.

### Implemented (M1.1, M1.2, M1.3A)

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
| Single author account, created only by the local command; never at startup or over HTTP; repeated provisioning refused; at most one account in the database ([ADR 0004](decisions/0004-single-author-identity.md)) | [`src/modules/identity/provisioning.ts`](../src/modules/identity/provisioning.ts), [`cli.ts`](../src/modules/identity/cli.ts), `auth_users_single_author_idx` | Integration tests of provisioning, refusal, and the constraint; HTTP tests that run the real command, including refusals of a second run, a wrong target, and a password argument; a unit test that only the command imports provisioning |
| No public sign-up: refused by route allow-list, `disabledPaths`, and `disableSignUp` | [`src/modules/identity/handler.ts`](../src/modules/identity/handler.ts), [`auth.ts`](../src/modules/identity/auth.ts) | Integration tests through the handler, through Better Auth directly, and by server call; an HTTP test against the production build |
| Database sessions with protected cookies; sign-out and reset end sessions; expired, revoked, forged, and non-author sessions refused | `src/modules/identity/` | Integration tests (sign-in, cookie attributes over HTTP and HTTPS, persistence across instances, expiry, revocation, sign-out, forged and tampered cookies, rotated secret, non-author session); HTTP tests of the studio with and without a valid session |
| Centralized, fail-closed studio authorization | [`src/modules/identity/authorization.ts`](../src/modules/identity/authorization.ts), [`src/app/studio/`](../src/app/studio/) | Integration tests of every outcome, including `unavailable` without configuration or when the database fails; HTTP tests that no studio content is sent without the author's session |
| Origin checks on every state-changing request; request body limit; `no-store` and anti-framing headers on authentication responses and studio pages | `handler.ts`, [`next.config.ts`](../next.config.ts) | Integration tests of cross-origin, missing, and opaque origins, and of Better Auth's own check under `NODE_ENV=test`; HTTP tests of the headers |
| Sign-in rate limiting that a spoofed `X-Forwarded-For` does not bypass | `auth.ts`, `auth_rate_limits` | Integration and HTTP tests with a different spoofed address on each attempt; sign-out stays available |
| Validated authentication configuration that fails closed; no secret in errors or logs | [`src/modules/identity/config.ts`](../src/modules/identity/config.ts), [`logging.ts`](../src/modules/identity/logging.ts) | Unit tests of every refusal; an integration test that a failing query logs no token, hash, or parameter; an HTTP test that the server log contains no password, token, or secret |
| Authorization first in every studio Server Action; commands that take an `AuthorizedAuthor` (a branded type that only Identity creates by convention; the commands do not inspect it, so it is a compile-time signal, not a check); one implementation of each mutation (no administrative route handlers) | [`src/app/studio/*/actions.ts`](../src/app/studio/), catalog and journals commands | `studio-actions.http.test.ts` calls all actions with no cookie, a forged cookie, a wrong signature, an expired and a revoked session, with a row checksum proving nothing was written; `studio-entry-points.test.ts`; a mutation check that removing one action's authorization fails the HTTP suite |
| Zod validation inside every catalog and journal command, with fixed field codes and no echo of the input; database errors mapped to fixed domain failures | [`src/modules/catalog/input.ts`](../src/modules/catalog/input.ts), [`journals/input.ts`](../src/modules/journals/input.ts), `perform.ts` | Integration tests of invalid input, duplicates, `in_use`, and missing records; HTTP tests that no response contains SQL, constraint names, or stack traces |
| Update contract: every update is a patch (a field left out is unchanged; clearing is explicit; a patch naming nothing is refused), so an unrelated edit cannot erase writing or catalog relationships | [`catalog/input.ts`](../src/modules/catalog/input.ts), [`journals/input.ts`](../src/modules/journals/input.ts), the update commands | Integration regression tests (omitted, cleared, updated, with unrelated data present; nine fail on the previous implementation) and the same cases over HTTP |
| Optimistic concurrency on album-journal saves; slug reservation safe under concurrency; tracklist and credit rewrites serialized by a row lock | `saveAlbumJournal`, `reserveInitialSlug`, `changeEntrySlug`, `lockAlbum` | Real multi-connection tests (issue #6): one winner, domain failures only, no partial entries or corrupted order; the lock was removed once to see the test fail |
| Nothing in the studio can publish, change an address, or delete permanently; privacy changes reach only `draft` or `private` | `setAlbumJournalPrivacy`, `no-publishing.test.ts` | Integration and HTTP tests that `published` is refused; a static test that `src/app` cannot reach those commands |
| Writing stored and shown as text: plain text becomes paragraphs and hard breaks only, React escapes it, no HTML is rendered; a stored document that the plain editor would not reproduce exactly on save (formatting, empty paragraphs, line feeds inside text, edge whitespace) is left untouched | [`src/modules/journals/body.ts`](../src/modules/journals/body.ts) | Unit tests of the conversion; an HTTP test that markup in a journal is escaped in the view and edit pages; the browser run |
| Studio pages stream private data only after authorization, with fixed titles and `noindex`; the static shells and prefetch payloads contain none of it | `src/app/studio/**/page.tsx` | HTTP tests of every page with no cookie, a forged cookie, and the router's RSC and prefetch requests |
| Supply chain: exact versions, a frozen lockfile, a seven-day minimum release age, and install scripts blocked unless allowed | `package.json`, [`pnpm-workspace.yaml`](../pnpm-workspace.yaml) | `pnpm install --frozen-lockfile` in CI proves that the lockfile matches `package.json`. Exact versions, the release age, and `allowBuilds` are checked by review. |

### Implemented (M2.1, on its branch until merged)

| Control | Where | Verified by |
| --- | --- | --- |
| Confirmation tokens: `ct1.` + base64url claims + HMAC-SHA-256 under a key derived by HKDF-SHA-256 from `BETTER_AUTH_SECRET` with the fixed purpose string `refrain/confirmation-token/ct1`; bound to the author's user and session, purpose, entry, language, `entries.version`, and the disclosure's fingerprint; valid 15 minutes by the database clock; MAC compared in constant time and checked before any claim is read; a missing or unsafe configuration fails closed as `unavailable`; no token, key, secret, or journal text is logged. **A token is evidence of a server-issued disclosure, never proof that the author acknowledged it** ([ADR 0006 § 3](decisions/0006-publication-decision-and-acknowledgement.md#3-the-confirmation-token)) | [`src/modules/identity/confirmation.ts`](../src/modules/identity/confirmation.ts) | Unit tests compare it byte for byte with an independent implementation of the specification ([`src/testing/confirmation.ts`](../src/testing/confirmation.ts)) and refuse every altered, truncated, misbound, wrong-key, wrong-purpose-string, raw-secret, and long-lived token; hand mutations of each claim check are caught |
| Publishing needs a token for the exact state: `previewPublication` (read-only, no lock) mints it; the checked `publishLanguageVersion` verifies it, locks the entry, refuses a deleted entry, a stale version, an empty version, and an entry with no address, recomputes the disclosure under the lock, and refuses a missing, expired, or stale token with the fresh disclosure and no token. Draft and Private take the same path; an empty disclosure needs its token too; the disclosure covers the version text, the address, the album rating, a memory's details, and every (reflection, language) pair that would become public, and is derived from the predicate fragments | [`publish.ts`](../src/modules/publication/publish.ts), [`disclosure.ts`](../src/modules/publication/disclosure.ts), [`predicate.ts`](../src/modules/publication/predicate.ts) | PostgreSQL tests: a 24-state parity matrix against the public queries; each disclosed atom changing separately; real-connection tests of the state stamp, a token from before a deletion, publication waiting behind a controlled entry lock, and eight simultaneous publications (one winner, no deadlock); a mid-write failure rolling back; 39 mutations of the engine and the fingerprint (listed in the pull request), all caught except one equivalent mutant (the no-address check, which `disclosureOf` repeats); the expiry is shown to be read after the entry lock |
| No unchecked way to publish in application code: the unchecked signature is removed; the write of `published` is exported by no file; static scans are tripwires, not proofs (syntax tree, by call target, with an explicit allowlist; they resolve renamed imports and aliased tables, plain SQL strings, upserts, and helpers any depth deep, but cannot see arbitrary dynamic code) over every writer of what the public sees, the export surface, and mint-and-consume. Out-of-process writers (a script, `psql`, a migration, a backup restore) are **not** covered until gates G3 and G4 close | [`src/testing/publication-scans.ts`](../src/testing/publication-scans.ts) | [`src/publication-boundary.test.ts`](../src/publication-boundary.test.ts): the real source is clean, every scan has probes for each form it must catch, and mutations of the real files are caught |
| Interim fail-closed: a published version cannot be saved (`published_text_locked`) until the confirmed save of M2.2 exists | `saveAlbumJournal` | Integration test: every form of save refused, nothing changes, saving works after unpublishing |

### Implemented (M1.3C)

| Control | Where | Verified by |
| --- | --- | --- |
| Restoring a journal never publishes: `published` versions return as `private`, drafts and private versions keep their status; text, publication history (`first_published_at`), slugs and their `was_published` marks, and `entries.version` are untouched; the predicate and INV-1 to INV-5 hold ([ADR 0005](decisions/0005-restoring-deleted-journals.md)) | `restoreDeletedEntry` ([`publication/commands.ts`](../src/modules/publication/commands.ts)), `restoreAlbumJournal` ([`journals/commands.ts`](../src/modules/journals/commands.ts)) | [`restore.integration.test.ts`](../src/modules/journals/restore.integration.test.ts) on real PostgreSQL (every combination of two versions' statuses, history, slugs and redirects, public queries before and after, refusal of a live, unknown, malformed, or other-kind entry, atomic rollback by a trigger that fails the second statement), real-connection races in `concurrency.integration.test.ts` (eight simultaneous restores: one wins; restore against save, publish, and "Delete now"); mutation checks (removing the deleted-entry check, the demotion, the kind check, or demoting only the original each fail tests) |
| The restore action authorizes first, requires the application's own `Origin`, and answers with fixed codes | `restoreJournalAction` ([`journals/actions.ts`](../src/app/studio/journals/actions.ts)), [`perform.ts`](../src/app/studio/perform.ts) | `studio-entry-points.test.ts`; `studio-actions.http.test.ts` (no cookie, forged, wrong signature, expired, revoked, no `Origin`, a trailing-slash `Origin`, a foreign `Origin`, against a journal that really is deleted so a restore that got through would change the database; malformed ids; a repeated restore; malformed bodies); a mutation that kept the authorization call but ignored its result passed the static test and failed the HTTP suite |
| The *Recently deleted* page and the restored notice show private writing only to the authorized author; the notice is chosen from a fixed word in the query string, never echoed; titles stay fixed | [`journals/deleted/page.tsx`](../src/app/studio/journals/deleted/page.tsx), [`journals/[id]/page.tsx`](../src/app/studio/journals/[id]/page.tsx) | HTTP tests (anonymous and forged requests receive none of it, `no-store`, `noindex`, hostile `restored` values are not reflected); browser tests |
| Browser tests use the disposable database only, a synthetic author, a fixed port that must be free, and isolated contexts; no credential is committed | [`playwright.config.ts`](../playwright.config.ts), [`e2e/`](../e2e/), [`production-server.ts`](../src/testing/production-server.ts) | The same five safety checks and the empty-identity check as the HTTP tests; the signed-in session file, reports, and traces are ignored by Git (`git check-ignore`); the review in the pull request |
| Backups: an explicit target that the environment itself names, no credential on any command line or in output, never overwritten, owner-only (0600) outside the repository, authentication sessions excluded; restore only into a new scratch database on the disposable test container | [`src/ops/backup.ts`](../src/ops/backup.ts) | [`backup.test.ts`](../src/ops/backup.test.ts) (every refusal); a rehearsal against the test container (see [Development § Backup and restore](development.md#backup-and-restore)). A backup of the owner's own database was not made, and a restore of it was not tested |

### Planned (not implemented)

| Control | Arrives with | State today |
| --- | --- | --- |
| Authorization in every administrative action and route, following the [Authorization contract](#authorization-contract) | Each later milestone | Done for every M1.3B action (above). Each action or route added later extends the HTTP test's table, which fails if an action is missing from it |
| Zod validation at every administrative server boundary | Each later milestone | Done for the M1.3B commands (above); the Tiptap node and mark schema arrives with Tiptap |
| Client-aware sign-in abuse protection from a trustworthy network identity | Before any public deployment ([Deployment gate](#deployment-gate), issue #11) | All clients share one bucket ([Authentication and sessions](#authentication-and-sessions)). Accepted for local development only. |
| Redirect status and indexing of the unauthorized studio response | Before any public deployment ([Deployment gate](#deployment-gate), issue #11) | HTTP 200 with a streamed redirect and a `noindex` meta tag; no studio content is sent |
| Behavior over real HTTPS | Before any public deployment (issue #11) | **Not verified.** M1.3C added browser tests of sign-in, sign-out, and studio access (desktop and 390 px), but over plain `http://127.0.0.1`. The HTTPS cookies (`Secure`, `__Secure-`) are covered by integration tests only. |
| A `script-src` Content-Security-Policy for the studio (only `frame-ancestors` is sent today); reserved words as slugs (an album titled "api" gets that slug) | Before any public deployment (issue #11); slug words when public routes exist (M3) | Writing is escaped by React and no raw-HTML path exists, so this is defense in depth |
| `changeEntrySlug` and `permanentlyDeleteEntry` take no `AuthorizedAuthor` | When a studio screen first binds one (M2.3 for the address, M2.4 for "Delete now") | Unreachable from `src/app` today (no database client, and `no-publishing.test.ts`). `previewPublication`, `publishLanguageVersion`, and `unpublishLanguageVersion` take it since M2.1. Take the `AuthorizedAuthor` when they are bound, as contract item 4 requires ([ADR 0006 § 10](decisions/0006-publication-decision-and-acknowledgement.md#10-authorization)) |
| Brazilian Portuguese strings for the sign-in page and the studio | With next-intl (issue #11) | English only. The interface has no locale routing yet. |
| Publishing or republishing a language version never exposes a track reflection that was flagged earlier without a matching acknowledgement of the exact set, per language, enforced at the Publication command boundary for every caller and checked atomically with the visibility change ([ADR 0005 § 5](decisions/0005-restoring-deleted-journals.md#5-required-condition-for-the-m2-publishing-interface)) | M2 (the publishing system) | **The command boundary is built (M2.1, above); the studio dialogs are not (M2.3).** A restore keeps each reflection's own flag, and a flagged reflection goes public with its parent version when that is published again, so publishing must disclose the set, let the author review it, and refuse a missing, outdated, or mismatched acknowledgement. Nothing in the studio can publish or set the flag today. **Design accepted in [ADR 0006](decisions/0006-publication-decision-and-acknowledgement.md) (not built):** a stateless, server-authenticated (MAC) confirmation token bound to the author's session, the version, the locale, and the disclosed set, valid for a bounded time and checked under the entry lock. It is evidence that the server issued a token for that disclosure to that session, not proof that the author saw or acknowledged it |
| No unchecked way to publish: the only writer of `status = 'published'` is the publish command that verifies the token, no application code mints and consumes a token in one operation, and static tests enforce both ([ADR 0006 § 9](decisions/0006-publication-decision-and-acknowledgement.md#9-there-is-no-unchecked-path)) | M2.1 | **Built for application code (see Implemented, M2.1).** Out-of-process writers stay unconstrained until gates G3 and G4 are closed. The scans cover the other writers of the public surface (deletion state, reflection flags and texts, the rating, memory details, slugs), but no command writes the reflections or the rating yet (M2.2) |
| Any edit of a public version's text (even a shorter one), and any addition to the public surface, needs the author's confirmation of the exact change; only true removals do not (owner decisions 3 to 5 and the review's clarification B; [ADR 0006 § 5](decisions/0006-publication-decision-and-acknowledgement.md#5-changes-after-publication)) | M2.2, M2.3 | Not built. No command writes a reflection or a rating. **Interim since M2.1:** `saveAlbumJournal` refuses a published version, so no path changes published text silently; the confirmed save replaces that refusal |
| The [public page release gates](#public-page-release-gates) G1 to G8 are closed with evidence before the first hosted public page | Before any hosted public exposure | Not started. Out-of-process writers of publication status are not inventoried, and the database-layer decision is not made |
| Public responses are `no-store` in the first public release, including `308` and `404` ([ADR 0006 § 11](decisions/0006-publication-decision-and-acknowledgement.md#11-public-reads-and-caches)) | M3 | Not built. No public route exists. An M3.1 spike must first prove real `308`/`404` statuses and `no-store` on the production build; the framework's and the host's behavior is then verified by an HTTP test and again at deployment |
| A second factor (passkey or TOTP) | Not decided | Password only ([ADR 0004](decisions/0004-single-author-identity.md)) |
| Allow-listed rich-text rendering | M2, M3 (Tiptap) | No editor or renderer exists; the database checks only the outer document shape |
| Public caching only from predicate data; revalidation on every visibility change; `no-store` studio responses | M2, M3 | Nothing is cached; Cache Components makes data dynamic by default. ADR 0006 (accepted; not built) goes further for the first public release: no shared cache at all, so no revalidation is needed |
| Predicate applied to metadata, sitemaps, feeds, and search | M3 | None of these exists; the only metadata is the static site title and description |
| HTTP-level privacy tests (404 versus 308, metadata, caches) | M2, M3 | Only the database-level parts exist ([Required tests](#required-tests)) |
| Optimistic concurrency on saves | M2 for other entry kinds and track reflections | Done for album-journal text (M1.3B) |
| Scheduled off-device backups of a hosted database, and a restore tested on the real data | Before any hosted database holds real writing | A local tool exists and a restore was rehearsed on synthetic data ([Development § Backup and restore](development.md#backup-and-restore)). Nothing is scheduled, and nothing protects against losing the device or the Docker volume until the owner copies backups elsewhere |
| Private vulnerability reporting channel | Before the repository becomes public | Not available while the repository is private ([`SECURITY.md`](../SECURITY.md)) |
| Branch protection | When the plan allows it, or when the repository becomes public | Followed by convention ([Development § Repository protection](development.md#repository-protection)) |
| Automated dependency advisory alerts | Not decided | Advisories are checked manually with `pnpm audit` |

## Required tests

These must exist before the public journal ships (M3). The *Done so far* column records what is already tested: the database-level parts against real PostgreSQL (M1.2), and the authentication parts in integration and over HTTP (M1.3A). The HTTP-level part of each privacy test needs its routes and arrives with them.

1. Unauthenticated requests to every studio action and route are rejected.
2. Draft, private, and deleted content returns 404 from every public route. This is checked per language version, including a published original with a private translation: the translation is not served, not linked, and not mentioned (INV-3).
3. Track reflections without `is_published` are absent from public pages, whatever their "still writing" state. Their ratings and favourite marks are absent too (INV-2, INV-3).
4. Visibility changes, deletions, and per-track publication changes take effect on public pages immediately, and revalidation is verified.
5. Previous slugs redirect only for publicly visible entries. Otherwise the response is identical to an unknown slug's 404 (INV-5).
6. Featured resolution returns the same journal for the same data in every interface language, and falls back as defined in ADR 0002, D1.2 (INV-1).
7. The sign-up endpoint is unavailable.
8. Hard-deleting a catalog record that writing references is refused by the database.

| Test | Done so far | Remaining |
| --- | --- | --- |
| 1. Unauthenticated studio requests rejected | The studio pages and the authentication endpoints (M1.3A), and every Server Action (M1.3B, and the restore in M1.3C) over HTTP with no cookie, a forged cookie, a wrong signature, an expired and a revoked session; in a browser, an expired, revoked, forged, and tampered session and a session that ends in the middle of a save (M1.3C) | Every action or route added later; the non-author case has no HTTP test because the database holds one account (it is tested in integration) |
| 2. Draft, private, deleted content hidden per language version (INV-3) | Public queries return nothing for draft, private, or deleted entries, and never a private translation | 404 from every public route, metadata, sitemaps, caches (M3) |
| 3. Unpublished track reflections absent, with their ratings and favourites (INV-2, INV-3) | Absent whatever their "still writing" state; toggling the flag changes nothing public; publishing a journal sets no reflection's flag (a reflection that was already flagged becomes visible with its parent version, so the M2 publishing system must disclose it and require a matching acknowledgement at the command boundary first: [ADR 0005 § 5](decisions/0005-restoring-deleted-journals.md#5-required-condition-for-the-m2-publishing-interface)) | Rendered public pages (M3) |
| 4. Changes take effect immediately, revalidation verified | Queries reflect a visibility change at once | Cache revalidation (M3) |
| 5. Previous slugs redirect only for visible entries (INV-5) | `resolvePublicSlug` returns the same `not_found` for unknown, draft, private, deleted, and permanently deleted (retired) entries' slugs, and for previous slugs that were never public; redirects stop when the destination is unpublished and resume when it is republished | HTTP 308 and 404 responses (M3) |
| 6. Featured resolution identical in every interface language, with the D1.2 fallbacks (INV-1) | All fallback cases, tie-break, and version choice, checked in both languages; at most one featured journal enforced by the database | Rendered album and artist pages (M3) |
| 7. Sign-up endpoint unavailable | Done (M1.3A): 404 through the handler, through Better Auth directly, and over HTTP against the production build; refused by server call | — |
| 8. Referenced catalog records cannot be hard-deleted | Done. Runtime refusals by each writing-side rule: `album_journals_album_fk`, `artist_journals_artist_fk`, `memory_music_track_fk`, `memory_music_album_fk`, `track_reflections_album_track_fk`. All writing-to-catalog delete rules are also read from `pg_constraint`. | — |

INV-4 (truthful recovery copy) has a database-level test that deleted entries are never purged: a long-deleted entry remains, and the database has no trigger or rule that could remove it. The codebase has no purge job. Its interface-copy part is checked since M1.3C: the HTTP tests assert that the Journals page, the *Recently deleted* page, and a deleted journal's page never say that writing is removed after 30 days, "gone in…", purged, or deleted automatically, and that no "Delete now" or permanent-delete control exists.

## Deployment gate

The application must not be reachable from the public internet until authentication and the tests above are in place. Until then, academic demonstrations run locally.

Authentication exists since M1.3A, but these conditions also hold before any public deployment. The [public page release gates](#public-page-release-gates) (accepted in ADR 0006) apply as well, and a gate that is not closed blocks deployment. Items 1, 2, 4, and 5 are tracked in issue #11. Item 3 was found in the M1.3B review and reviewed in M1.3C; it is not in the issue.

1. **Client-aware sign-in abuse protection.** Today all clients share one bucket of five sign-in attempts a minute, so anyone can keep sign-in throttled. That is accepted only for local development ([ADR 0004 § 6](decisions/0004-single-author-identity.md#6-rate-limiting)). Before deployment, abuse protection must recognize clients through a trustworthy network identity, and that must be tested. Examples are the connection's address, or a header set only by a proxy that the application can be reached through exclusively. A client-controlled forwarding header such as `X-Forwarded-For` never counts. The mechanism is chosen with the deployment target, and no provider is assumed.
2. **Redirect status and indexing reviewed.** Without the author's session, `/studio` answers **HTTP 200**: an empty static shell, then a streamed redirect to `/studio/sign-in` (Cache Components). It is not a 307. The private studio content is never sent, and the HTTP tests assert that. The shells of `/studio` and `/studio/sign-in` carry `<meta name="robots" content="noindex, nofollow">`, and no `X-Robots-Tag` header is sent. Before deployment, review the status code, crawler behavior, and whether a header-level `noindex` or a 307 is needed. A 307 would be a convenience, never the authorization control.
3. **Malformed action bodies.** Next.js decodes a Server Action's arguments before the action, and so before any session check. An unauthenticated POST whose body is not valid Flight data (for example `{"name":"$B1"}`, `[`, an empty body, or a NUL byte) answers HTTP 500 with only a numeric digest. M1.3C inspected the real responses and the server log (restore action, production build, test database):
   - **Framework-generated (HTTP 500, `text/x-component`, body `E{"digest":"…"}`):** a malformed body (the log names `Referenced Blob is not a Blob` or `SyntaxError: Unexpected end of JSON input`), and a foreign `Origin` (`Invalid Server Actions request`). An empty `Origin` header ends in `TypeError: Invalid URL`. An unknown action identifier answers 409 `Server Action unavailable.`
   - **Application-controlled (HTTP 200, body `{"ok":false,"code":"…"}`):** every request that decodes: no or invalid session (`unauthorized`), a missing `Origin` header, invalid or unknown ids, a repeated restore.
   - No response carries a stack trace, SQL, a path, or any writing; the log carries the framework's error text (and, for a foreign origin, the header value the client sent) and no writing. The server stays up, nothing is written (a row checksum in the HTTP tests), and the tests pin the 500.
   - It is framework behavior, and the framework's protections stay on. Making these answer 401 would mean decoding the body before the framework or bypassing its origin check, which is not done. Recorded for the deployment review (issue #11): a reverse proxy may reject these before they arrive, and log monitoring should expect the digests.
4. **Real HTTPS verified.** `Secure` and `__Secure-` session cookies, and the HTTPS-only `BETTER_AUTH_URL` rule, are covered by integration tests only. They have not been verified in a browser over real HTTPS.
5. **Browser end-to-end tests** of sign-in, sign-out, and studio access (Playwright), at desktop width and at 390px: **done in M1.3C** over plain HTTP (`pnpm test:e2e`, and in CI). They do not cover HTTPS (item 4) or a deployment's proxy.

## Public page release gates

*Accepted in [ADR 0006 § 14](decisions/0006-publication-decision-and-acknowledgement.md#14-public-page-release-gates). The gates are requirements now; none of their evidence exists and nothing here is built. Until the public-reads switch exists, blocking is procedural.*

These gates apply before the **first hosted public page**. "Hosted public exposure" means any deployment that anyone other than the author can reach from a network: a production site, a preview deployment, a tunnel, or an unlisted address. A local demonstration on the disposable database with synthetic data is not hosted exposure. They are in addition to the [Deployment gate](#deployment-gate) above, which still applies.

**A gate is closed only by recorded evidence that the owner has reviewed. An unresolved gate blocks deployment; it is not a warning.** The implementer cannot waive a gate. The owner may accept a specific, verified, documented residual risk in writing, but never an unverified privacy guarantee: G1, G2, the inventory of G3, the predicate and privacy-matrix tests of G5, G8, and the explicit acknowledgement cannot be waived ([ADR 0006 § 14, Waivers](decisions/0006-publication-decision-and-acknowledgement.md#waivers)).

| Gate | Condition |
| --- | --- |
| **G1. Status and redirect semantics** | Identical `404` for unknown, draft, private, deleted, unpublished-translation, and retired addresses; `308` only for a previous address of a publicly visible entry; no streamed `200` standing in for either; proven on the production build and on the hosted configuration |
| **G2. Cache behavior** | Through the real public URL (including any CDN or proxy), the next request after unpublishing, deleting, restoring, unflagging, clearing the rating, changing the address, or editing public text shows the new state; `Cache-Control: no-store` on every response class; no cache-hit indicator; no journal data in the build output |
| **G3. Writers of what the public sees** | Every way the status, deletion, flags, texts, rating, or slugs can change outside the authorized command boundary is inventoried and bound or accepted: application code, scripts, migrations, fixtures, **restoring a backup**, which fails closed: never directly into a database serving public content, and public reads stay disabled until the restore is verified, the publication state is checked, sessions and tokens are invalid, caches are invalidated, and the gates are re-run; and manual database access |
| **G4. Database-layer enforcement** | The owner decides, from G3, whether a trigger, row-level security, least-privilege roles, or accepted risk with named controls is required; whatever is decided is implemented and tested before deployment. Not deciding does not close the gate |
| **G5. Predicate and configuration** | The privacy tests pass against the production build with the hosted database role; `BETTER_AUTH_SECRET` generated randomly with at least 256 bits (method recorded) and identical on every instance; HTTPS; the other Deployment gate conditions closed; nothing private or debug reachable; `robots` and the sitemap list only public addresses |
| **G6. Backups** | Scheduled off-device backups and a tested restore exist before a hosted database holds real writing ([Data protection](#data-protection)) |
| **G7. Independent review** | A read-only security review of the public surface by someone who did not write it; every Medium or higher finding closed, or accepted in writing only as a verified, bounded residual risk (a finding that private, unpublished, or deleted content can be served or cached is a G1 or G2 failure and cannot be accepted) |
| **G8. Catalog wording (C11)** | Catalog edits (names, titles, credits, tracklist order) change the wording of a public page without a confirmation. Before the first hosted public page, the gap is resolved, or an independently verified safe alternative is recorded with its evidence |

ADR 0006 requires, as an M3.1 deliverable with its own tests, a server-only, default-disabled switch, `REFRAIN_PUBLIC_READS_ENABLED`: unless it is exactly `true`, every public content-serving surface (routes, metadata, sitemap, feeds, associated endpoints) answers the unknown-address `404`. It is defense in depth and never replaces the publication predicate, and restoring a backup keeps it disabled. It is not built; until it exists, blocking is procedural.

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

**Known history finding (M1.3A).** `gitleaks` reports one `generic-api-key` hit in commit `63889a5`, at `src/modules/identity/config.test.ts:5`. Its fingerprint is `63889a5181b6570cecf3952f79194007d71ab3cc:src/modules/identity/config.test.ts:generic-api-key:5`.

- **What it is.** It was audited before the merge of #10 and is synthetic test data: a base64 placeholder phrase that was only ever an input to the configuration validator's unit test.
- **Where it was never used.** No environment, server, database, CI run, or deployment ever used it.
- **Removed.** Commit `1326517` replaced it with a value generated at runtime. The tree contains no secret-like literal.
- **Merge.** By the owner's one-time exception, #10 is to be squash-merged, so that the commit never enters `main`'s ancestry.
- **What squashing does not do.** It does not delete the commit. The commit stays reachable from the pull request's references (`refs/pull/10/head`, `refs/pull/10/merge`), from the branch until someone deletes it, and from existing clones. GitHub may also keep it internally. The repository allows merge commits, rebase merges, and squash merges, so squash has to be chosen explicitly for #10.
- **At the gate.** The full-history scan will still report it. Record it as reviewed, for example with that fingerprint in a `.gitleaksignore`, rather than rewriting history: history is rewritten only for real secrets ([Secrets](#secrets)).

## Security reviews

Changes that touch a trust boundary get a security review before they are merged. Trust boundaries include routes, server actions, authentication, the publication predicate and public queries, caching, metadata, slugs and redirects, secrets, dependencies, and CI. Two procedures are written down as Claude Code skills, and human reviewers can follow them as checklists too:

- [`refrain-security-review`](../.claude/skills/refrain-security-review/SKILL.md): a read-only review.
- [`refrain-db-change`](../.claude/skills/refrain-db-change/SKILL.md): schema and migration changes.

These procedures apply this document and the accepted ADRs, and do not replace them. A passing test suite is evidence, not approval.
