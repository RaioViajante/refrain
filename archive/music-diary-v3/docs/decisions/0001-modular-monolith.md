# ADR 0001: Modular Monolith

- **Status:** Accepted
- **Date:** 2026-10-31
- **Scope:** Overall application structure. Technology versions are pending compatibility checks during M1.

## Context

Refrain has one author, public read-only pages, a private writing studio, a relational content model with strong integrity needs, two interface languages, and optional external metadata providers. It must also satisfy a database-focused academic presentation on November 16, 2026, with a single developer.

The alternatives considered:

- **A separate frontend and backend API** (for example a single-page app plus a standalone API server). It makes the frontend/backend split explicit, but it doubles the deployment, authentication, and type-sharing work without a product benefit.
- **Microservices** (catalog, journals, auth as services). This brings distributed transactions across what is fundamentally one consistency boundary, which is the author's writing and the catalog it references.

## Decision

Build Refrain as **one Next.js and TypeScript application** with **one PostgreSQL database**, organized into internal modules with explicit boundaries:

- Music Catalog
- Journals and Reflections
- Publication and Visibility
- Identity and Access
- Integrations
- Persistence

The public journal and the Writing Studio are presentation layers over these modules. Drizzle ORM provides the schema, migrations, and explicit SQL. Business rules live in server-only modules, not in React components or route handlers. Module boundaries are enforced by convention, public entry points, and lint rules.

See [Architecture](../architecture.md) for responsibilities and dependency rules.

## Consequences

**Positive**

- One process and one database are easy to run locally, demonstrate, and back up.
- Multi-table writes, such as an album journal with its track reflections, are ordinary database transactions.
- Types are shared end to end without a separate API contract.

**Negative**

- Boundaries can erode silently. Mitigation: public module entry points, import lint rules, and review.
- Coupling to Next.js conventions such as server actions and caching. Mitigation: keep domain logic in plain TypeScript modules that can be tested without the framework.
- The academic "backend" is a server layer inside the application rather than a separate service. This must be confirmed with the instructor ([Requirements](../requirements.md#notes-on-interpretation)).

## Revisit when

A real independent API consumer appears, there is sustained background processing that does not fit the request lifecycle, or there are measured performance or operational needs that one application cannot meet.
