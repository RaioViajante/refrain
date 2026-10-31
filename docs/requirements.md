# Requirements

**Presentation:** November 16, 2026.
**Status:** planned. No requirement is verified yet. M1.2 implemented the related tables (with primary and foreign keys) and the JOIN and aggregate queries, tested against real PostgreSQL; CRUD and the user interface that shows them arrive in M1.3. The evidence column describes what must be captured. The *Verified* column is filled in only after the evidence exists.

This document covers the **mandatory academic requirements** only. Product behavior is defined in [Product](product.md). Architectural qualities such as module boundaries, internationalization, and the hand-drawn interface are project goals, not academic requirements, and must not be presented as substitutes for them.

## Mandatory requirements

| ID | Requirement |
| --- | --- |
| AC-01 | A functional software application using a real database |
| AC-02 | At least two related tables, with primary and foreign keys where appropriate |
| AC-03 | Complete CRUD: create, read, update, and delete |
| AC-04 | At least one SQL query using `JOIN` |
| AC-05 | At least one SQL query using a subquery or an aggregate (`COUNT`, `SUM`, `AVG`, …) |
| AC-06 | Real frontend, backend, and database integration |

## Traceability

| ID | How Refrain satisfies it | Evidence to demonstrate | Verified |
| --- | --- | --- | --- |
| AC-01 | A Next.js application persisting to PostgreSQL, run locally through Docker Compose. Data survives an application restart. | The application running; data still present after restarting the app server; the PostgreSQL container listed | — |
| AC-02 | Catalog tables (`artists`, `albums`, `album_artists`, `tracks`, `album_tracks`, `album_editions`, `edition_tracks`) and authored tables (`entries`, `entry_texts`, `album_journals`, `track_reflections`), with UUID primary keys and declared foreign keys ([Data Model](data-model.md)) | Migration SQL; `\d albums`, `\d album_artists`, and `\d track_reflections` output showing PK and FK constraints; a rejected insert that violates an FK | — |
| AC-03 | **Catalog:** create, list and view, edit, and delete albums and artists. **Writing:** create, read, update, and delete an album journal and its track reflections. | Each operation performed through the UI, followed by a reload and a `SELECT` showing the row's state. Delete shown twice: a real `DELETE` of an unreferenced test record, and a `RESTRICT` refusal when deleting a record that writing references. | — |
| AC-04 | Albums with their credited artists: `albums ⋈ album_artists ⋈ artists`, used by the Writing Studio's Catalog page (it lists private catalog data, so the public Albums listing uses a predicate-restricted variant) | Query source in the repository, the rendered page, and the same SQL run in `psql` with its result | — |
| AC-05 | Aggregate: `COUNT` of written track reflections per album journal (Desk). Subquery: catalog usage count per album (Catalog). | Query source, the rendered counts, and the SQL run in `psql` with results matching the UI | — |
| AC-06 | Browser UI → server action or route handler → application module → Drizzle → PostgreSQL → rendered response | A live walkthrough: an edit in the UI appears in `psql`; a change made in `psql` appears in the UI after reload; plus an integration test against real PostgreSQL | — |

The SQL for AC-04 and AC-05 is in [Data Model § Representative SQL](data-model.md#representative-sql). It runs against the implemented schema and is covered by integration tests; the evidence still requires the rendered pages.

### Notes on interpretation

- **Backend.** Refrain's backend is the server side of the Next.js application: server actions, route handlers, and the domain modules behind them (see [Architecture](architecture.md)). It runs only on the server and is the only code that talks to PostgreSQL. **Open:** confirm with the course instructor that a server layer inside one full-stack application meets the "backend" requirement. If it does not, expose the CRUD operations as documented HTTP route handlers and demonstrate them with direct HTTP requests.
- **Delete.** Entries use recoverable deletion (Recently deleted), and automatic purge is disabled ([ADR 0002](decisions/0002-domain-model-decisions.md), D4). The academic `DELETE` is shown on an unreferenced catalog record (M1). Once M2 exists, it is also shown on an entry permanently deleted through "Delete now". Both execute real SQL `DELETE` statements.
- **ORM vs. SQL.** Drizzle generates SQL. For AC-04 and AC-05, show the actual SQL text, either written with Drizzle's `sql` template or logged from the query builder, and run it directly in `psql`.

## Demonstration script (draft)

Run it against a local database seeded with clearly labeled **test fixtures**. Never use the author's real writing.

1. Show the schema: tables, PKs, and FKs (AC-02).
2. Catalog: create a test artist and a test album credited to it. Reload and show both rows (AC-01, AC-03 create and read).
3. Edit the album title in the UI and show the updated row (AC-03 update, AC-06).
4. Create a test album journal with two track reflections. The Desk shows "2 of N tracks written" (AC-05).
5. Show the studio Catalog listing and run the JOIN query in `psql` (AC-04).
6. Try to hard-delete the referenced album: refused. Delete an unreferenced test album: succeeds (AC-03 delete).

Steps 1–6 cover every academic requirement and depend only on M1. If M2 and M3 are complete, these steps show the product rules as well:

7. Delete the test journal, restore it, delete it again, and permanently delete it with "Delete now" (M2).
8. Show that a draft entry is not reachable from the public pages (M3).

## Definition of complete

The academic milestone is complete when every row above has evidence captured in the repository (for example `docs/evidence/`, created when it is needed), the essential automated checks pass in CI, and the demonstration script has been rehearsed end to end on a clean database. Screenshots and recordings must come from the real application; none may be mocked or staged.
