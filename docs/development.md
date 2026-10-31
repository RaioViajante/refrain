# Development

**Status:** the application foundation (M1.1), the relational domain (M1.2), and identity and authorization (M1.3A) exist: a Next.js application, a local PostgreSQL 17 database through Docker Compose, a separate disposable test database, the domain schema with versioned migrations, single-author authentication with a minimal Writing Studio entry point, automated checks, and CI. There is no seed data: the development database holds only what you write into it ([Roadmap](roadmap.md)).

Every command in this document has been run successfully. Add a command only after it has run.

## Local setup

### Prerequisites

| Tool | Version | Notes |
| --- | --- | --- |
| Node.js | **24.22.2** (pinned in [`.nvmrc`](../.nvmrc)) | `package.json` `engines` accepts `^24.22.1`, the latest 24.x security release |
| pnpm | **12.15.0** (pinned in `package.json` `packageManager`) | pnpm switches to the pinned version automatically |
| Docker, with Compose v2 | Any current release | Runs PostgreSQL only |

### First run

```sh
pnpm install            # from the committed lockfile
cp .env.example .env    # local, non-secret placeholder values
pnpm db:up              # starts PostgreSQL 17 and waits until it is healthy
pnpm dev                # http://localhost:3000
```

The development page shows `Database: connected` when the server reaches PostgreSQL, and `Database: not reachable` otherwise.

To create the domain tables in the development database, run `pnpm db:migrate` once (and again after pulling new migrations). It only adds what is pending and never seeds data.

To run the integration tests, add the two test variables from `.env.example` to `.env` if it predates M1.2, then:

```sh
pnpm db:test:up         # disposable test database on port 5433
pnpm test:integration
```

### Configuration

All local configuration lives in one file, `.env`, which Git ignores. Docker Compose, Next.js, Drizzle Kit, and the integration tests all read it. [`.env.example`](../.env.example) lists every variable:

| Variable | Read by | Purpose |
| --- | --- | --- |
| `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` | Docker Compose | Credentials used when the database volume is first created |
| `POSTGRES_PORT` | Docker Compose | Host port, bound to `127.0.0.1` only (default `5432`) |
| `DATABASE_URL` | Server code, Drizzle Kit | Development connection string. Server-side only. Never give it a `NEXT_PUBLIC_` prefix. Integration tests never use it. |
| `POSTGRES_TEST_PORT` | Docker Compose | Host port of the [test database](#test-database), bound to `127.0.0.1` only (default `5433`) |
| `TEST_DATABASE_URL` | Integration and HTTP tests | Connection string of the disposable [test database](#test-database). The only database the integration and HTTP tests connect to. |
| `BETTER_AUTH_SECRET` | Server code, the author command | Signs session cookies. At least 32 characters of random data; [generate it](#authentication). A secret: never commit it, never reuse it between environments. |
| `BETTER_AUTH_URL` | Server code, the author command | The application's origin, for example `http://localhost:3000`. HTTPS is required unless the host is `localhost`, `127.0.0.1`, or `[::1]`. Only this origin may send state-changing requests. |
| `REFRAIN_AUTHOR_EMAIL` | Server code, the author command | The single author's email address. Only the account with this email is authorized in the studio. |

Variables already set in the environment take precedence over `.env`, which is how CI supplies its own `TEST_DATABASE_URL`. A `.env` created before M1.2 lacks the two test variables, and one created before M1.3A lacks the three authentication variables; copy them from `.env.example`.

None of these uses a `NEXT_PUBLIC_` prefix, so none reaches the browser. The authentication configuration is validated before the first authentication request is served; a missing or unsafe value refuses every sign-in and studio request instead of falling back to a default. Better Auth would also read `BETTER_AUTH_TRUSTED_ORIGINS`, `BETTER_AUTH_SECRETS`, and `BETTER_AUTH_TELEMETRY` by itself; Refrain refuses to start authentication while any of them is set ([ADR 0004](decisions/0004-single-author-identity.md)).

### Authentication

The Writing Studio has one account: the author's. It is created by a local command, never by a web form. There is no sign-up ([Security § Authentication and sessions](security.md#authentication-and-sessions)).

**Secrets stay out of commands.** Never put the password or `BETTER_AUTH_SECRET` in a command line, an argument, an environment variable on the command line, a commit, documentation, a chat, or a log. The commands below never print either of them.

#### First-time setup of the author account

Run these once, after pulling M1.3A, one at a time. Check each result before you go on.

**1. Check the toolchain.**

```sh
node --version     # v24.22.2, from .nvmrc (24.x before 24.22.1 lacks a security fix)
pnpm --version     # 12.15.0
pnpm install --frozen-lockfile
```

If Node is older, switch to the version in `.nvmrc` with your Node version manager first.

**2. Add the missing configuration, without overwriting anything.** These commands need zsh or bash. This one lists the variables that `.env.example` has and `.env` lacks, by name only:

```sh
comm -13 <(grep -oE '^[A-Z_]+=' .env | sort) <(grep -oE '^[A-Z_]+=' .env.example | sort)
```

- For every listed name except `BETTER_AUTH_SECRET`, copy its line from `.env.example` into `.env` with an editor. Change nothing that is already there.
- Set `BETTER_AUTH_URL=http://localhost:3000`.
- Set `REFRAIN_AUTHOR_EMAIL` to the email address you will sign in with.
- Generate the secret straight into `.env`. It appears in no command and no output.

```sh
if grep -q '^BETTER_AUTH_SECRET=.' .env; then echo "BETTER_AUTH_SECRET already has a value: keep it."; elif grep -q '^BETTER_AUTH_SECRET=' .env; then echo "BETTER_AUTH_SECRET is empty: delete that line in an editor, then run this again."; else [ -n "$(tail -c1 .env)" ] && echo >> .env; { printf 'BETTER_AUTH_SECRET='; openssl rand -base64 32; } >> .env; echo "BETTER_AUTH_SECRET added."; fi
```

It keeps an existing value. It refuses an empty `BETTER_AUTH_SECRET=` line, such as the one in `.env.example`, so that line has to be deleted first. It adds a line break first if the file's last line lacks one, so the secret never joins the previous line.

Then check that the three authentication variables have values. It prints `set` or `MISSING`, never a value:

```sh
node --env-file=.env -e 'for (const v of ["BETTER_AUTH_SECRET", "BETTER_AUTH_URL", "REFRAIN_AUTHOR_EMAIL"]) console.log(v, process.env[v]?.trim() ? "set" : "MISSING")'
```

Use a different secret in every environment. Replacing it later signs out every session.

**3. Verify the development database target.**

```sh
pnpm db:up
docker compose ps postgres
node --env-file=.env -e 'try { const u = new URL(process.env.DATABASE_URL); console.log({ host: u.hostname, port: u.port || "5432", database: u.pathname.slice(1), queryParameters: [...u.searchParams.keys()] }) } catch { console.log("DATABASE_URL is missing or not a valid URL") }'
```

Continue only if all of these hold:

- the service is healthy;
- the host is `127.0.0.1` or `localhost`;
- the port matches the service (`5432` by default);
- the database is `refrain`, or your own `POSTGRES_DB`;
- `queryParameters` is empty.

If the database holds writing you care about, back it up first ([Local database](#local-database)).

**4. Apply the migrations and confirm the schema.**

```sh
pnpm db:migrate
docker compose exec -T postgres psql -U refrain -d refrain -Atc "select count(*) from drizzle.__drizzle_migrations"
docker compose exec -T postgres psql -U refrain -d refrain -Atc "select string_agg(tablename, ' ' order by tablename) from pg_tables where schemaname = 'public' and tablename like 'auth\_%'"
```

Expect `5` migrations (0000 to 0004), then `auth_accounts auth_rate_limits auth_sessions auth_users auth_verifications`. Migrations only add what is pending and never seed data.

**5. Create the account, interactively.** Name the target explicitly. The command refuses unless the target matches `DATABASE_URL`:

```sh
pnpm author:provision --target=127.0.0.1:5432/refrain
```

1. It prints the target and the email, which is `REFRAIN_AUTHOR_EMAIL`. Check both.
2. It asks for the password twice, without showing it. Generate the password in a password manager and paste it into the prompt.
3. It writes the account, or refuses and changes nothing if any account already exists.

The password must be 15 to 128 characters and must not contain the email. The command never accepts the password as an argument or an environment variable, so it does not reach shell history or the process list.

**6. Verify sign-in and sign-out.** Run `pnpm dev`, then:

1. Open `http://localhost:3000/studio`. You are sent to the sign-in page.
2. Sign in with a wrong password. The page says "That email and password don't match."
3. Sign in with the right one. The studio shows "You are signed in. The editor is not built yet."
4. Choose "Sign out". You are back on the sign-in page.
5. Open `/studio` again. You are sent to sign-in again.

Five sign-in attempts a minute are allowed, for everyone together.

**Change or recover the password.** With access to the database:

```sh
pnpm author:reset-password --target=127.0.0.1:5432/refrain
```

It replaces the password and signs out every session. There is no password reset by email, and no recovery over HTTP.

### Commands

| Command | What it does |
| --- | --- |
| `pnpm dev` | Development server |
| `pnpm build` | Production build. Needs no database and no `DATABASE_URL`. |
| `pnpm start` | Serves the production build |
| `pnpm lint` | ESLint, including the module-boundary rules |
| `pnpm format` / `pnpm format:check` | Prettier: write, or check only. Markdown and the local `reference/` are excluded. |
| `pnpm typecheck` | Generates Next.js route types, then runs `tsc --noEmit` (strict) |
| `pnpm test` | Unit tests (Vitest). No database needed. |
| `pnpm test:integration` | Integration tests against the disposable [test database](#test-database) in `TEST_DATABASE_URL`. Refuses to run if the safety checks fail, and fails if the database is not reachable; it never skips. |
| `pnpm test:http` | HTTP tests of the production build. Needs `pnpm build` first and the test database. Starts `next start` on `127.0.0.1` against `TEST_DATABASE_URL` only ([HTTP tests](#http-tests)). |
| `pnpm author:provision --target=<host>:<port>/<database>` | Creates the single author account in the database in `DATABASE_URL` ([Authentication](#authentication)) |
| `pnpm author:reset-password --target=<host>:<port>/<database>` | Replaces the author's password and signs out every session |
| `pnpm db:up` / `pnpm db:down` | Start the development PostgreSQL and wait for health / stop it. Data is kept in the `refrain_postgres-data` volume. |
| `pnpm db:test:up` / `pnpm db:test:down` | Start the test database and wait for health / stop and remove it, discarding its data. They touch only the `postgres-test` container. |
| `pnpm db:generate` | Generate a SQL migration from the Drizzle schema. Like every Drizzle Kit command, it needs `DATABASE_URL` (well formed; generating does not connect). |
| `pnpm db:migrate` | Apply pending migrations to the database in `DATABASE_URL` |
| `pnpm db:check` | Check that the committed migration snapshots are consistent. Does not connect. |

### Local database

PostgreSQL runs from [`compose.yaml`](../compose.yaml) using the `postgres:17.11-trixie` image, with a health check and a named volume. It listens on `127.0.0.1` only. These credentials are for local development and never for production.

```sh
docker compose ps                                   # status and health
docker compose logs postgres                        # server log
docker compose exec postgres psql -U refrain -d refrain
```

These commands use the default `refrain` user and database. If you changed `POSTGRES_USER` or `POSTGRES_DB` in `.env`, substitute your values here and below.

**Backup and restore of local data.** Dumps can contain writing, and `*.dump` is ignored by Git. Keep dumps outside the repository.

```sh
docker compose exec -T postgres pg_dump -U refrain -d refrain --format=custom > ~/refrain-local.dump
docker compose exec -T postgres pg_restore -U refrain -d refrain --clean --if-exists < ~/refrain-local.dump
```

**Reset.** This permanently deletes all local data in the database volume:

```sh
docker compose down --volumes
pnpm db:up
```

### Test database

Integration tests write data, so they run against their own PostgreSQL server, never the development database.

| | Development database | Test database |
| --- | --- | --- |
| Compose service | `postgres` | `postgres-test` (profile `test`; `pnpm db:up` does not start it) |
| Host port | `127.0.0.1:5432` | `127.0.0.1:5433` |
| User / database | `refrain` / `refrain` | `refrain_test` / `refrain_test` |
| Storage | Named volume `refrain_postgres-data` | In memory (`tmpfs`). Discarded whenever the container stops. |
| Read through | `DATABASE_URL` | `TEST_DATABASE_URL` |

**Safety checks.** The integration tests never read `DATABASE_URL`. Before any test file runs, [`src/testing/global-setup.ts`](../src/testing/global-setup.ts) applies the checks in [`src/testing/test-database.ts`](../src/testing/test-database.ts) and refuses to continue unless all of them pass:

1. `TEST_DATABASE_URL` is set. There is no fallback.
2. It is a `postgres://` URL **without query parameters**, which node-postgres would let override the host or port.
3. Its *effective* target, meaning the host, port, and database node-postgres resolves and would connect to, has a loopback host (`localhost`, `127.0.0.1`, or `::1`) and a database name ending in `_test`.
4. If `DATABASE_URL` is set, its effective target is resolved the same way, query parameters such as `?host=` and `?port=` included, and its database must have a **different name**, whatever its host and port. One server is reachable under many host spellings (`0.0.0.0`, `127.1`, `::ffff:127.0.0.1`, …) and through forwarded ports, so hosts and ports cannot prove two databases distinct. If `DATABASE_URL` cannot be resolved to exactly one host, one valid port, and one database, the tests refuse to run rather than skip the comparison.
5. On the server, the connected database carries the disposable-test marker: a database comment written only by [`docker/postgres-test/01-mark-disposable.sql`](../docker/postgres-test/01-mark-disposable.sql). The local `postgres-test` service applies it when it initializes, and CI applies it to its own service container. A database name can be mistyped; the marker has to be placed on purpose.

Each test worker then points the application's database client at the validated test URL, so code under test cannot reach the development database, and [`src/testing/isolation.integration.test.ts`](../src/testing/isolation.integration.test.ts) asserts it.

**Clean state without resets.** Each test runs inside a transaction that is always rolled back ([`src/testing/database.ts`](../src/testing/database.ts)), so tests leave no rows behind and are repeatable. There is no reset or truncate command. Test files run one at a time.

**Lifecycle.**

```sh
pnpm db:test:up          # start a fresh, marked test database and wait until it is healthy
pnpm test:integration    # safety checks, then the integration tests
pnpm db:test:down        # stop it and discard its data
```

**Recovery.** If the test database is in a bad state, run `pnpm db:test:down` and `pnpm db:test:up`: the new container starts empty and marked. This never affects the development database or its volume.

### HTTP tests

`pnpm test:http` tests the production build over real HTTP ([`src/modules/identity/studio.http.test.ts`](../src/modules/identity/studio.http.test.ts)). Its global setup ([`src/testing/http-global-setup.ts`](../src/testing/http-global-setup.ts)):

1. applies the same five safety checks to `TEST_DATABASE_URL`, then the migrations;
2. refuses to start unless the identity tables are empty, so it never touches identity rows it did not create;
3. creates a synthetic author (`author@example.com`) with the real `pnpm author:provision` command, the password on standard input;
4. starts `next start` on `127.0.0.1` and a free port, in production mode, with a random secret, and with `DATABASE_URL` set to the test database's URL.

The server uses its own connections, so these rows are committed, unlike the integration tests' rolled-back transactions. Teardown stops the server and deletes the identity rows. If a run is interrupted, reset the test database with `pnpm db:test:down && pnpm db:test:up`. Run the HTTP and integration tests one after the other, not at the same time: the database holds at most one account.

### Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| `Set POSTGRES_PASSWORD in .env` from Docker Compose | `.env` is missing. Run `cp .env.example .env`. |
| `Database: not reachable` | PostgreSQL is not running. Run `pnpm db:up` and check `docker compose ps`. The server log records only an error code, never connection details. |
| `DATABASE_URL is not set` | `.env` is missing, or it lacks `DATABASE_URL`. |
| `Refusing to run integration tests: …` | A [test database](#test-database) safety check failed; the message names it. Usually `TEST_DATABASE_URL` is missing from an older `.env` (copy it from `.env.example`), or the test database is not running (`pnpm db:test:up`). Never point it at a database whose contents matter. |
| Integration tests fail with `ECONNREFUSED` on port 5433 | The test database is not running. Run `pnpm db:test:up`. |
| `Authentication is not configured` in the server log; the studio says it isn't available | An authentication variable is missing or unsafe; the log names it, never its value. See [Authentication](#authentication). |
| `Too many attempts` when signing in | Five sign-in attempts a minute are allowed, for all clients together. Wait a minute. |
| `The HTTP tests could not start: … identity rows` | An earlier run was interrupted. Run `pnpm db:test:down && pnpm db:test:up`. |
| Port 5432 is already in use | Set `POSTGRES_PORT` in `.env`, change the port in `DATABASE_URL` to match, and run `pnpm db:up` again. |
| A changed `POSTGRES_PASSWORD` has no effect, or authentication fails | The image applies the `POSTGRES_*` values only when it creates an empty volume. Restore the old values, or reset the database (this deletes local data). |
| An engine warning about the Node.js version | Use the version in `.nvmrc`. 24.x releases earlier than 24.22.1 lack a security fix. |
| `ERR_PNPM_IGNORED_BUILDS` after adding a dependency | pnpm blocks install scripts by default. Review the package, then allow or deny it under `allowBuilds` in `pnpm-workspace.yaml`. |
| A version published in the last seven days does not install | Intentional: `minimumReleaseAge` in `pnpm-workspace.yaml` blocks very new versions. |

### Local design references

`reference/` holds the author's local design references and is ignored by Git. A clean clone does not have it, and nothing needs it: the application, tests, CI, and documentation use only tracked assets ([Design System § Assets](design-system.md#assets)).

`reference/` was tracked until the M1.1 pull request (#3) stopped tracking it. In a clone that has it checked out from an earlier commit, moving to a commit without it (for example `git pull` after the change is merged) **deletes those files from the working tree**, because Git removes files it stops tracking. Copy `reference/` outside the repository first. To recover the files afterwards, restore them from an older commit into the working tree only: `git restore --source=172ab8b --worktree -- reference/`.

Next.js ships documentation that matches the installed version in `node_modules/next/dist/docs/`. Prefer it over memory when the framework's behavior is in doubt.

## Toolchain

Versions are exact in `package.json`, and the lockfile is committed. Each was checked against its dependents' declared peer and engine ranges before it was installed. As a supply-chain rule, pnpm installs only versions published at least seven days earlier (`minimumReleaseAge`). Selected on 2026-10-31:

| Package | Version | Note |
| --- | --- | --- |
| Node.js | 24.22.2 | Node 24 is a maintenance LTS line, supported until 2028-04-30. Node 26 became LTS only on 2026-10-28; revisit after the presentation. |
| pnpm | 12.15.0 | |
| `next` | 16.4.3 | App Router, Turbopack, Cache Components |
| `react`, `react-dom` | 19.3.1 | |
| `typescript` | 6.0.3 | TypeScript 7 is excluded: `typescript-eslint` supports only `<6.1.0`. |
| `tailwindcss`, `@tailwindcss/postcss` | 4.3.3 | The PostCSS plugin, as the Next.js documentation describes |
| `drizzle-orm` | 0.45.4 | Drizzle 1.0 is a release candidate and is not used. |
| `drizzle-kit` | 0.31.11 | |
| `pg` (node-postgres), `@types/pg` | 8.23.1 | PostgreSQL driver: see [Architecture](architecture.md#persistence) |
| `server-only` | 0.0.1 | |
| `better-auth` | 1.7.12 | Authentication ([ADR 0004](decisions/0004-single-author-identity.md)). The newest stable release older than seven days on 2026-10-31; 1.7.13 and 1.7.14 were too new. Its peer ranges include the versions above. |
| `zod` | 4.6.7 | Validation at server boundaries; also Better Auth's own dependency range (`^4.5.4`) |
| `tsx` | 4.23.15 | Runs the local author command (`--conditions=react-server`, under which `server-only` permits server code) |
| `eslint` | 9.39.5 | ESLint 10 is excluded: plugins used by `eslint-config-next` declare support only up to ESLint 9. |
| `eslint-config-next` | 16.4.3 | |
| `prettier` | 3.9.10 | |
| `vitest` | 5.0.5 | With `vite` 8.3.5, its peer dependency |
| `@types/node` | 24.19.2 | Matches the Node.js major version |
| `@types/react`, `@types/react-dom` | 19.3.0 | |
| PostgreSQL image | `postgres:17.11-trixie` | Same image locally and in CI |

Planned dependencies (Tiptap, next-intl, Rough.js, Playwright) are added with the features that need them, after the same compatibility check.

`pnpm audit` reports two moderate advisories, both in development tools and both present before M1.3A: esbuild in `drizzle-kit` (development-server CORS), and minimatch in `eslint-config-next` (pattern denial of service). Neither runs in the application or receives untrusted input.

## Branches and commits

- `main` is the integration branch. It only changes through pull requests.
- Branch names follow `<type>/<short-topic>`, for example `docs/m0-foundations`, `feat/catalog-crud`, `fix/publish-revalidation`.
- Commits follow [Conventional Commits](https://www.conventionalcommits.org/): `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `build`, `ci`, `perf`, with an optional scope such as `feat(catalog): add album edit form`. Subjects are imperative, lowercase, and have no trailing period.
- Keep each branch to one concern, and keep pull requests small enough to review in one sitting.
- Never force-push `main`. Force-pushing your own unshared topic branch is acceptable.

## Pull requests

Each pull request description contains:

1. **Scope:** what changed and why, plus what is deliberately out of scope.
2. **Decisions:** any trade-off made, and a link to an ADR if one was written.
3. **Verification:** the commands run and their actual results, plus screenshots from the real application for UI changes.
4. **Risk:** effects on data, privacy, migrations, or accessibility.
5. **Follow-up:** known gaps.

Merge only after the required checks pass and the PR has had an independent review where one is available: a second person, or a review agent that did not write the change. Nobody merges their own PR automatically, and branch protection is never bypassed.

### Repository protection

The GitHub repository is private. On its current plan, GitHub refuses branch protection for private repositories (the API returned HTTP 403, "Upgrade to GitHub Pro or make this repository public", on 2026-10-31). Until protection is available, the rules above are enforced by convention and must be followed as if they were enforced:

- changes reach `main` only through pull requests;
- no force pushes and no branch deletion on `main`;
- required checks must pass before merging, once CI exists (M1).

If the plan changes or the repository becomes public, enable these as protection rules.

## Quality gates

[`.github/workflows/ci.yml`](../.github/workflows/ci.yml) runs on every pull request and on every push to `main`. It installs from the frozen lockfile and then runs these gates in order. A failing gate fails the run.

| Gate | Command | Status |
| --- | --- | --- |
| Lint | `pnpm lint` | In CI. Includes module-boundary rules, which a unit test proves. |
| Format check | `pnpm format:check` | In CI |
| Type check | `pnpm typecheck` | In CI. TypeScript strict mode. |
| Unit tests | `pnpm test` | In CI. Configuration validation, test-database safety checks, module boundaries, rating and slug rules. `DATABASE_URL` and `TEST_DATABASE_URL` are removed before unit tests run, so a unit test cannot reach a database. |
| Build | `pnpm build` | In CI, run without `DATABASE_URL` to prove that the build does not need a database |
| Schema consistency | `pnpm db:check`, then `pnpm db:generate` must produce no new migration | In CI. Fails when `src/db/schema.ts` changes without a committed migration. |
| Integration tests | `pnpm test:integration` | In CI, against a disposable PostgreSQL 17 service container with test credentials, marked as disposable by the same script as the local test database. Global setup applies the committed migrations first. Covers connectivity, test-database isolation, migrations and delete rules, the schema constraints ([coverage](data-model.md#validation)), transactions, the academic queries, and the database-level parts of INV-1 to INV-5. |
| HTTP tests | `pnpm test:http` | In CI, after the build and the integration tests, against the same disposable service database. The production build over real HTTP: studio access with and without a valid session, sign-in, cookies, sign-out, sign-up, origins, rate limiting, the author command, and the server log. |
| End-to-end smoke | Playwright | Planned. Critical studio and public flows in a browser. |

The workflow has read-only `permissions` (`contents: read`), a concurrency group per pull request or branch, a 20-minute timeout, and no secrets. Its PostgreSQL credentials belong to a disposable service container and are not secrets. Actions are pinned to full commit SHAs. It does not publish artifacts or deploy.

## Testing approach

- **Domain rules:** unit tests with no database.
- **Persistence and SQL:** integration tests against real PostgreSQL, in the disposable [test database](#test-database). Database behavior is not mocked: foreign keys, `CHECK` constraints, and transactions are exactly what these tests must prove. A rejection test asserts the SQLSTATE and the name of the constraint that fired (helpers in [`src/testing/`](../src/testing/)), so it cannot pass because of an unrelated error.
- **Invariants:** each of ADR 0002's INV-1 to INV-5 has database-level tests now; the HTTP-level parts are listed in [Security § Required tests](security.md#required-tests) and arrive with the routes.
- **Privacy:** the tests listed in [Security § Required tests](security.md#required-tests).
- **Authentication:** integration tests run the real Better Auth instance on the test transaction, through the real request handler, with real `Request` and `Response` objects ([`identity.integration.test.ts`](../src/modules/identity/identity.integration.test.ts)); the [HTTP tests](#http-tests) run the production server. Session checks are never mocked.
- **UI:** Playwright for complete flows, including keyboard operation of the rating input, the language menu, and dialogs. Run at desktop width and at 390px.
- **Fixtures:** synthetic and labeled `[Test]` ([`src/testing/fixtures.ts`](../src/testing/fixtures.ts)). They exist only inside rolled-back test transactions. Real writing never appears in tests, and nothing is seeded into the development database.

## Database changes

The schema lives in [`src/db/schema.ts`](../src/db/schema.ts), and Drizzle Kit writes versioned SQL migrations to [`src/db/migrations/`](../src/db/migrations/). Configuration: [`drizzle.config.ts`](../drizzle.config.ts). The model is described in [Data Model](data-model.md). The Claude Code skill [`refrain-db-change`](../.claude/skills/refrain-db-change/SKILL.md) walks through this procedure step by step: it classifies the change, verifies the target database, and tests the upgrade path on the disposable test database.

1. Change the Drizzle schema.
2. Run `pnpm db:generate --name=<what_changed>` and **read the generated SQL**.
3. Check for data loss: dropped columns, changed types, removed constraints on authored tables.
4. Run `pnpm test:integration`: global setup applies every migration to the empty test database, and the tests verify the result.
5. Run `pnpm db:migrate` against your local development database. Once it contains data, this also checks the migration against existing rows. Drizzle records applied migrations in `drizzle.__drizzle_migrations`.
6. Commit the schema change and the migration together, and describe the migration in the PR.

**Enumerated values.** Entry kinds, locales, visibility statuses, and artist kinds are defined once, as arrays in `src/db/schema.ts`, and their `CHECK` constraints are generated from them ([ADR 0003](decisions/0003-relational-schema-conventions.md)). To introduce a value, add it to the array and run `pnpm db:generate`: the migration drops the constraint and adds it again with the new list. To remove or rename a value, first migrate the rows that use it, then narrow the constraint.

**Backfills.** When a migration adds a constraint that existing rows might violate, add the backfill `UPDATE` to the generated SQL before the constraint, with a comment, and apply the migration to a database that holds rows from the earlier migrations (as `0002` was).

**Custom SQL.** For something Drizzle cannot declare (today: one deferrable constraint), run `pnpm db:generate --custom --name=<what>` and write the SQL into the empty file it creates. Comment the schema where the object lives, so readers of `schema.ts` know it exists.

**Applied migrations are permanent.** Never edit or delete a migration that has been applied anywhere outside a disposable test database. Fix mistakes with a new migration.

Never use `drizzle-kit push`: every schema change goes through a reviewed migration file. Migrations are never applied automatically to a production database; that procedure is written down when a deployment target exists.

## Documentation

- All repository documentation, code comments, commit messages, issues, and PR descriptions are in English. Interface strings are maintained in English and Brazilian Portuguese.
- When behavior changes, the relevant document changes in the same PR.
- A significant architectural or data decision gets an ADR in [`docs/decisions/`](decisions/).
- Write in present tense for what exists, and label planned functionality explicitly as planned.
