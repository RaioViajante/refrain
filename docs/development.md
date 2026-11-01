# Development

**Status:** the application foundation (M1.1), the relational domain (M1.2), identity and authorization (M1.3A), the catalog and album-journal screens (M1.3B), and recovery, browser tests, and the backup tool (M1.3C) exist: a Next.js application, a local PostgreSQL 17 database through Docker Compose, a separate disposable test database, the domain schema with versioned migrations, single-author authentication, a Writing Studio with catalog and private-journal CRUD and restoring a deleted journal, automated checks including browser tests, a backup and restore-check tool, and CI. There is no seed data: the development database holds only what you write into it ([Roadmap](roadmap.md)).

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

### Using the Writing Studio (M1.3B)

After [the author account exists](#first-time-setup-of-the-author-account), `pnpm dev` and sign in at `http://localhost:3000/studio`. Everything is private: nothing publishes, and there are no public pages yet. Typical first session, which is also the manual acceptance test:

1. **Artist.** Artists → *Add an artist* → a name, person or band → *Add artist*. (The MusicBrainz id is optional and only stored.)
2. **Album.** Albums → *Add an album* → a title, credit the artist (add more rows for more artists, reorder with ↑ ↓), optionally a year and the reference edition's label, date, and country → *Add album*. Titles need not be unique.
3. **Tracks.** On the album's page, under *Tracklist*: *Create and add* makes a new track at the end; *Add to album* links one you already have (a recording is never copied); ↑ ↓ reorder and *Remove* takes a track off this album only. Tracks can also be made on their own under Tracks.
4. **Journal.** Journals → *Write a journal* (or *Write a journal about this album* on the album page) → choose the language you write in, an opening sentence, and your reflection; a blank line starts a paragraph → *Save as draft*. Saving is explicit; Cmd or Ctrl+S works.
5. **Come back.** Leave, reopen the journal from Journals, *Edit this journal*, and the text is as you left it. Saving again checks that nobody saved in between; if another tab did, nothing is overwritten and your text stays in the box.
6. **Who can see it.** On the journal page, *Draft* or *Private*. Both are only yours; there is nothing to publish with yet.
7. **Delete, restore, and archive.** *Move to Recently deleted…* keeps the journal's writing in the database and takes it off your lists. Desk → *Recently deleted (n)*, or Journals → *Open Recently deleted*, lists what you moved; *Restore…* brings a journal back exactly as it was. A journal that was published when it was deleted comes back as **private**, and nothing is ever published by a restore. The studio does not delete permanently and nothing removes writing automatically. An artist, album, or track can be archived (hidden from pickers) or, only if nothing refers to it, deleted; otherwise the page says what still depends on it.
8. **Numbers.** The Desk and the lists show counts that PostgreSQL computed on that request ([evidence](evidence/m1-3b.md)).

*Sign out* ends the session; the journal's address then shows nothing private.

### Trying the Studio with synthetic data

Do this to see the journey without touching your own writing. It uses the disposable test database and a synthetic author, so your development database and your real account are never involved. Every value that matters is set on the command line, because `.env` points at the development database and Next.js and the author command would otherwise read it.

```sh
pnpm db:test:up                                   # the disposable test database
TESTURL=$(grep -E '^TEST_DATABASE_URL=' .env | cut -d= -f2-)   # read, never printed
pnpm build                                        # needs no database

# A synthetic author in the TEST database only (the password is a test value).
echo "[Test] correct horse battery staple" | \
  DATABASE_URL="$TESTURL" BETTER_AUTH_SECRET=$(openssl rand -base64 32) \
  BETTER_AUTH_URL=http://127.0.0.1:3400 REFRAIN_AUTHOR_EMAIL=author@example.com \
  pnpm --silent author:provision --target=127.0.0.1:5433/refrain_test

# The production build, against the test database.
DATABASE_URL="$TESTURL" BETTER_AUTH_SECRET=$(openssl rand -base64 32) \
  BETTER_AUTH_URL=http://127.0.0.1:3400 REFRAIN_AUTHOR_EMAIL=author@example.com \
  pnpm exec next start -H 127.0.0.1 -p 3400
```

Open `http://127.0.0.1:3400/studio`, sign in as `author@example.com` with that password, and follow [Using the Writing Studio](#using-the-writing-studio-m13b). When you are done, stop the server and discard everything with `pnpm db:test:down && pnpm db:test:up`.

The same journey, without a browser and with its negative cases, is what `pnpm test:http` runs: create an artist, an album, and tracks; reorder them; write a journal of several paragraphs; save; leave and return; edit and save again with every earlier paragraph still there; and see that every action is refused without the author's session. The same journey in a real browser is `pnpm test:e2e` ([Browser tests](#browser-tests)).

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
| `pnpm test:http` | HTTP tests of the production build: authentication, and every studio Server Action. Needs `pnpm build` first and the test database. Starts `next start` on `127.0.0.1` against `TEST_DATABASE_URL` only ([HTTP tests](#http-tests)). |
| `pnpm test:e2e` | Browser tests: builds, then runs Playwright against the production build, the disposable test database, and a synthetic author ([Browser tests](#browser-tests)) |
| `pnpm test:e2e:run` | The same without the build, for when `pnpm build` was just run (CI does this) |
| `pnpm design:strokes` | Regenerates `src/app/strokes.css`, the Studio's hand-drawn outlines, from `src/design/strokes.ts` (fixed seeds; a unit test fails if the file is stale) |
| `pnpm review:screens` | Builds, then captures the Studio's screens at 390, 768, 1280, 1440, and 2560 px into `visual-review/` (ignored by Git), from synthetic data on the disposable test database ([Visual review](design/studio-visual-fidelity.md#reproducing-the-review)) |
| `pnpm db:backup --target=<host>:<port>/<database> --output=<absolute path>` | Writes a new, owner-only `pg_dump` archive of a local database ([Backup and restore](#backup-and-restore)) |
| `pnpm db:backup:verify --file=<path> [--compare-with=<target>]` | Restores an archive into a new scratch database on the disposable test container and compares it with a source |
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

**Backup and restore of local data.** See [Backup and restore](#backup-and-restore) below. Dumps can contain writing and the author's password hash, and `*.dump` is ignored by Git. Keep them outside the repository.

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

**Concurrency tests commit, and clean up after themselves.** A race cannot be shown inside one transaction, so the `*concurrency*` and `slug-race` integration tests open several real connections ([`src/testing/concurrency.ts`](../src/testing/concurrency.ts)), commit synthetic `[Test] …` rows, and remove them in `afterAll` with the domain's own delete commands. Every connection first passes the server-side disposable-database check, and the helper requires the URL the worker setup pinned: it does not repeat the checks that would refuse, by design, once `DATABASE_URL` is the test URL. Counts in the other suites are relative to the start of each test (`inScratchTransaction`), so committed rows from another file cannot break them. If a run is interrupted, `pnpm db:test:down && pnpm db:test:up` gives an empty database.

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

[`src/testing/studio-actions.http.test.ts`](../src/testing/studio-actions.http.test.ts) calls each Server Action the way any client could, by its identifier from the build's manifest. It does not sign in, because sign-in is rate limited for all clients together and the authentication tests count their attempts: it mints sessions in the test database with the same HMAC signature the cookie carries ([`http-session.ts`](../src/testing/http-session.ts)), and removes them and its `[Test] HTTP …` rows when it finishes.

### Browser tests

`pnpm test:e2e` runs the Writing Studio in a real browser (Chromium, through [Playwright](https://playwright.dev) 1.64.1) against the **production build**, the **disposable test database**, and a **synthetic author**. Nothing reads or writes the development database or the owner's account, and no password of the owner's is ever needed.

```sh
pnpm db:test:up                            # the disposable test database (once)
pnpm exec playwright install chromium      # the browser (once; about 100 MB, kept outside the repository)
pnpm test:e2e                              # builds, then runs the suite
pnpm exec playwright show-report           # the HTML report of the last local run
```

**What the setup does** ([`e2e/global-setup.ts`](../e2e/global-setup.ts), sharing [`src/testing/production-server.ts`](../src/testing/production-server.ts) with `pnpm test:http`):

1. applies the same five safety checks to `TEST_DATABASE_URL` as the integration tests, including the server-side disposable marker, then the migrations;
2. refuses to start unless the identity tables are empty;
3. creates a synthetic author (`author@example.com`) with the real `pnpm author:provision` command, the password on standard input;
4. starts `next start` on `127.0.0.1:3410` in production mode with a random secret. **The port must be free**: if it is taken (a development server, an earlier run) the setup stops instead of reusing it. Set `E2E_PORT` to use another;
5. on the way out, removes the synthetic `[Test] E2E …` records and the author, then stops the server. `E2E_KEEP_DATA=1` keeps the records (to look at them, or to capture evidence); `pnpm db:test:down && pnpm db:test:up` discards everything.

**Isolation.**

- One worker, tests in a fixed order, each file creating the records it needs under a name of its own run (`[Test] E2E <run id> …`).
- Every test gets its own browser context. The `setup` project signs in once through the real form and stores the session in `playwright/.auth/author.json` for the authenticated projects. The `anonymous` project has no stored session, and some tests mint a session of their own in the test database (as the HTTP tests do) so that they can end it. **The file, `playwright-report/`, and `test-results/` are ignored by Git** and traces are off in CI: they can hold the synthetic session cookie.
- Sign-in is rate limited for all clients together (five a minute), so the suite signs in three times (once in setup, twice in `authentication.spec.ts`) and mints everything else.

**What is covered** (`e2e/`, 69 tests over four projects):

| File | Workflow |
| --- | --- |
| `authentication.spec.ts` | A visitor is sent to sign-in from every studio page; a wrong password is refused in words; the right one opens the studio with an `HttpOnly`, `SameSite=Strict` cookie; sign-out ends the session, also after "back" |
| `catalog.spec.ts` | Create an artist, an album credited to it, and tracks; reorder, remove, and add back; edit album, artist, and track; every change after a reload and in PostgreSQL; a real `DELETE` of an unused record and the refusal of one in use |
| `journal.spec.ts` | A private draft with several paragraphs and literal markup; leave and return to the exact text; edit one field without touching the others; a stale tab is refused as a conflict and keeps its text; draft and private, and no control to publish |
| `recovery.spec.ts` | Delete a journal, find it in Recently deleted, restore it with every word; a journal that was published returns private with its history; a second restore from a stale tab is refused in words; an editor opened before a delete and restore cannot overwrite newer writing |
| `negative.spec.ts` | An expired, revoked, forged, and tampered session; a session that ends while the author is writing (the save is refused in words, nothing is stored, the text stays); invalid input |
| `academic.spec.ts` | The AC-04 example (album, credited artist, linked tracks, private journal) read back with a JOIN, the aggregates, and a subquery; a change made in SQL appears in the interface |
| `layout.spec.ts` | The Studio's lateral contract, measured at 390, 768, 1280, 1440, and 2560 px: the shell is `min(100% - 35.2px, 1320px)` and centered, header, content, and footer share its edges, no Studio page scrolls sideways even with long names, the header is one row with two destinations at 360 to 2560 px, the writing keeps its measure on an ultrawide screen, the skip link works after client-side navigation, the navigation has a 2px focus ring and 44 px targets, and reduced motion stops every transition |
| `navigation.spec.ts` | The header has exactly two destinations, Desk and Catalog, on every page; which is current (Desk for the journals and their editors, Catalog for artists, albums and tracks); the Catalog's sections are always-visible links with the current one marked; every section is reachable by clicking and browser history works; navigation is client-side (no document request, the `window` survives); keyboard navigation raises no console, script, or hydration error; and a recorded known limitation, that focus is no longer on the activated link ([Studio visual fidelity](design/studio-visual-fidelity.md#navigation-investigation-issue-23)) |
| `accessibility.spec.ts` | axe-core (WCAG 2.0, 2.1 and 2.2, A and AA) on 16 Studio pages at 1280 and 390 px, the open dialog and sign-in, a canary that proves the scanner reports a broken element, the drawn boundary of the editor's inputs and Save button at rest, on hover and in focus (at least 3:1), and forced-colors emulation (real borders and no drawn image on the editor's controls, at rest, on hover and in focus). axe is a floor, not a verdict ([Accessibility notes](design/studio-visual-fidelity.md#accessibility-notes)) |
| `mobile.spec.ts` | At 390 px on a touch device: no page is wider than the screen, the main controls are at least 44 px, delete and restore work by touch |

There is no `sleep`: each test waits for something the application shows (a heading, a message, a URL). A flaky test is a bug, so there are no retries.

**Running one file or one project:** `pnpm exec playwright test e2e/recovery.spec.ts --project=desktop` (the `setup` project runs first by itself). Within a file, tests share state and run in order, so a single test of a file may need its predecessors. A failure prints Playwright's own call log; `E2E_KEEP_SERVER_LOG=1` copies the server log to `test-results/server.log`.

**Not covered:** real HTTPS, Firefox and WebKit, and anything public (there are no public pages). CI runs Chromium only.

### Backup and restore

The development database holds the author's writing. This is a local, manual procedure for backing it up, and for proving that a backup can be restored. It protects against a damaged database or a mistake, **not** against losing the machine or the Docker volume: that needs a copy elsewhere.

**What a backup holds.** The whole database: the writing, the catalog, the author's account including the **password hash**, and the migration history. It leaves out the data of `auth_sessions`, `auth_verifications`, and `auth_rate_limits`, so a stolen backup cannot be replayed as a session. It holds no `BETTER_AUTH_SECRET` (that lives in `.env`, which is **not** backed up: keep it in your password manager, or the author signs in again after a restore with a new secret). Treat a backup like the writing itself.

**Make a backup.** Name the database explicitly. The tool refuses unless the target is exactly what `DATABASE_URL` (or `TEST_DATABASE_URL`) resolves to, on a loopback host.

```sh
umask 077
mkdir -p ~/refrain-backups && chmod 700 ~/refrain-backups
pnpm db:backup --target=127.0.0.1:5432/refrain --output="$HOME/refrain-backups/refrain-$(date +%Y%m%d-%H%M%S).dump"
```

- It runs PostgreSQL 17's own `pg_dump` **inside the Compose container**, over its local socket: no host installation, and no password on any command line, in the environment of a command, or in any output.
- The target must also be the container that publishes that port (`docker compose port`), so a different local PostgreSQL with a database of the same name is not mistaken for it.
- The file must be a **new** path, absolute, in an existing directory **outside the repository** (a symbolic link into it is refused). It is created with permissions `0600`, next to a `.sha256` of the same mode. A failed run, or one interrupted by Ctrl-C or SIGTERM, removes only the file it created (closing the terminal or killing the process outright can leave a partial `.dump`, owner-only, which is never valid and which the tool will not reuse: delete it by hand), and a checksum file that already exists makes the run refuse. Nothing is ever overwritten, cleaned, or dropped.
- The command says **NOT verified**. A backup is not valid until it has been restored.

**Prove it restores.** This restores into a **new scratch database on the disposable test container**, never over an existing database and never into the development database, and compares it with the source:

```sh
pnpm db:test:up
pnpm db:backup:verify --file="$HOME/refrain-backups/refrain-20261101-120000.dump" --compare-with=127.0.0.1:5432/refrain
pnpm db:test:down        # discards the scratch database
```

`--file` must be a backup you made: restoring runs its contents as SQL, as the database superuser, on the disposable container. The archive is first copied to a private temporary file (removed when the command ends, including on Ctrl-C, SIGTERM, or a closed terminal; a run that is killed outright, with SIGKILL, can leave a `refrain-verify-…` folder in the temporary directory, which you delete by hand), and the checksum, the listing, and the restore all read that one copy. If a `.sha256` file sits next to the archive it must match, or nothing is restored (this catches damage and edits, not a file that was hostile from the start). The archive is then listed and refused if it is not a valid `pg_dump` archive. The restore runs as one transaction that stops at the first error. The check then confirms that every table of the restored copy is accounted for, that the three tables whose rows a backup leaves out (`auth_sessions`, `auth_verifications`, `auth_rate_limits`) came back empty, and, with `--compare-with`, compares the source and the restored copy table by table: the row count and a digest over the full text of every row of the **19 tables** that hold the writing, its status and publication history, deletion and versions, the slugs and their marks, the catalog, the reflections and memories (not built yet, so empty), and the author's account including the password hash. The digests are computed in PostgreSQL and never printed. The migration count must match too. Any difference fails. A table that the tool neither compares nor deliberately excludes also fails, so a table added later cannot be silently left out. Without `--compare-with` it claims only that the archive restored without error. The comparison reads the source with `SELECT` only. Run it right after the backup, with nothing saved in the studio in between: a later save is a real difference, and the check will report it.

**Before the first backup: encrypt this disk.** The archive is not encrypted, and it holds private writing and the password hash. Turn on FileVault (check with `fdesetup status`, which must say `FileVault is On`) before creating one. If encryption is still in progress, wait for it to finish. Git ignoring `*.dump` is not a security boundary. Time Machine copies `~/refrain-backups` too, so its destination must be encrypted as well, or the folder excluded.

**Keep copies elsewhere.** A backup that exists only on this Mac does not survive losing the Mac. Copy the verified `.dump` and its `.sha256` to somewhere that is not this device and not this Docker volume, and encrypt it first:

- **Preferred:** an external drive formatted as encrypted APFS, or an encrypted APFS disk image (Disk Utility, AES-256) that you then copy to a destination you control. The passphrase is typed into the system prompt: never on a command line, in a file, or in an environment variable. Keep it in your password manager, not on the same drive.
- **Avoid as a long-term format:** a bare `openssl enc -aes-256-cbc` file. It detects no tampering by itself, so it needs a separate checksum, and it is easy to get wrong.
- Never upload a backup to a service automatically, and never put one in the repository, an issue, a pull request, or a chat. Delete old backups you no longer need from every place you copied them.

Then prove the second copy is usable: mount or open it, run `shasum -a 256 -c` against the `.sha256` that sits next to it, and run `pnpm db:backup:verify --file=<copy> --compare-with=127.0.0.1:5432/refrain` on a copy of the archive. Until that has been done, the off-device copy is incomplete and the backup protects only against a damaged database, not against losing the machine.

**Encrypted image in iCloud Drive (the procedure that was used).** The password is entered only in system dialogs, never in a terminal, a file, an environment variable, or a chat.

1. In Disk Utility, choose File → New Image → Blank Image. Use APFS, 256-bit AES encryption, a single GUID partition, the read/write format, and about 100 MB. Save it in a private folder (`0700`) that is **outside the repository and outside iCloud Drive**. Generate the password in your password manager and save it there first, so that losing this Mac does not lose it. Do not tick "Remember password in my keychain". Without the password the copy is unreadable and cannot be recovered.
2. Copy (never move) the `.dump` and its `.sha256` into the mounted volume. Check `shasum -a 256 -c` and `cmp` against the originals from inside the image, check that nothing else is in it, and eject.
3. With the image closed, confirm `hdiutil isencrypted <image>` reports `encrypted: YES` (the key length, 256 bits, is in the image header), then write `<image>.sha256` with `shasum -a 256`. **Mounting a read/write image changes its bytes**, so regenerate this checksum after every mount. Mount read-only if the file must stay byte-identical.
4. Copy only the closed `.dmg` and its `.sha256` into a private iCloud Drive folder. Never mount the image from inside iCloud Drive, and never put the plaintext `.dump` there. Edit nothing in the synchronized copy: mount a local copy instead.
5. Prove recovery from a copy **downloaded from iCloud.com** into a private folder outside the repository and outside iCloud Drive: `shasum -a 256 -c` the image, confirm it is encrypted, unlock it through the system dialog, check the contained `.dump` against its `.sha256`, run `pnpm db:backup:verify --file=<dump> --compare-with=127.0.0.1:5432/refrain` (the exit code must be `0`), eject, run `pnpm db:test:down`, and delete only that disposable download. A copy of the file on this Mac's iCloud folder is **not** evidence that it reached iCloud: the macOS sync service reports no per-file upload status.

iCloud Drive is synchronization, not versioned or offline backup. A file that is deleted or overwritten there is deleted or overwritten on every device. Keep a second, offline copy of the same encrypted image (for example on an encrypted external drive) and make a new image, with a new timestamp, for each later snapshot.

**Status of the real data.** On 2026-11-01 the first backup of the author's development database was made with the commands above, with FileVault on. It was 57,005 bytes, in a `0700` directory with `0600` files. `shasum -c` passed, and `db:backup:verify --compare-with` restored it into a new scratch database on the disposable container and found all 19 compared tables and the migration count equal to the source, with the three excluded tables empty. Row counts of the development database were the same before and after, and `pnpm db:test:down` removed the scratch database. Later that day an AES-256 encrypted APFS image holding that backup was copied to iCloud Drive. A copy downloaded from iCloud.com was byte-identical to the image that was uploaded, its checksum matched, and after unlocking it the contained backup matched its checksum and passed `db:backup:verify --compare-with` with exit code `0` (all 19 tables and the migration count equal, the three excluded tables empty), with the development database unchanged. This is **one snapshot in one provider**: there is no offline second copy and no versioning yet, and a later change to the database is not in it.

**Recovering after a loss.** Restoring a backup into the development database is deliberate and manual; the tool will not do it, and this has **not** been done with the owner's data. Restore into a **new** database, check it, then point the application at it:

1. Stop the application. Make one more backup of whatever remains.
2. Create a new, empty database (a name that does not exist): `docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d postgres -c "create database refrain_recovered"'`.
3. Restore into it, with no `--clean`: `docker compose exec -T postgres sh -c 'pg_restore --no-owner --no-privileges --exit-on-error --single-transaction -U "$POSTGRES_USER" -d refrain_recovered' < /path/to/refrain.dump`.
4. Point `DATABASE_URL` in `.env` at `refrain_recovered`, start the application, and check your journals. Sign in again (sessions are not in a backup).
5. Keep the damaged database until you are sure. Remove it only by an explicit decision.

**What this does not do.** It is not scheduled, it does not copy anywhere, it is not encrypted (the disk's encryption is what protects it), it does not back up `.env`, and it has been tried only on the owner's small, early development database, not on a large one. Automatic purge stays disabled until backups are scheduled and a restore has been tested on real data ([ADR 0002](decisions/0002-domain-model-decisions.md), D4.4).

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
| `@playwright/test` | 1.64.1 | Browser tests (M1.3C). Published 2026-10-14, older than the seven-day minimum. Chromium is downloaded by `playwright install`, not by the package. |
| `@types/node` | 24.19.2 | Matches the Node.js major version |
| `@types/react`, `@types/react-dom` | 19.3.0 | |
| PostgreSQL image | `postgres:17.11-trixie` | Same image locally and in CI |

Planned dependencies (Tiptap, next-intl, Rough.js) are added with the features that need them, after the same compatibility check.

`pnpm audit` reports two moderate advisories (unchanged by M1.3C, which added Playwright with none), both in development tools and both present before M1.3A: esbuild in `drizzle-kit` (development-server CORS), and minimatch in `eslint-config-next` (pattern denial of service). Neither runs in the application or receives untrusted input.

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
| HTTP tests | `pnpm test:http` | In CI, after the build and the integration tests, against the same disposable service database (and before the browser tests, which need the identity tables empty). The production build over real HTTP: studio access with and without a valid session, sign-in, cookies, sign-out, sign-up, origins, rate limiting, the author command, and the server log. |
| Dependency audit | `pnpm audit --audit-level=high` | In CI (M1.3C). High and critical advisories fail the run; the two moderate advisories listed under [Toolchain](#toolchain) are in development tools and are reviewed, not hidden. |
| Browser tests | `pnpm exec playwright test` | In CI (M1.3C), after `playwright install --with-deps chromium`: the production build in Chromium against the same disposable service database ([Browser tests](#browser-tests)). Public flows arrive with the public pages. |

The workflow has read-only `permissions` (`contents: read`), a concurrency group per pull request or branch, a 20-minute timeout, and no secrets. Its PostgreSQL credentials belong to a disposable service container and are not secrets. Actions are pinned to full commit SHAs. It does not publish artifacts or deploy.

## Testing approach

- **Domain rules:** unit tests with no database.
- **Persistence and SQL:** integration tests against real PostgreSQL, in the disposable [test database](#test-database). Database behavior is not mocked: foreign keys, `CHECK` constraints, and transactions are exactly what these tests must prove. A rejection test asserts the SQLSTATE and the name of the constraint that fired (helpers in [`src/testing/`](../src/testing/)), so it cannot pass because of an unrelated error.
- **Invariants:** each of ADR 0002's INV-1 to INV-5 has database-level tests now; the HTTP-level parts are listed in [Security § Required tests](security.md#required-tests) and arrive with the routes.
- **Privacy:** the tests listed in [Security § Required tests](security.md#required-tests).
- **Authentication:** integration tests run the real Better Auth instance on the test transaction, through the real request handler, with real `Request` and `Response` objects ([`identity.integration.test.ts`](../src/modules/identity/identity.integration.test.ts)); the [HTTP tests](#http-tests) run the production server. Session checks are never mocked.
- **Studio actions:** the HTTP suite above, plus the static check that every action authorizes first ([Security § Authorization contract](security.md#authorization-contract)). The same journey runs in a real browser in [`pnpm test:e2e`](#browser-tests) (M1.3C).
- **UI:** Playwright for complete flows ([Browser tests](#browser-tests)), at desktop width and at 390px. Keyboard operation of the rating input and the language menu arrives with them. A defect that only a browser exposed (a form that threw on submit in the production build) is why these tests exist.
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
