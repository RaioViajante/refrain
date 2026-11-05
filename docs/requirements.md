# Requirements

**Presentation:** November 16, 2026.
**Status:** M1.3B implemented CRUD and the screens that show the JOIN, aggregate, and subquery results, tested against real PostgreSQL and through the production build; [the M1.3B evidence](evidence/m1-3b.md) records a run, and [the M1.3C evidence](evidence/m1-3c.md) maps each requirement to its screen, tables, query, and executed check, including a browser run that made the records through the interface. **[The M4 evidence](evidence/m4.md) (M4.2) is the current account:** the requirements matrix, an ER diagram, ready-to-paste SQL, the local runbook, and the demonstration. The *Verified* column stays empty until the author reviews that evidence and the demonstration has been rehearsed on a clean database (M4.3).

**Not in the repository:** the original assignment document. The six requirements below are the project's statement of it, not a quotation. The evidence column describes what must be captured. The *Verified* column is filled in only after the evidence exists.

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
| AC-04 | Albums with their credited artists: `albums ⋈ album_artists ⋈ artists`, used by the Writing Studio's Albums page (`/studio/albums`, in its Catalog section; it lists private catalog data, so the public Albums listing uses a predicate-restricted variant) | Query source in the repository, the rendered page, and the same SQL run in `psql` with its result | — |
| AC-05 | Aggregates: `COUNT` of tracks per album (Albums page) and of written track reflections per album journal (Desk). Subquery: how many entries use each album (Albums page). | Query source, the rendered counts, and the SQL run in `psql` with results matching the UI | — |
| AC-06 | Browser UI → server action or route handler → application module → Drizzle → PostgreSQL → rendered response | A live walkthrough: an edit in the UI appears in `psql`; a change made in `psql` appears in the UI after reload; plus an integration test against real PostgreSQL | — |

The SQL for AC-04 and AC-05 is in [Data Model § Representative SQL](data-model.md#representative-sql). It runs against the implemented schema and is covered by integration tests; the evidence still requires the rendered pages.

### Notes on interpretation

- **Backend.** Refrain's backend is the server side of the Next.js application: server actions, route handlers, and the domain modules behind them (see [Architecture](architecture.md)). It runs only on the server and is the only code that talks to PostgreSQL. **Open:** confirm with the course instructor that a server layer inside one full-stack application meets the "backend" requirement. If it does not, expose the CRUD operations as documented HTTP route handlers and demonstrate them with direct HTTP requests.
- **Delete.** Entries use recoverable deletion: *Move to Recently deleted* is an `UPDATE` of `entries.deleted_at`, and *Restore* reverses it; automatic purge is disabled ([ADR 0002](decisions/0002-domain-model-decisions.md), D4). The academic `DELETE` is a real SQL `DELETE` of an unreferenced catalog record (artist, album, or track), and PostgreSQL refuses it for a record that anything refers to. "Delete now", the permanent deletion of an entry, is **not built** in the Studio (M2.4), so it is not part of the demonstration.
- **ORM vs. SQL.** Drizzle generates SQL. For AC-04 and AC-05, show the actual SQL text, either written with Drizzle's `sql` template or logged from the query builder, and run it directly in `psql`.

## Demonstration script

The current script, with its runbook and SQL, is [the M4 CRUD demonstration](evidence/m4.md#crud-demonstration). Run it against a local database of clearly labeled **test fixtures**: the disposable test database and a synthetic author ([M4 runbook](evidence/m4.md#local-environment-runbook)). Never use the author's real writing.

1. Show the schema: tables, PKs, and FKs (AC-02).
2. Catalog: create a test artist and a test album credited to it, with two tracks. Reload and show the rows (AC-01, AC-03 create and read).
3. Edit the album title in the UI and show the updated row (AC-03 update, AC-06).
4. Show the Albums page ("2 tracks", "used in … entries") and run the JOIN, the count, and the subquery in `psql` (AC-04, AC-05).
5. Delete an unreferenced test artist: a real `DELETE`. Try to delete the credited one: refused by `RESTRICT` (AC-03 delete).
6. Change a row in `psql` and reload; restart the application and reload (AC-06, AC-01).

Optional, if time allows: write a test journal, move it to Recently deleted and restore it (an `UPDATE`, not a `DELETE`), and write one track reflection so the Desk reads "1 of 2 tracks written" (AC-05). Public pages are not part of the academic demonstration; they stay off.

## Definition of complete

The academic milestone is complete when every row above has evidence captured in the repository (for example `docs/evidence/`, created when it is needed), the essential automated checks pass in CI, and the demonstration script has been rehearsed end to end on a clean database. Screenshots and recordings must come from the real application; none may be mocked or staged.
