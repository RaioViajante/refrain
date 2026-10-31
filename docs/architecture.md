# Architecture

**Status:** the modular monolith is an accepted decision ([ADR 0001](decisions/0001-modular-monolith.md)). The module responsibilities below reflect the accepted domain decisions in [ADR 0002](decisions/0002-domain-model-decisions.md). The application foundation (M1.1) is implemented: the Next.js application, the Persistence module's database client, and lint-enforced module boundaries. M1.2 adds the relational schema and the first read queries of the Catalog, Journals, and Publication modules. No module writes data yet, and Identity and Integrations do not exist yet. Installed technologies and their versions are recorded in [Development § Toolchain](development.md#toolchain); the others remain planned.

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
| Validation | Zod |
| Database / ORM and migrations | PostgreSQL 17 / Drizzle ORM and Drizzle Kit, with the `pg` driver (installed) |
| Authentication | Better Auth |
| Interface localization | next-intl (`en`, `pt-BR`) |
| Unit and integration tests | Vitest (installed) |
| End-to-end tests | Playwright |
| Package manager | pnpm (installed) |
| Local services | Docker Compose, PostgreSQL only (installed) |
| CI | GitHub Actions (installed) |

Before a technology is adopted, its compatibility with the chosen Next.js and React versions is checked. A planned choice that does not fit is replaced through an ADR, not silently swapped.

## Modules and boundaries

| Module | Responsibility | Owns | Must not |
| --- | --- | --- | --- |
| **Public journal** (presentation) | Home, listings, album, artist, and memory pages; footer language selector | Public routes and components | Query tables directly; receive anything but public projections |
| **Writing Studio** (presentation) | Desk, editors, Catalog, Add music, preview, Recently deleted | Studio routes and components | Run without an authenticated session; hold business rules |
| **Music Catalog** | Artists, albums (release groups), reference editions and track order, tracks, credits, artwork and photo provenance; archiving and hard-delete rules | Catalog tables | Delete or modify authored content |
| **Journals and Reflections** | Album journals, track reflections, ratings and favourites, artist journals, memories, author translations, revisions, saving with conflict detection, deletion and restore | Authored tables, except visibility columns | Change visibility; call external providers |
| **Publication and Visibility** | Per-language visibility transitions, per-track publication, featured journals, slugs and redirects, the [publication predicate](security.md#publication-predicate), public projections, preview | Visibility columns, `entry_slugs` | Be bypassed by any public read |
| **Identity and Access** | The single author account, sessions, and the authorization check used by every studio operation | Authentication tables | Offer public sign-up or more than one author |
| **Persistence** | Drizzle schema, migrations, database client, transaction helper | Schema and migration files | Contain business rules |
| **Integrations** | MusicBrainz search and lookup, Cover Art Archive covers, Wikimedia Commons photos | Provider adapters, rate limiting, response mapping | Write to the database directly; block catalog or writing when unavailable |

### Dependency rules

1. Presentation calls module functions. It never imports the database client or schema.
2. Modules depend on each other only through a module's public entry point (`index.ts`), never through its internal files.
3. Journals may read catalog data through the Catalog module's public functions. The catalog does not depend on Journals; the catalog usage counts it shows are computed with SQL against the schema, not by calling Journals.
4. Every studio server action and route handler checks authorization on its first line, through Identity and Access. Route-level middleware alone is not sufficient.
5. Public pages read only through Publication's public query functions. These apply the publication predicate in SQL and return shaped projections with no private fields.
6. Integrations return plain data. The calling module decides what to persist, inside its own transaction, after the external call completes.
7. Server-only modules import `server-only`, so they cannot be bundled into client code.

### Source layout

The layout below is the target. Today `src/app/` (a single development page, without locale routing), `src/db/`, `src/modules/catalog/`, `src/modules/journals/`, `src/modules/publication/`, and `src/testing/` exist. The other directories are created by the first feature that needs them, never as empty placeholders.

```text
src/
  app/
    [locale]/(public)/     public journal routes
    [locale]/studio/       Writing Studio routes
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
  i18n/                    message catalogs (en, pt-BR)
  ui/                      shared components, hand-drawn SVG primitives
```

Inside a module, prefer plain functions over repository classes and dependency-injection containers. Introduce an abstraction only when a second real implementation or a test needs it.

### Enforcement

`eslint.config.mjs` turns dependency rules 1 and 2 into lint errors, and [`src/module-boundaries.test.ts`](../src/module-boundaries.test.ts) proves that the rules fire:

- No file may import another module's internals (`@/db/*`, `@/modules/*/*`, `@/integrations/*/*`). Imports go through `index.ts`.
- Presentation code (`src/app/`) may not import `pg`, `drizzle-orm`, or the database client. From the Persistence module it may import only `checkDatabaseConnection`, which the development page uses.
- Relative imports may not leave the current directory (`../`). Everything else uses the `@/` alias, so a relative path cannot bypass the rules above.

These are static import rules. Dynamic `import()` expressions are not checked, so reviews must catch those.

Rule 7 is enforced at build time. A Client Component that reaches a module importing `server-only` fails `next build`; this was checked when the foundation was built.

## Persistence

- **Driver:** node-postgres (`pg`), through `drizzle-orm/node-postgres`. It is the most widely deployed PostgreSQL driver for Node.js, Drizzle and the planned authentication library both support it, and its `Pool` gives explicit control over connections and transactions. The alternative, `postgres` (postgres.js), had just released a new major version when the foundation was built.
- **Client:** [`src/db/client.ts`](../src/db/client.ts) imports `server-only` and creates one connection pool on first use. Importing it never opens a connection, so `next build` needs no database. Configuration comes from `DATABASE_URL`, which is validated by [`src/db/env.ts`](../src/db/env.ts). Its error messages never echo the value.
- **Public entry point:** [`src/db/index.ts`](../src/db/index.ts) exports `getDb`, `closeDb`, `checkDatabaseConnection`, the schema (as `schema`), and the `Database`, `Transaction`, and `DatabaseExecutor` types.
- **Transactions:** Drizzle's `db.transaction` is the transaction helper; a nested call opens a savepoint. Module query functions take a `DatabaseExecutor` (the database or a transaction) as their first argument, so callers and tests choose the transaction. There is no repository layer.
- **Logging:** connection failures log only an error code (a PostgreSQL SQLSTATE or a Node.js network code) or a fixed configuration message, never the connection string, host, or credentials.
- **Schema and migrations:** [`src/db/schema.ts`](../src/db/schema.ts) and [`src/db/migrations/`](../src/db/migrations/), described in [Data Model](data-model.md). The workflow is in [Development § Database changes](development.md#database-changes).
- **Raw SQL:** queries whose exact SQL matters (the publication predicate, the academic queries) are written with Drizzle's `sql` template. The node-postgres driver returns `timestamptz` values from raw SQL as text, so those projections convert them to `Date`.
- **Tests:** integration tests use their own disposable database and never `DATABASE_URL` ([Development § Test database](development.md#test-database)).

## Rendering and caching

Next.js **Cache Components** is enabled (`cacheComponents: true` in `next.config.ts`; it is stable in Next.js 16 and the default for new applications). Data is dynamic unless it is explicitly cached with `use cache`, so database content is never prerendered by accident. The rules below still apply to anything that is cached.

- Public pages are Server Components. They may be cached only for publicly visible content. Any change that affects public visibility must revalidate the affected pages; the list of such changes is in [Security § Caching](security.md#caching).
- Studio routes are dynamic and never cached. Responses are `no-store`.
- Preview renders the public layout inside the authenticated studio route. It never uses a public, cacheable URL.

## External providers

| Provider | Use | Constraints |
| --- | --- | --- |
| MusicBrainz | Search and import albums, tracks, and artists | Respect the published rate limit and send an identifying User-Agent. Failure shows "Couldn't reach MusicBrainz." and leaves the catalog usable. |
| Cover Art Archive | Album covers | Used only when the author chooses one. Record the source. |
| Wikimedia Commons | Artist photographs | Freely licensed images only. Credit and license are required and stored. |

Provider policies must be read and confirmed before implementation. These notes are not a substitute for reading them.

## Operations

- Logs are structured. They never include entry text, session tokens, or credentials.
- Migrations are versioned, reviewed, and applied deliberately, never automatically against production.
- Before irreplaceable writing goes into a hosted database, scheduled backups and a **tested** restore procedure must exist ([Security](security.md)).
- The deployment target has not been decided. The application must not be publicly deployed before authentication is in place (M2).

## Related

[Data Model](data-model.md) · [Security](security.md) · [Development](development.md) · [Decisions](decisions/)
