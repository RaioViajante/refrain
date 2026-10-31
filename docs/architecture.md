# Architecture

**Status:** the modular monolith is an accepted decision ([ADR 0001](decisions/0001-modular-monolith.md)). The module responsibilities below also reflect the domain decisions in [ADR 0002](decisions/0002-domain-model-decisions.md), which is Proposed. No code exists yet. The technologies below are the target stack. None has been installed, and exact versions are chosen and recorded only after compatibility has been checked during scaffolding.

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

| Concern | Planned choice |
| --- | --- |
| Application framework | Next.js (App Router), React |
| Language | TypeScript (strict) |
| Styling | Tailwind CSS |
| Hand-drawn strokes | Rough.js, pre-generated as inline SVG |
| Rich-text editing | Tiptap |
| Validation | Zod |
| Database / ORM and migrations | PostgreSQL / Drizzle ORM and Drizzle Kit |
| Authentication | Better Auth |
| Interface localization | next-intl (`en`, `pt-BR`) |
| Unit and integration tests | Vitest |
| End-to-end tests | Playwright |
| Package manager | pnpm |
| Local services | Docker Compose (PostgreSQL) |
| CI | GitHub Actions |

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

### Proposed source layout

The layout is fixed when the application is scaffolded in M1. It is shown here so that boundaries have a concrete shape.

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
  db/                      schema, migrations, client, transaction helper
  i18n/                    message catalogs (en, pt-BR)
  ui/                      shared components, hand-drawn SVG primitives
```

Inside a module, prefer plain functions over repository classes and dependency-injection containers. Introduce an abstraction only when a second real implementation or a test needs it.

## Rendering and caching

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
