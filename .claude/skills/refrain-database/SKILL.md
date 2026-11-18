---
name: refrain-database
description: Procedure for changing Refrain's PostgreSQL schema, Drizzle migrations, or SQL queries safely. Covers verifying the target database, schema integrity rules, generating and reading migrations with Drizzle Kit, testing on a disposable database, writing JOIN, COUNT, and subquery reads with Drizzle, transactions, and the evidence to report. Use it for any change to src/db/schema.ts, src/db/migrations/, or code that queries the database.
argument-hint: "[the schema or query change]"
---

# Refrain database change

**Change:** $ARGUMENTS

## 1. Confirm the target before running anything

- `DATABASE_URL` must be this application's **local** database (`.env.example`: `127.0.0.1:5442/refrain_mixtapes`). Drizzle Kit refuses other hosts and the archived music diary's databases (`src/db/env.ts`); never weaken that check to get a command through.
- There is no hosted database. Never run `db:migrate` against one, and never use `drizzle-kit push`.
- Destructive steps (dropping a table or column, rewriting a migration, deleting rows) need the owner's explicit approval first.

## 2. Schema rules

- Integrity lives in PostgreSQL: primary keys, foreign keys with an explicit `onDelete`, `NOT NULL`, `UNIQUE`, and `CHECK`. TypeScript types and Drizzle relations do not count.
- Authored content (the owner's writing, notes, and choices) is never removed by a cascade from another table: use `restrict` toward shared records, and archive rather than delete what writing references.
- Timestamps are `timestamp with time zone`. Every table has `created_at`; tables the Studio edits have `updated_at`.
- Name tables and columns after the domain, in `snake_case` in SQL.
- Decide public visibility in data, explicitly (for example, a status column with a `CHECK`), so that one server-side predicate can decide what the public sees.

## 3. Migrations

1. Edit `src/db/schema.ts`.
2. `pnpm db:generate`, then **read the generated SQL** in `src/db/migrations/`. Check the constraints, defaults, indexes, and any data loss.
3. Never edit a migration that has been committed and applied; add a new one.
4. Test on a disposable database: from empty (every migration in order), and as an upgrade over a copy that already holds data. If no disposable test database exists yet, add one in the same change. It needs its own Compose service and port, and tests must refuse any database not marked as disposable.
5. Commit the schema, the migration, and its `meta/` snapshot together. CI's schema step fails if they disagree.

## 4. Queries

- Use Drizzle's query builder: `innerJoin` and `leftJoin` for JOINs; `count()` with `groupBy` for counts; a subquery built with `.as("name")` or `inArray(column, subquery)`.
- For raw SQL, use only the `sql` template with bound values. Never concatenate request data into SQL.
- Wrap a write that touches more than one row or table in one `db.transaction`.
- Avoid N+1 reads. Fetch lists with one JOIN or aggregate, and return only the columns the page uses.
- Public reads go through the one visibility predicate, never an ad-hoc `WHERE`.

## 5. Report

Report the generated SQL (summarized), the commands you ran and their actual output (`pnpm db:check`, `pnpm db:generate` with no further changes, and the tests), what you tested on the disposable database, and anything you did not verify.
