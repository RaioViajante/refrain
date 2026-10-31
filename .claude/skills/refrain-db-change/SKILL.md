---
name: refrain-db-change
description: Operational procedure for changing Refrain's PostgreSQL schema or Drizzle migrations without risking authored writing. It covers classifying the change, verifying the target database, generating and reading the SQL with drizzle-kit, testing fresh and upgrade paths on the disposable test database, checking constraints and ADR 0002 and ADR 0003 invariants, and reporting evidence. Use it for any change to src/db/schema.ts or src/db/migrations/, for example new tables, columns, constraints, indexes, foreign keys, CHECK value lists, backfills, or custom SQL migrations.
argument-hint: "[description of the schema change]"
---

# Refrain database change

**Change requested:** $ARGUMENTS

This skill sequences the documented workflow; it does not replace it. The authorities:

- [Development § Database changes](../../../docs/development.md#database-changes) and [§ Test database](../../../docs/development.md#test-database);
- [Data Model](../../../docs/data-model.md);
- [ADR 0002](../../../docs/decisions/0002-domain-model-decisions.md) and [ADR 0003](../../../docs/decisions/0003-relational-schema-conventions.md);
- [`AGENTS.md`](../../../AGENTS.md) §4 and §8.

If they disagree with this file, they win: stop and point out the conflict.

## Non-negotiable rules

- **Never rewrite an applied migration** without the author's explicit authorization. Treat every migration on `main` as applied. Fix mistakes with a new migration.
- **Never run a write or destructive operation against an unidentified database** (step 5).
- **Never use `drizzle-kit push`.** It is not a substitute for a reviewed migration file.
- **Never let a catalog change cascade into authored writing.** Foreign keys from writing to the catalog are `ON DELETE RESTRICT`.
- **Never assume a rollback is safe or automatic.** Drizzle Kit generates no down migrations. Recovery means a new forward migration or a restore from a backup.
- **Never treat mocked PostgreSQL behavior as verification.** Constraints, transactions, and SQL are proven only against real PostgreSQL in the disposable test database.
- **Never bypass or weaken the test-database safety checks**: `src/testing/test-database.ts`, `global-setup.ts`, `worker-setup.ts`, `unit-setup.ts`, `vitest.config.mts`, `docker/postgres-test/`, and the CI marker step. If they refuse, fix the configuration, not the guard.
- **Never run migrations against production or any hosted database** without the author's explicit authorization. No production procedure exists yet.
- **Do not change the schema without authorization.** Schema changes need an authorized milestone ([Roadmap](../../../docs/roadmap.md)), and destructive changes need the author's explicit approval before they are written.

## Procedure

### 1. Inspect the current schema and migration history

```sh
git status
git branch --show-current          # never work on main
ls src/db/migrations
cat src/db/migrations/meta/_journal.json
pnpm db:check                      # snapshot consistency; does not connect
```

Read the tables involved in `src/db/schema.ts`, the latest migration files, and the matching sections of the [Data Model](../../../docs/data-model.md).

### 2. Identify the affected entities and invariants

- **Catalog or authored?** Catalog tables are public and replaceable. Authored tables (`entries`, `entry_texts`, the subtypes, `track_reflections`, `track_reflection_texts`, `memory_music`, `entry_slugs`) hold irreplaceable writing.
- **Invariants:**
  - INV-1 to INV-5;
  - ADR 0002 D4 (deletion and archiving), D5 (track reflections), D7 (slugs);
  - ADR 0003 §1 (value arrays and `CHECK` lists), §3 (slug retention), §4 (publication history), §5 (no purge).
- **[Rules not enforced by constraints](../../../docs/data-model.md#rules-not-enforced-by-constraints)** and the [transaction boundaries](../../../docs/data-model.md#transaction-boundaries).
- **Visibility.** If a column affects public visibility, also review `src/modules/publication/predicate.ts`, and run `/refrain-security-review` on the change.

### 3. Classify the change

| Class | Examples | Requires |
| --- | --- | --- |
| **Additive** | New table; new nullable column; new index | Fresh-database test (step 9) |
| **Compatible** | New `CHECK`, `UNIQUE`, or `NOT NULL` that existing rows satisfy; a wider value list; a column with a default | Proof that existing rows comply; a backfill before the constraint; an upgrade test (step 10) |
| **Potentially destructive** | A narrower value list; `NOT NULL` or `UNIQUE` on existing data; a type change; a changed delete rule; a rename; a dropped constraint or index that enforces a rule | Migrate the rows first; an upgrade test with data; a recovery plan; the author's approval if an authored table is involved |
| **Destructive** | Drop a table or column; delete or truncate rows; add a cascade | The author's explicit approval **before** writing it; a backup and a recovery plan. Never a cascade from the catalog into writing. |

Choose the more cautious class when in doubt.

### 4. Explain the data-preservation risks

Before generating anything, write down:

- which rows exist or could exist, catalog and authored;
- what happens to each row;
- what cannot be undone;
- how to recover. Recovery is a forward migration, or a restore from a `pg_dump` taken beforehand ([Development § Local database](../../../docs/development.md#local-database)).

If authored data could be lost, stop and get the author's approval.

### 5. Verify the target database before any write

`pnpm db:generate` and `pnpm db:check` do not connect. `pnpm db:migrate` **writes** to `DATABASE_URL`. Variables already set in the shell take precedence over `.env`, both for Drizzle Kit and for Node's `--env-file`. Before migrating, print the effective target. The command never prints credentials:

```sh
node --env-file=.env -e 'const u = new URL(process.env.DATABASE_URL); console.log({ host: u.hostname, port: u.port || "5432", database: u.pathname.slice(1), queryParameters: [...u.searchParams.keys()] })'
docker compose ps
```

Proceed only if all of these hold:

- the host is `127.0.0.1` or `localhost`;
- the port matches the healthy `postgres` service;
- the database is your local development database (`refrain` by default);
- `queryParameters` is empty. Parameters such as `?host=` can redirect the connection.

Anything else, stop.

Before migrating a development database that holds writing you care about, take a backup with the `pg_dump` command in Development § Local database.

### 6. Confirm test-database isolation

```sh
pnpm db:test:up      # a fresh, marked, in-memory test database on 127.0.0.1:5433
```

Integration tests connect only to `TEST_DATABASE_URL`. Global setup refuses to run unless the five safety checks pass, the last being the server-side `refrain:disposable-test-database` marker. Never point `TEST_DATABASE_URL` at another database. If your `.env` predates M1.2, copy the test variables from `.env.example` (Development § Troubleshooting).

### 7. Generate the migration

1. **Edit `src/db/schema.ts`, following the [conventions](../../../docs/data-model.md#conventions):**
   - explicit `snake_case` names;
   - named constraints;
   - enumerations taken from the value arrays;
   - authored-to-catalog foreign keys `RESTRICT`;
   - cascades only inside the catalog, or from an entry to the rows it exclusively owns.
2. **Generate:** `pnpm db:generate --name=<what_changed>`.
   - The command needs a well-formed `DATABASE_URL`.
   - If drizzle-kit asks whether a column or table was **renamed**, answer deliberately. A wrong answer generates `DROP` plus `ADD`, which loses data.
   - If the prompt cannot be answered in your shell, stop and ask the user to run the command with `! pnpm db:generate --name=<what_changed>`.
3. **Custom SQL** (for example a deferrable constraint): `pnpm db:generate --custom --name=<what>`. Write the SQL into the empty file, and add a comment in `schema.ts` where the object lives.
4. **Backfills:** put the `UPDATE` in the generated SQL **before** the constraint that needs it, with a comment.

### 8. Review the generated SQL manually

Read the whole migration file and its snapshot diff. Check:

- [ ] Only the intended statements are there. Look for unexpected `DROP`, `ALTER … TYPE`, `SET NOT NULL`, or a rename that was generated as a drop.
- [ ] Every `ON DELETE` rule is correct: `grep -n 'ON DELETE' src/db/migrations/<new>.sql`. No `CASCADE` reaches an authored table from the catalog.
- [ ] Constraint names match the schema, and `CHECK` value lists match the arrays.
- [ ] Backfills come before the constraints they satisfy. No other data is written, and nothing is seeded.
- [ ] Nothing purges or deletes entries: no trigger, rule, or job (ADR 0002, D4.4).
- [ ] The statements are separated by `--> statement-breakpoint`.

### 9. Test applying to a fresh database

```sh
pnpm db:test:down && pnpm db:test:up
pnpm test:integration
```

Global setup applies every migration to the empty test database before the tests run. A single file can be run with `pnpm test:integration <file>`.

### 10. Test the upgrade path from existing data, where relevant

Do this for anything that is not purely additive. Use the disposable test container only: it is identified by its service name and its fixed credentials.

```sh
pnpm db:test:down && pnpm db:test:up
docker compose exec -T postgres-test psql -At -U refrain_test -d refrain_test \
  -c "select shobj_description(oid, 'pg_database') from pg_database where datname = current_database()"
#   must print: refrain:disposable-test-database
for f in <every migration before yours, in journal order>; do
  docker compose exec -T postgres-test psql -q -v ON_ERROR_STOP=1 -U refrain_test -d refrain_test < "src/db/migrations/$f.sql" || break
done
# Insert synthetic [Test] rows that exercise the change, for example rows the
# new constraint must accept, or rows the backfill must fix.
docker compose exec -T postgres-test psql -q -v ON_ERROR_STOP=1 -U refrain_test -d refrain_test < src/db/migrations/<new>.sql
# Query the result to confirm that the rows survived and were transformed as intended.
pnpm db:test:down && pnpm db:test:up      # reset before running the integration tests
```

These files are applied with `psql`, which bypasses Drizzle's bookkeeping. That is why the container is reset afterwards. Use synthetic data only.

### 11. Verify foreign keys, constraints, uniqueness, and transactions

Use the helpers in `src/testing/` (`expectRejected`, `captureDatabaseError`, `inRollbackTransaction`) and the existing integration tests as models.

- **Constraints.** Every new `CHECK`, `UNIQUE`, `RESTRICT` foreign key, and partial unique index has a rejection test that asserts the SQLSTATE and the constraint name.
- **Cascades.** Every cascade has a test of its effect, row by row.
- **Migration tests.** `src/db/migrations.integration.test.ts` checks the table list, the value lists, and the delete rules against `pg_constraint`. Update it for new tables and foreign keys. Never relax it.
- **Transactions.** Multi-row writes run in one transaction, through a module command, with a rollback test.
- **Coverage count.** Update the constraint count in [Data Model § Validation](../../../docs/data-model.md#validation) if it changes.

### 12. Check the ADR invariants

Confirm, and name the test that proves each one:

- INV-1 to INV-5 still hold;
- the predicate is unchanged, or was reviewed;
- the command-only rules of ADR 0003 are untouched: publication history, `was_published`, retired slugs, and `permanentlyDeleteEntry`;
- there is still no purge.

A significant new decision gets an ADR ([format](../../../docs/decisions/README.md)).

### 13. Confirm there are no unexpected changes

```sh
pnpm db:check
pnpm db:generate                                          # must report no changes
git status --porcelain -- src/db/migrations               # nothing new after this
git diff --name-status origin/main...HEAD -- src/db/migrations
```

The last command may list only your new SQL file and snapshot (`A`) and `meta/_journal.json` (`M`). Any modified older migration is a stop (rule 1).

### 14. Run the checks and report

```sh
pnpm lint && pnpm format:check && pnpm typecheck && pnpm test && pnpm build
pnpm test:integration
```

Update [Data Model](../../../docs/data-model.md), and [Development](../../../docs/development.md) if the workflow changed, in the same change. Report:

- **Classification** and why;
- **Migration files** and a summary of their SQL;
- **Data-preservation risks**, the recovery plan, and any author approval obtained;
- **Target verification output** (step 5), if anything was migrated outside the test container;
- **Fresh and upgrade tests:** the commands and their actual results;
- **Constraint and invariant tests** added or updated;
- **Checks:** each command and its actual result;
- **Not verified**, and why.

Never report a check you did not run.
