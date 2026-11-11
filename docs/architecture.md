# Architecture

**Status:** the modular monolith is an accepted decision ([ADR 0001](decisions/0001-modular-monolith.md)). The module responsibilities below reflect the accepted domain decisions in [ADR 0002](decisions/0002-domain-model-decisions.md). The application foundation (M1.1) is implemented: the Next.js application, the Persistence module's database client, and lint-enforced module boundaries. M1.2 adds the relational schema, the read queries of the Catalog, Journals, and Publication modules, and the first transactional commands: publishing and unpublishing a language version and changing a slug (Publication), and "Delete now" (Journals). No route or screen calls them yet. M1.3A adds the Identity and Access module ([ADR 0004](decisions/0004-single-author-identity.md)): Better Auth on the same database, the single author account and its local provisioning command, sessions, and the authorization boundary used by the studio, with a sign-in page and a protected studio entry point. M1.3B adds the first features on top of them ([Roadmap](roadmap.md)): the Catalog and Journals modules gain their commands and Writing Studio queries, and the Writing Studio screens call them through Server Actions that each authorize the request first. Integrations has existed since M3.2 and M3.3, and the public pages since M3.1 ([Roadmap](roadmap.md)). Installed technologies and their versions are recorded in [Development § Toolchain](development.md#toolchain); the others remain planned.

## Shape

Refrain is a **modular monolith**: one deployable Next.js application, one PostgreSQL database, and internal modules with explicit boundaries.

```text
  Public journal (read-only)            Writing Studio (authenticated)
             │                                       │
             └──────────── Next.js App Router ───────┘
                   Server Components · Server Actions · Route Handlers
                                    │
         ┌─────────────┬────────────┼──────────────┬────────────────┐
         │             │            │              │                │
   Music Catalog   Journals &   Publication &   Identity &     Integrations
                   Reflections  Visibility      Access         (MusicBrainz,
         │             │            │              │            Cover Art Archive,
         └─────────────┴─────┬──────┴──────────────┘            Wikimedia Commons)
                             │
                   Persistence (Drizzle ORM)
                             │
                        PostgreSQL
```

## Target technologies

| Concern | Choice (installed in M1.1 where marked) |
| --- | --- |
| Application framework | Next.js (App Router), React (installed) |
| Language | TypeScript, strict mode (installed) |
| Styling | Tailwind CSS (installed) |
| Hand-drawn strokes | Rough.js, pre-generated as inline SVG |
| Rich-text editing | Tiptap |
| Validation | Zod (installed) |
| Database / ORM and migrations | PostgreSQL 17 and 18 (both tested; [Development § Test database](development.md#test-database)) / Drizzle ORM and Drizzle Kit, with the `pg` driver (installed) |
| Authentication | Better Auth (installed; [ADR 0004](decisions/0004-single-author-identity.md)) |
| Interface localization | Own typed dictionaries (`en`, `pt-BR`), with no library ([ADR 0008](decisions/0008-interface-localization.md)). Built for the public pages (`src/i18n/`, PR 2B) and the Studio (`src/i18n/studio/`, PR 3) |
| Unit and integration tests | Vitest (installed) |
| End-to-end tests | Playwright |
| Package manager | pnpm (installed) |
| Local services | Docker Compose, PostgreSQL only (installed) |
| CI | GitHub Actions (installed) |

Before a technology is adopted, its compatibility with the chosen Next.js and React versions is checked. A planned choice that does not fit is replaced through an ADR, not silently swapped.

## Modules and boundaries

| Module | Responsibility | Owns | Must not |
| --- | --- | --- | --- |
| **Public journal** (presentation) | Home, listings, album, artist, and memory pages; footer language selector ([ADR 0008](decisions/0008-interface-localization.md)) | Public routes and components | Query tables directly; receive anything but public projections |
| **Writing Studio** (presentation) | Desk, editors, Catalog, Add music, preview, Recently deleted | Studio routes and components | Run without an authenticated session; hold business rules |
| **Music Catalog** | Artists, albums (release groups), reference editions and track order, tracks, credits, artwork and photo provenance; archiving and hard-delete rules | Catalog tables | Delete or modify authored content |
| **Journals and Reflections** | Album journals, track reflections, ratings and favourites, artist journals, memories, author translations, revisions, saving with conflict detection, deletion and restore | Authored tables, except visibility columns | Change visibility; call external providers |
| **Publication and Visibility** | Per-language visibility transitions, per-track publication, featured journals, slugs and redirects, the [publication predicate](security.md#publication-predicate), public projections, preview | Visibility columns, `entry_slugs` | Be bypassed by any public read |
| **Identity and Access** | The single author account, sessions, the authentication endpoints, and the authorization check used by every studio operation (`authorizeAuthor`, `requireAuthor`) | Authentication tables (`auth_*`), the local author command | Offer public sign-up or more than one author; be reachable for provisioning over HTTP |
| **Persistence** | Drizzle schema, migrations, database client, transaction helper | Schema and migration files | Contain business rules |
| **Integrations** | MusicBrainz search and lookup, Cover Art Archive covers, Wikimedia Commons photos | Provider adapters, rate limiting, response mapping | Write to the database directly; block catalog or writing when unavailable |

### Dependency rules

1. Presentation calls module functions. It never imports the database client or schema.
2. Modules depend on each other only through a module's public entry point (`index.ts`), never through its internal files.
3. Journals may read catalog data through the Catalog module's public functions. The catalog does not depend on Journals; the catalog usage counts it shows are computed with SQL against the schema, not by calling Journals.
4. Every studio page, server action, and route handler checks authorization on its first line, through Identity and Access (`requireAuthor` or `authorizeAuthor`). Route-level middleware, a proxy, or a layout alone is not sufficient. The full rules are the [Authorization contract](security.md#authorization-contract).
5. Public pages read only through Publication's **reading entry point**, `@/modules/publication/public` (a second entry point beside `index.ts`, and the only other file a module may import). It exports reads bound to the database and the public-reads switch, and no command or token. These reads apply the publication predicate in SQL and return shaped projections with no private fields. The studio never imports it, and a scan holds both rules ([`public-surface.test.ts`](../src/app/public-surface.test.ts)).
6. Integrations return plain data. The calling module decides what to persist, inside its own transaction, after the external call completes.
7. Server-only modules import `server-only`, so they cannot be bundled into client code.

### Source layout

The layout below is the target. Today `src/app/` (the public pages behind the public-reads switch, the authentication route `api/auth/[...all]`, and `studio/` with its sign-in page, its desk, and its artists, albums, tracks, journals, and memories screens and server actions, the Studio without locale routing yet), `src/i18n/`, `src/db/`, `src/modules/catalog/`, `src/modules/journals/`, `src/modules/publication/`, `src/modules/identity/`, `src/integrations/musicbrainz/`, `src/integrations/cover-art-archive/`, and `src/integrations/wikimedia-commons/` (with their shared `src/integrations/provider.ts`), and `src/testing/` exist. `(en)`, `pt` (public routes only; its Studio is not built), and `i18n/` below exist ([ADR 0008](decisions/0008-interface-localization.md)). The other directories are created by the first feature that needs them, never as empty placeholders.

```text
src/
  app/
    global-not-found.tsx   the shared, bilingual not-found view (ADR 0008 § 8)
    (en)/                  root layout <html lang="en">, not-found.tsx, thin routes at today's addresses
    pt/                    root layout <html lang="pt-BR">, not-found.tsx, thin routes at /pt
    (public)/ (archives)/ (artists)/ (memories)/ studio/
                           the shared implementations of those routes
    api/                   route handlers, where needed
  modules/
    catalog/               index.ts, queries, commands, rules, tests
    journals/
    publication/
    identity/
  integrations/
    musicbrainz/
    cover-art-archive/
    wikimedia-commons/
  db/                      schema, migrations, client
  testing/                 integration-test support: safety checks, fixtures (tests only)
  i18n/                    locales, addresses, formats, dictionaries (en, pt-BR)
  ui/                      shared components, hand-drawn SVG primitives
```

Inside a module, prefer plain functions over repository classes and dependency-injection containers. Introduce an abstraction only when a second real implementation or a test needs it.

### Enforcement

`eslint.config.mjs` turns dependency rules 1 and 2 into lint errors, and [`src/module-boundaries.test.ts`](../src/module-boundaries.test.ts) proves that the rules fire:

- No file may import another module's internals (`@/db/*`, `@/modules/*/*`, `@/integrations/*/*`). Imports go through `index.ts`.
- Presentation code (`src/app/`) may not import `pg`, `drizzle-orm`, or the database client. From the Persistence module it may import only `checkDatabaseConnection`, which the development page uses.
- Relative imports may not leave the current directory (`../`). Everything else uses the `@/` alias, so a relative path cannot bypass the rules above.
- Account provisioning and the Better Auth instance are internal to Identity: its `index.ts` exports only the authorization functions and the request handler, so presentation code cannot create an account or call the library directly. A unit test checks that only the local command imports provisioning.

These are static import rules. Dynamic `import()` expressions are not checked, so reviews must catch those.

Rule 7 is enforced at build time. A Client Component that reaches a module importing `server-only` fails `next build`; this was checked when the foundation was built.

## Persistence

- **Driver:** node-postgres (`pg`), through `drizzle-orm/node-postgres`. It is the most widely deployed PostgreSQL driver for Node.js, Drizzle and the planned authentication library both support it, and its `Pool` gives explicit control over connections and transactions. The alternative, `postgres` (postgres.js), had just released a new major version when the foundation was built.
- **Client:** [`src/db/client.ts`](../src/db/client.ts) imports `server-only` and creates one connection pool on first use. Importing it never opens a connection, so `next build` needs no database. Configuration comes from `DATABASE_URL`, which is validated by [`src/db/env.ts`](../src/db/env.ts). Its error messages never echo the value.
- **Public entry point:** [`src/db/index.ts`](../src/db/index.ts) exports `getDb`, `closeDb`, `checkDatabaseConnection`, the schema (as `schema`), and the `Database`, `Transaction`, and `DatabaseExecutor` types.
- **Transactions:** Drizzle's `db.transaction` is the transaction helper; a nested call opens a savepoint. Module query and command functions take a `DatabaseExecutor` (the database or a transaction) as their first argument, so callers and tests choose the transaction. A command that writes several rows opens its own transaction, which becomes a savepoint when it is given one; a command that is one statement is atomic by itself and has no savepoint, so inside a caller's transaction a refusal aborts that transaction. A command validates its own input with Zod and, for an administrative mutation, takes the `AuthorizedAuthor` that Identity creates, so that presentation code has to hold one to call it (a type-level convention: the type is a brand, not a check, and the command does not inspect it); the command itself holds no other authorization logic, and the server action checks the session first. Presentation code has no database client, so a module's `index.ts` exports its Writing Studio commands and queries *bound* to the application's database (`withDatabase` in [`src/db/bind.ts`](../src/db/bind.ts)); the executor-taking forms stay inside the module, where tests run them in a rolled-back transaction. There is no repository layer.
- **Logging:** connection failures log only an error code (a PostgreSQL SQLSTATE or a Node.js network code) or a fixed configuration message, never the connection string, host, or credentials.
- **Schema and migrations:** [`src/db/schema.ts`](../src/db/schema.ts) and [`src/db/migrations/`](../src/db/migrations/), described in [Data Model](data-model.md). The workflow is in [Development § Database changes](development.md#database-changes).
- **Raw SQL:** queries whose exact SQL matters (the publication predicate, the academic queries) are written with Drizzle's `sql` template. The node-postgres driver returns `timestamptz` values from raw SQL as text, so those projections convert them to `Date`.
- **Tests:** integration tests use their own disposable database and never `DATABASE_URL` ([Development § Test database](development.md#test-database)).

## Writing Studio interface (M1.3B)

- **Screens.** `/studio` (the desk), `/studio/artists`, `/studio/albums`, `/studio/tracks`, and `/studio/journals`, each with `new` and `[id]` routes; a journal also has `[id]/edit`. Every page is a Server Component that starts with `authorizeAuthor` inside a `Suspense` boundary, so the static shell holds only a loading line and every figure and every word of writing is streamed after authorization.
- **Mutations are Server Actions only**, in `actions.ts` files next to each section. There are no administrative route handlers, so there is one implementation of each mutation. Each exported action starts with `await authorizeAuthor(await headers())`, then calls one domain command through `perform` ([`src/app/studio/perform.ts`](../src/app/studio/perform.ts)), which returns the deliberately small [`ActionResult`](../src/app/studio/results.ts): a fixed failure code, the names of invalid fields, and what blocks a deletion. **Publishing (M2.3, on its branch)** is two requests and the author's act: `previewPublicationAction` and `previewPublicChangeAction` (each alone in its own file) read and return a review with a confirmation token, and `publishJournalVersionAction` or `saveJournalAction` consume a token that the confirmation dialog sends from its confirm control; the Journals module's wrappers check the entry's kind and call the Publication engine. Nothing re-addresses or permanently deletes, and no file under `src/app` names a Publication command: [`no-publishing.test.ts`](../src/app/studio/no-publishing.test.ts) proves that, and also that each wrapper, the token, and each preview action stay in their own files. The studio asks Next.js to drop cached data in one place ([`revalidation.ts`](../src/app/studio/revalidation.ts)); nothing public is cached ([ADR 0006 § 11](decisions/0006-publication-decision-and-acknowledgement.md#11-public-reads-and-caches)).
- **Writing is plain text** in a textarea. The Journals module converts it to the accepted Tiptap document at the server boundary and back ([`body.ts`](../src/modules/journals/body.ts)); a stored document is editable only if the textarea would reproduce it exactly (`editableText`); any other is left untouched and shown as unavailable. Saves carry `entries.version`.
- **A journal's heading is its album.** The subject title comes from the catalog (ADR 0002); the opening sentence is the author's writing, shown as such. Lists show the album title and artists, then a one-line **preview** of the reflection (at most 160 characters, derived by SQL from the stored text and never stored), the status, and the started and edited dates, which tell several journals about one album apart. Previews exist only on authorized Studio pages: they are not in page titles or metadata, and no public surface reads them.
- **Deleting a journal moves it to Recently deleted, and restoring brings it back.** Deleting keeps its writing in PostgreSQL, takes it off the live lists, and makes it read-only. The private *Recently deleted* page (`/studio/journals/deleted`) lists those journals, and *Restore…* returns one with its text exactly as it was ([ADR 0005](decisions/0005-restoring-deleted-journals.md)): a version that was published returns as private, and nothing is ever published by a restore. The interface says that the writing is kept, that nothing removes it automatically, and that permanent deletion is not offered yet. It never says the writing is gone.
- **Failed saves never lose text.** The editor keeps what was typed through a conflict, an expired session, or a network error, and warns before leaving with unsaved changes.

## Rendering and caching

Next.js **Cache Components** is enabled (`cacheComponents: true` in `next.config.ts`; it is stable in Next.js 16 and the default for new applications). Data is dynamic unless it is explicitly cached with `use cache`, so database content is never prerendered by accident. The rules below still apply to anything that is cached.

- Public pages are Server Components. **Since M3.1 nothing public is cached**: the album-journal page is rendered per request (after `connection()`, behind Suspense, so the static shell holds no data), and every public response is `no-store` ([ADR 0006 § 11](decisions/0006-publication-decision-and-acknowledgement.md#11-public-reads-and-caches)). A cache would need its own ADR with the invalidation of every event in [Security § Caching](security.md#caching).
- **The status of a public address is decided in `src/proxy.ts`**, before any page renders, because a page under Cache Components answers `200` and streams a redirect or a not-found view. The proxy maps one decision, `routeAlbumJournalRequest` (Publication), to a real `404`, `308`, `405`, or `503`, all `no-store`; the page resolves the address again itself. The sitemap and `robots.txt` are route handlers with explicit headers, because the metadata-file convention sends a cacheable header. The server-only `REFRAIN_PUBLIC_READS_ENABLED` switch gates all of them ([evidence](evidence/m3-1.md#routing-and-http-spike)).
- Studio routes are dynamic and never cached. Pages and router payloads are `no-store`. Next.js also serves a prerendered static shell for each route (a loading line, no data), which it may let a cache keep when it answers a router prefetch; the shell is the same for a record that exists and one that does not, and the HTTP tests assert both. The router's own request without a session is answered with a 307, which Next.js sends without a cache header and which is not cacheable by default. Studio pages set fixed titles and `noindex, nofollow`; no studio metadata contains catalog or writing.
- Preview renders the public layout inside the authenticated studio route. It never uses a public, cacheable URL.

## Interface localization (approved, not implemented)

The public pages are built in both languages (PR 2B): thin routes under `src/app/(en)/` and `src/app/pt/`, each passing its language to a shared implementation, the dictionaries and formats in `src/i18n/`, the footer selector, the alternates, and the bilingual `src/app/global-not-found.tsx`. The Writing Studio is built in both languages too (PR 3): thin routes under `src/app/(en)/studio/` and `src/app/pt/studio/`, its own dictionaries in `src/i18n/studio/`, given to its client components by one provider in the Studio layout (`src/app/studio/studio-locale.tsx`), and revalidation of both trees by their route files. [ADR 0008](decisions/0008-interface-localization.md) is the accepted design for English at today's addresses and Brazilian Portuguese at `/pt`, for the public pages and the Studio:

- two root layouts with literal routes, so `<html lang>` is fixed per tree and no alias of a route can exist;
- own typed dictionaries, whose parity the type check enforces;
- the URL as the only language state: no cookie, no `Accept-Language`, and no language in a Server Action;
- the interface language, an entry's original language, and each authored version are three different things ([ADR 0008 § 1](decisions/0008-interface-localization.md#1-terms)), and the first never decides what is visible.

Every public `/pt` surface is bound to the publication rules by [ADR 0006 amendment A7](decisions/0006-publication-decision-and-acknowledgement.md#a7-the-pt-surfaces).

## External providers

| Provider | Use | Constraints |
| --- | --- | --- |
| MusicBrainz | Search albums (release groups) and artists, list a release group's editions, look up a release or an artist (M3.2) | Built: an identifying User-Agent, one request per 1.1 s for the process, 8 s per attempt and 20 s overall, at most two retries on `503` (its throttling answer), `429`, `502`, `504`, or a network error, honouring `Retry-After`, a bounded in-memory cache of validated responses, and Zod validation of every response. Failure shows "Couldn't reach MusicBrainz." and leaves the catalog usable. Track-only search is not built. |
| Cover Art Archive | Album covers (M3.2) | Built: the listing of a release or release group, read on the server through allow-listed HTTPS redirects; used only when the author chooses an image; stored as `https://coverartarchive.org/release/<release MBID>/<image id>` with the source "Cover Art Archive"; pages load the archive's thumbnails, built from those two parts, without a referrer. Images are copyrighted by their owners and the archive grants no general licence; approved for local development, and a hosted page shows covers only after the rights review of [Security § Deployment gate](security.md#deployment-gate), item 6 ([Evidence](evidence/m3-2.md#rights-and-attribution)). |
| Wikimedia Commons and Wikidata | Artist photographs (M3.3) | Built: the official Action API only, on the server, after authorization: a File-namespace search with the words the author types (reduced to plain terms), file lookups by name with `imageinfo` and extended metadata, and, for an artist linked to MusicBrainz, the one Wikidata item with that MusicBrainz ID, its image (P18), and the files that say they depict it (P180), offered as leads, never chosen automatically. An identifying User-Agent, requests in series one start per 500 ms, 8 s per attempt and 15 s overall, two retries honouring `Retry-After`, no redirects, 2 MB answers, a bounded in-memory cache, Zod validation per page. Offered only under an allow-listed license with a named creator (never the uploader); extended-metadata HTML is reduced to text and never rendered. Stored in the artist row with the file's SHA-1, upload time, and the approval time; pages load thumbnails from `thumb.wikimedia.org`, rebuilt from the file name, without a referrer, in the studio and, since M3.5, on the public artist page, which never calls the provider: it shows the stored photograph with its attribution, and its CSP allows that one host ([Evidence](evidence/m3-3.md), [M3.5](evidence/m3-5.md)). A hosted page shows photographs only after the review of [Security § Deployment gate](security.md#deployment-gate), item 7. |

Provider policies must be read and confirmed before implementation. These notes are not a substitute for reading them.

## Operations

- Logs are structured. They never include entry text, session tokens, or credentials.
- Migrations are versioned, reviewed, and applied deliberately, never automatically against production.
- Before irreplaceable writing goes into a hosted database, scheduled backups and a **tested** restore procedure must exist ([Security](security.md)).
- One private test deployment exists, behind the hosting provider's sign-in, with public reads off and synthetic data only ([Hosted Launch](hosted-launch.md)). No public release is authorized: it waits on the [public page release gates](security.md#public-page-release-gates) and the [Deployment gate](security.md#deployment-gate).

## Related

[Data Model](data-model.md) · [Security](security.md) · [Development](development.md) · [Decisions](decisions/)
