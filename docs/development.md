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

There is no database status page: the placeholder at `/` that showed one was removed in M3.1, because `/` is public ([evidence](evidence/m3-1.md#public-release-gates)). `docker compose ps postgres` shows whether PostgreSQL is running and healthy; the Writing Studio at `/studio` needs it.

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
| `BETTER_AUTH_SECRET` | Server code, the author command | Signs session cookies, and is the input from which the publication confirmation key is derived (HKDF, a distinct purpose string). At least 32 characters of random data; [generate it](#authentication). A secret: never commit it, never reuse it between environments. Replacing it signs the author out and invalidates every outstanding confirmation token, which costs nothing: a token lives 15 minutes. |
| `BETTER_AUTH_URL` | Server code, the author command | The application's origin, for example `http://localhost:3000`. HTTPS is required unless the host is `localhost`, `127.0.0.1`, or `[::1]`. Only this origin may send state-changing requests. |
| `REFRAIN_AUTHOR_EMAIL` | Server code, the author command | The single author's email address. Only the account with this email is authorized in the studio. |
| `REFRAIN_PUBLIC_READS_ENABLED` | Server code only (the proxy, the public page, the sitemap, `robots.txt`) | **Off unless it is exactly `true`.** Unset, empty, `TRUE`, `1`, `yes`, a value with stray whitespace (for example `true ` from an `.env` file: it fails closed, silently), and every other value leave every public address answering the unknown-address `404`. It is read when a request is served, never at build time, and it is never a `NEXT_PUBLIC_` variable. It can hide public content and can never reveal any: with it on, every read still goes through the publication predicate. **Never switch it on in a deployment that anyone else can reach** until the [public page release gates](security.md#public-page-release-gates) are closed. [`.env.example`](../.env.example) leaves it off. |
| `REFRAIN_COVER_DISPLAY_ENABLED` | Server code only (every page that shows an album cover) | Whether this server may show album covers: the real covers are the intended look, and this is the operational control for authorizing and taking them down ([Security § Deployment gate](security.md#deployment-gate), item 6). **On only when it is exactly `true`; off unless set.** Off, every page shows the fallback frame instead of a cover, no browser asks the Cover Art Archive for anything, a cover cannot be chosen, and every stored cover is kept unchanged; on, it publishes nothing. **For `pnpm dev`, put `REFRAIN_COVER_DISPLAY_ENABLED=true` in `.env.development.local`** (Git ignores it), then restart the server. Not in `.env` or `.env.local`: `next start`, which the HTTP and browser tests run, reads those two, and `.env.development.local` only `next dev` reads. To see covers from a local production build, set it on the command line: `REFRAIN_COVER_DISPLAY_ENABLED=true pnpm start`. The test servers set it to the empty string unless a test sets it. Never set it on a hosted deployment before the owner records the item 6 review. Not a secret, and never a `NEXT_PUBLIC_` variable. |
| `REFRAIN_MUSICBRAINZ_BASE_URL`, `REFRAIN_COVER_ART_ARCHIVE_BASE_URL` | Server code only (Add music, M3.2) | **Unset in normal use**, which means the real MusicBrainz (`https://musicbrainz.org/ws/2/`) and Cover Art Archive. They exist so the tests can point the server at a local mock ([`provider-mock.ts`](../src/testing/provider-mock.ts)); the only other value accepted is plain HTTP on `127.0.0.1`, `localhost`, or `[::1]`, without credentials or a query. Any other value turns the provider off, and the studio says it couldn't reach it. Neither is a secret, and neither is a `NEXT_PUBLIC_` variable. |
| `REFRAIN_WIKIMEDIA_COMMONS_BASE_URL`, `REFRAIN_WIKIDATA_BASE_URL` | Server code only (artist photographs, M3.3) | **Unset in normal use**, which means the real Action APIs (`https://commons.wikimedia.org/w/` and `https://www.wikidata.org/w/`). The same rule as above: the tests point them at the local mock, and the only other value accepted is plain HTTP on a loopback address; anything else turns the provider off. Not secrets, not `NEXT_PUBLIC_`. |

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

Expect `6` migrations (0000 to 0005), then `auth_accounts auth_rate_limits auth_sessions auth_users auth_verifications`. Migrations only add what is pending and never seed data.

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
3. Sign in with the right one. The studio opens the Desk.
4. Choose "Sign out". You are back on the sign-in page.
5. Open `/studio` again. You are sent to sign-in again.

Five sign-in attempts a minute are allowed, for everyone together.

**Change or recover the password.** With access to the database:

```sh
pnpm author:reset-password --target=127.0.0.1:5432/refrain
```

It replaces the password and signs out every session. There is no password reset by email, and no recovery over HTTP.

### Using the Writing Studio (M1.3B)

After [the author account exists](#first-time-setup-of-the-author-account), `pnpm dev` and sign in at `http://localhost:3000/studio`. Everything is private by default: publishing marks a version as published in your records, and a public page for it opens only where [`REFRAIN_PUBLIC_READS_ENABLED`](#configuration) is `true`, which no default configuration sets. Typical first session, which is also the manual acceptance test:

1. **Artist.** Artists → *Add an artist* → a name, person or band → *Add artist*. (The MusicBrainz id is optional; saving the form only stores it. [Add music](#add-music-m32) fills it in when you add or link from MusicBrainz.)
2. **Album.** Albums → *Add an album* → a title, credit the artist (add more rows for more artists, reorder with ↑ ↓), optionally a year and the reference edition's label, date, and country → *Add album*. Titles need not be unique.
3. **Tracks.** On the album's page, under *Tracklist*: *Create and add* makes a new track at the end; *Add to album* links one you already have (a recording is never copied); ↑ ↓ reorder and *Remove* takes a track off this album only. Tracks can also be made on their own under Tracks.
4. **Journal.** Journals → *Write a journal* (or *Write a journal about this album* on the album page) → choose the language you write in, an opening sentence, and your reflection; a blank line starts a paragraph → *Save as draft*. Saving is explicit; Cmd or Ctrl+S works.
5. **Come back.** Leave, reopen the journal from Journals, *Edit this journal*, and the text is as you left it. Saving again checks that nobody saved in between; if another tab did, nothing is overwritten and your text stays in the box.
6. **Who can see it, and publishing.** On the journal page, each language version has its own *Visibility* panel. *Draft* and *Private* are only yours. **Publish…** opens a review of exactly what readers would see (the opening sentence, the reflection, the address, the album rating, and every track reflection included when published, with its track and language) and what stays private; nothing changes until you press *Publish the English version* in it. The review itself changes nothing: to change which reflections are shown, go to the tracks (it links there), save, and review again. If something changed since you opened the review, nothing is published and you are asked to review it again. **Unpublish…** asks first and keeps your writing. Publishing marks the version as published in your records; **a public page appears only where `REFRAIN_PUBLIC_READS_ENABLED` is `true`** ([Public page tests](#public-page-tests-m31)), which no default configuration sets. Saving a change to a published journal shows what would change, before and after, and saves only when you confirm it.
7. **Delete, restore, and archive.** *Move to Recently deleted…* keeps the journal's writing in the database and takes it off your lists. Desk → *Recently deleted (n)*, or Journals → *Open Recently deleted*, lists what you moved; *Restore…* brings a journal back exactly as it was. A journal that was published when it was deleted comes back as **private**, and nothing is ever published by a restore. The studio does not delete permanently and nothing removes writing automatically. An artist, album, or track can be archived (hidden from pickers) or, only if nothing refers to it, deleted; otherwise the page says what still depends on it.
8. **Numbers.** The Desk and the lists show counts that PostgreSQL computed on that request ([evidence](evidence/m1-3b.md)).

*Sign out* ends the session; the journal's address then shows nothing private.

### Trying the Studio with synthetic data

Do this to see the journey without touching your own writing. It uses the disposable test database and a synthetic author, so your development database and your real account are never involved. Every value that matters is set on the command line, because `.env` points at the development database and Next.js and the author command would otherwise read it.

```sh
pnpm db:test:up                                   # the disposable test database
TESTURL=$(grep -E '^TEST_DATABASE_URL=' .env | cut -d= -f2-)   # read, never printed
DATABASE_URL="$TESTURL" pnpm db:migrate           # creates the tables if the test database is new; otherwise a no-op
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

Open `http://127.0.0.1:3400/studio` (exactly this origin: it is `BETTER_AUTH_URL`), sign in as `author@example.com` with that password, and follow [Using the Writing Studio](#using-the-writing-studio-m13b). When you are done, stop the server and discard everything with `pnpm db:test:down && pnpm db:test:up`.

Each `next start` above gets a new secret, so restarting the server signs the author out. For the academic presentation, which restarts the server on purpose and must not lose its session, use the [M4 runbook](evidence/m4.md#local-environment-runbook) instead: one terminal pointed only at the test database, one throwaway secret kept across restarts, and the order in which tests and the demonstration share that database.

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
| `pnpm test:backup` | The hosted-backup toolchain (`ops/backup/`) end to end on scratch databases of the disposable **PostgreSQL 18** server: builds the tools image, then dumps, restores, encrypts, drills, and checks the refusals. Needs Docker and `pnpm db:test18:up`, with `TEST_DATABASE_URL` pointing at port 5434 ([Hosted Backups](hosted-backups.md)) |
| `pnpm test:http` | HTTP tests of the production build: authentication, and every studio Server Action. Needs `pnpm build` first and the test database. Starts `next start` on `127.0.0.1` against `TEST_DATABASE_URL` only ([HTTP tests](#http-tests)). |
| `pnpm test:e2e` | Browser tests: builds, then runs Playwright against the production build, the disposable test database, and a synthetic author ([Browser tests](#browser-tests)) |
| `pnpm test:e2e:run` | The same without the build, for when `pnpm build` was just run (CI does this) |
| `pnpm design:strokes` | Regenerates `src/app/strokes.css`, the Studio's hand-drawn outlines, and both copies of the rating star (`star-ink.tsx`), from `src/design/strokes.ts` (fixed seeds; a unit test fails if the file is stale) |
| `pnpm review:screens` | Builds, then captures the Studio's screens at 390, 768, 1280, 1440, and 2560 px into `visual-review/` (ignored by Git), from synthetic data on the disposable test database ([Visual review](design/studio-visual-fidelity.md#reproducing-the-review)) |
| `pnpm db:backup --target=<host>:<port>/<database> --output=<absolute path>` | Writes a new, owner-only `pg_dump` archive of a local database ([Backup and restore](#backup-and-restore)) |
| `pnpm db:backup:verify --file=<path> [--compare-with=<target>] [--postgres=18]` | Restores an archive into a new scratch database on the disposable test container (PostgreSQL 17, or the 18 one with `--postgres=18`) and compares it with a source |
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

| | Development database | Test database | Test database, PostgreSQL 18 |
| --- | --- | --- | --- |
| Compose service | `postgres` | `postgres-test` (profile `test`; `pnpm db:up` does not start it) | `postgres-test-18` (profile `test-18`) |
| Image | `postgres:17.11-trixie` | `postgres:17.11-trixie` | `postgres:18.6-trixie` |
| Host port | `127.0.0.1:5432` | `127.0.0.1:5433` | `127.0.0.1:5434` |
| User / database | `refrain` / `refrain` | `refrain_test` / `refrain_test` | `refrain_test` / `refrain_test` |
| Storage | Named volume `refrain_postgres-data` | In memory (`tmpfs`). Discarded whenever the container stops. | The same |
| Read through | `DATABASE_URL` | `TEST_DATABASE_URL` | `TEST_DATABASE_URL`, set for that run |

**Supported PostgreSQL versions: 17 and 18** (issue #61). PostgreSQL 17 is the local default (Compose, the academic demonstration). PostgreSQL 18 is the hosted database's major version. CI runs the integration and HTTP tests on both. The one behavior that differs is how a foreign key reports a refused delete: PostgreSQL 17 reports `23503` (`foreign_key_violation`); PostgreSQL 18 reports a refusal by an `ON DELETE RESTRICT` key as `23001` (`restrict_violation`). `isReferencedRowRefusal` in [`src/db/errors.ts`](../src/db/errors.ts) recognizes both, and tests expect the exact code of the server they run on (`restrictedDeleteCode` in [`src/testing/database.ts`](../src/testing/database.ts)). Another major version is supported only after the suites pass on it and [`src/db/client.integration.test.ts`](../src/db/client.integration.test.ts) lists it. In CI each job also sets `EXPECTED_POSTGRES_MAJOR` (`17` or `18`), and that test fails if the job's server is any other version, so neither version's coverage can disappear silently.

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

The same suites on PostgreSQL 18, without touching `postgres-test`:

```sh
pnpm db:test18:up
TEST_DATABASE_URL=postgres://refrain_test:refrain-test-local-only@127.0.0.1:5434/refrain_test pnpm test:integration
pnpm db:test18:down
```

The HTTP and browser tests take the same `TEST_DATABASE_URL` override. They refuse a database whose identity tables already hold an account, such as the academic demonstration's: use a fresh test database for them, never that one.

**Recovery.** If the test database is in a bad state, run `pnpm db:test:down` and `pnpm db:test:up`: the new container starts empty and marked. This never affects the development database or its volume.

### HTTP tests

`pnpm test:http` tests the production build over real HTTP ([`src/modules/identity/studio.http.test.ts`](../src/modules/identity/studio.http.test.ts)). Its global setup ([`src/testing/http-global-setup.ts`](../src/testing/http-global-setup.ts)):

1. applies the same five safety checks to `TEST_DATABASE_URL`, then the migrations;
2. refuses to start unless the identity tables are empty, so it never touches identity rows it did not create;
3. creates a synthetic author (`author@example.com`) with the real `pnpm author:provision` command, the password on standard input;
4. starts `next start` on `127.0.0.1` and a free port, in production mode, with a random secret, and with `DATABASE_URL` set to the test database's URL.

Every test server (HTTP and browser) is also given a local MusicBrainz and Cover Art Archive mock, started by the same helper, so **no test calls the real services**. It answers from synthetic `[Test]` fixtures ([`provider-fixtures.ts`](../src/testing/provider-fixtures.ts)), offers an unreachable and a nothing-found search (`[test] unreachable`, `[test] gracce`), follows the archive's redirect pattern, and records the path, User-Agent, and time of every request at `/__requests`, which the HTTP tests read. Browser tests answer the browser's own cover-image requests with a generated test image; no real artwork is ever loaded or committed.

The server uses its own connections, so these rows are committed, unlike the integration tests' rolled-back transactions. Teardown stops the server and deletes the identity rows. If a run is interrupted, reset the test database with `pnpm db:test:down && pnpm db:test:up`. Run the HTTP and integration tests one after the other, not at the same time: the database holds at most one account.

[`src/testing/studio-actions.http.test.ts`](../src/testing/studio-actions.http.test.ts) calls each Server Action the way any client could, by its identifier from the build's manifest. It does not sign in, because sign-in is rate limited for all clients together and the authentication tests count their attempts: it mints sessions in the test database with the same HMAC signature the cookie carries ([`http-session.ts`](../src/testing/http-session.ts)), and removes them and its `[Test] HTTP …` rows when it finishes.

### Public page tests (M3.1)

The public album-journal page has three layers of tests, all against synthetic data (the Grace / Jeff Buckley catalog facts, every piece of writing labelled `[Test]`, and private markers that must appear nowhere):

| Layer | Command | What it shows |
| --- | --- | --- |
| Unit and static scans | `pnpm test` | The switch over every near-miss value; the read model's pure parts; the allow-listed renderer; [`src/app/public-surface.test.ts`](../src/app/public-surface.test.ts) (imports, the switch before every read, no cache directive) |
| PostgreSQL | `pnpm test:integration` | [`public-album-journal.integration.test.ts`](../src/modules/publication/public-album-journal.integration.test.ts): the read model against an independent oracle over 384 states, the projection's keys, the sitemap against slug resolution, and the routing decision |
| Production build over HTTP | `pnpm build && pnpm test:http` | [`public-album-journal.http.test.ts`](../src/testing/public-album-journal.http.test.ts) starts the one build several times, each with its own value of the switch and with no author, and compares every address that is not served with an unknown one; [`public-transitions.http.test.ts`](../src/testing/public-transitions.http.test.ts) changes state with the real commands and requests the next page at once; [`public-request-forms.http.test.ts`](../src/testing/public-request-forms.http.test.ts) covers prefetch and segment-prefetch requests, the `.rsc`, `.segments`, `.json`, and `/_next/data` forms, crawler user agents, path variants, conditional and range requests, and every surface and method with the switch off |
| Browser | `pnpm test:e2e` | [`e2e/public.spec.ts`](../e2e/public.spec.ts) at 1440 px and 390 px, from a second server of the same build with the switch on (the studio's server keeps it off). `E2E_SCREENSHOTS=1` writes screenshots to `visual-review/m3-1/`, which Git ignores |

**The Home (M3.4)** adds to each layer: the facade's switch in `public.test.ts`; both of its lists against the same oracle, and [`public-home.integration.test.ts`](../src/modules/publication/public-home.integration.test.ts); [`public-home.http.test.ts`](../src/testing/public-home.http.test.ts), which starts five servers of one build and needs a test database with no public journal (reset it with `pnpm db:test:down && pnpm db:test:up` if a run was interrupted); and [`e2e/home.spec.ts`](../e2e/home.spec.ts) at 1440 px and 390 px (projects `home-desktop` and `home-390`), where `E2E_SCREENSHOTS=1` writes to `visual-review/m3-4/`. For screenshots with the seeded dates, run those two projects alone (`pnpm test:e2e:run --project=home-desktop --project=home-390`): other tests publish Grace again, which dates it today.

**The artist pages (M3.5)** add [`artist-address.test.ts`](../src/modules/publication/artist-address.test.ts) and the scans' new rules; [`public-artist.integration.test.ts`](../src/modules/publication/public-artist.integration.test.ts) (the visibility rule against its own oracle over 48 states) and the photograph guard in [`photos.integration.test.ts`](../src/modules/catalog/photos.integration.test.ts); [`public-artist.http.test.ts`](../src/testing/public-artist.http.test.ts), which starts five servers of one build; and [`e2e/artist.spec.ts`](../e2e/artist.spec.ts) at 1440 px and 390 px (projects `artist-desktop` and `artist-390`), which seeds and removes its own artists, and where `E2E_SCREENSHOTS=1` writes to `visual-review/m3-5/`, including a comparison sheet with the Home and the album journal (`pnpm test:e2e:run --project=artist-desktop --project=artist-390`).

**The Home's memories and artists (M3.8b)** add to the same files: [`public-home.integration.test.ts`](../src/modules/publication/public-home.integration.test.ts) gains the sections against the archives, the hidden states, and the snapshot (over real connections, committing its rows and removing them); [`public-home.http.test.ts`](../src/testing/public-home.http.test.ts) gains a hidden-only and a populated phase; [`e2e/home.spec.ts`](../e2e/home.spec.ts) seeds the memory and artist fixtures for its last tests. `E2E_SCREENSHOTS=1` also writes `visual-review/m3-8b/`, which Git ignores.

The browser and HTTP tests seed their journals through [`src/testing/public-seed-cli.ts`](../src/testing/public-seed-cli.ts) and [`public-journals.ts`](../src/testing/public-journals.ts); both touch only the disposable test database, after its safety checks.

### Add music (M3.2)

With `pnpm dev`, the Catalog's **Add music** searches the real MusicBrainz from the server, one request per 1.1 seconds for the whole process, identified as `Refrain/<version> ( https://github.com/RaioViajante/refrain )`. Search for an album, choose an edition, review what will be added, choose a cover or none (with `REFRAIN_COVER_DISPLAY_ENABLED=true` in `.env.development.local`; without it the review lists the covers as text and the album is added without one), and approve; or link an album you already have. Nothing is published by adding music, and nothing already in the catalog is changed. If MusicBrainz is unreachable, the studio says so and everything else keeps working. Keep live use light: MusicBrainz asks for no more than one call per second and no automated polling. The tests never call it ([HTTP tests](#http-tests)).

### Artist photographs (M3.3)

**Migration `0005` first.** M3.3 adds three nullable columns to `artists` (the photograph's provenance). Apply it to your development database yourself, after a backup ([Local database](#local-database)): `pnpm db:migrate`. It fails as a whole, changing nothing, if an artist already holds a photograph that was written outside the studio; clear those columns first. Nothing in the tests touches the development database.

With `pnpm dev`, an artist's page has a **Photograph** section. **Choose from Wikimedia Commons…** opens a page that searches Commons from the server (requests in series, one start per 500 ms, identified like MusicBrainz) and, for an artist linked to MusicBrainz, shows suggestions through Wikidata. Only files with an accepted license and a named creator are offered; open one to review its credit, source, license, and version, then **Use this photograph** or **Cancel**. The photograph page also tells you if the file on Commons has changed since you chose it, and removes a photograph after a confirmation. Since M3.5 the public artist page shows it (with public reads on); while that page is public the photograph can be removed but not replaced. The tests never call Wikimedia ([HTTP tests](#http-tests)); keep live use light.

### Memories (M3.6)

No migration: memories use tables that exist since M1.2. With `pnpm dev`, the Desk and the new **Memories** page (`/studio/memories`) have **Write a memory**, and a track's page has **Write a memory about this song**, which starts the memory with that recording. A memory is saved only with Save (or Cmd/Ctrl+S); its songs come from your catalog (the field matches titles, artists, and albums), and it can be draft or private, deleted, and restored. Since M3.7, **Publish…** shows what will be published and publishes on your confirmation, a change to a published memory asks first, and **Unpublish…** takes it away again; the page is `/memories/<slug>`, served only where `REFRAIN_PUBLIC_READS_ENABLED=true` (see [Public page tests](#public-page-tests-m31)).

Tests: [`memories.integration.test.ts`](../src/modules/journals/memories.integration.test.ts) and [`memories.concurrency.integration.test.ts`](../src/modules/journals/memories.concurrency.integration.test.ts) (`pnpm test:integration`); the memory section and the visitor table of [`studio-actions.http.test.ts`](../src/testing/studio-actions.http.test.ts) (`pnpm test:http`); and [`e2e/memories.spec.ts`](../e2e/memories.spec.ts) in the `desktop` project and again in `memories-390`, where `E2E_SCREENSHOTS=1` writes to `visual-review/m3-6/` (`pnpm build && E2E_SCREENSHOTS=1 pnpm test:e2e:run --project=desktop --project=memories-390`).

M3.7 adds [`memory-publishing.integration.test.ts`](../src/modules/journals/memory-publishing.integration.test.ts), [`memory-publishing.concurrency.integration.test.ts`](../src/modules/journals/memory-publishing.concurrency.integration.test.ts), and [`public-memory.integration.test.ts`](../src/modules/publication/public-memory.integration.test.ts) (`pnpm test:integration`); [`public-memory.http.test.ts`](../src/testing/public-memory.http.test.ts) (`pnpm test:http`); and [`e2e/memory-page.spec.ts`](../e2e/memory-page.spec.ts) in the `memory-desktop` and `memory-390` projects, with the studio's publication journey in `e2e/memories.spec.ts`. `E2E_SCREENSHOTS=1` writes the public page and the publication screens to `visual-review/m3-7/` (`pnpm build && E2E_SCREENSHOTS=1 pnpm test:e2e:run --project=memory-desktop --project=memory-390 --project=memories-390`).

**The interface in two languages (ADR 0008)** adds to each layer. The public pages (PR 2B): [`i18n.test.ts`](../src/i18n/i18n.test.ts) and [`route-structure.test.ts`](../src/app/route-structure.test.ts) (`pnpm test`), [`public-portuguese.http.test.ts`](../src/testing/public-portuguese.http.test.ts) (`pnpm test:http`), and [`e2e/i18n-public.spec.ts`](../e2e/i18n-public.spec.ts) (project `i18n-public`). The Studio (PR 3): [`studio.test.ts`](../src/i18n/studio/studio.test.ts) (the Studio dictionaries' parity, nothing functional left in English, and every place name of a change review), [`studio-portuguese.http.test.ts`](../src/testing/studio-portuguese.http.test.ts) and both trees in [`studio-private-cache.http.test.ts`](../src/testing/studio-private-cache.http.test.ts) and [`studio-build-output.http.test.ts`](../src/testing/studio-build-output.http.test.ts), the Portuguese memory in [`memory-publishing.integration.test.ts`](../src/modules/journals/memory-publishing.integration.test.ts), and [`e2e/i18n-studio.spec.ts`](../e2e/i18n-studio.spec.ts) (project `i18n-studio`: the Portuguese flows, and every authorized Studio page (26, with sign-in in its own test) at 320, 360, 390, 768, and 1440 px; `E2E_SCREENSHOTS=1` writes to `visual-review/i18n-studio/`).

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
- A field can be visible before React has hydrated it, and hydration rewrites a `textarea`, so a `fill` at that moment can insert beside the stored text. A test that types into the album journal editor right after loading it first waits for `form[data-editor-ready]`, which the editor sets once hydration has finished.

**What is covered** (`e2e/`, 74 tests over four projects):

| File | Workflow |
| --- | --- |
| `authentication.spec.ts` | A visitor is sent to sign-in from every studio page; a wrong password is refused in words; the right one opens the studio with an `HttpOnly`, `SameSite=Strict` cookie; sign-out ends the session, also after "back" |
| `catalog.spec.ts` | Create an artist, an album credited to it, and tracks; reorder, remove, and add back; edit album, artist, and track; every change after a reload and in PostgreSQL; a real `DELETE` of an unused record and the refusal of one in use |
| `journal.spec.ts` | A private draft with several paragraphs and literal markup; leave and return to the exact text; edit one field without touching the others; a stale tab is refused as a conflict and keeps its text; draft and private, and no control to publish |
| `recovery.spec.ts` | Delete a journal, find it in Recently deleted, restore it with every word; a journal that was published returns private with its history; a second restore from a stale tab is refused in words; an editor opened before a delete and restore cannot overwrite newer writing |
| `negative.spec.ts` | An expired, revoked, forged, and tampered session; a session that ends while the author is writing (the save is refused in words, nothing is stored, the text stays); invalid input |
| `academic.spec.ts` | The AC-04 example (album, credited artist, linked tracks, private journal) read back with a JOIN, the aggregates, and a subquery; a change made in SQL appears in the interface; one track reflection makes the Desk read "1 of 2 tracks written", as a count in SQL does (M4.2) |
| `layout.spec.ts` | The Studio's lateral contract, measured at 390, 768, 1280, 1440, and 2560 px: the shell is `min(100% - 35.2px, 1320px)` and centered, header, content, and footer share its edges, no Studio page scrolls sideways even with long names, the header follows the reference (one row above 720 px, centered and stacked at 720 px and below) with two destinations that never wrap at 320 to 2560 px, the editor's Save and save state stay reachable and clear of the writing on a wide screen and a phone, the writing keeps its measure on an ultrawide screen, the skip link works after client-side navigation, the navigation has a 2px focus ring and 44 px targets, and reduced motion stops every transition |
| `navigation.spec.ts` | The header has exactly two destinations, Desk and Catalog, on every page; which is current (Desk for the journals and their editors, Catalog for artists, albums and tracks); the Catalog's sections are always-visible links with the current one marked; every section is reachable by clicking and browser history works; navigation is client-side (no document request, the `window` survives); keyboard navigation raises no console, script, or hydration error; and a recorded known limitation, that focus is no longer on the activated link ([Studio visual fidelity](design/studio-visual-fidelity.md#navigation-investigation-issue-23)) |
| `accessibility.spec.ts` | axe-core (WCAG 2.0, 2.1 and 2.2, A and AA) on 16 Studio pages at 1280 and 390 px, the open dialog and sign-in, a canary that proves the scanner reports a broken element, the drawn boundary of the editor's inputs and Save button at rest, on hover and in focus (at least 3:1), and forced-colors emulation (real borders and no drawn image on the editor's controls, and no drawn underline on Sign out, at rest, on hover and in focus). axe is a floor, not a verdict ([Accessibility notes](design/studio-visual-fidelity.md#accessibility-notes)) |
| `mobile.spec.ts` | At 390 px on a touch device: no page is wider than the screen, the main controls are at least 44 px, delete and restore work by touch |

There is no `sleep`: each test waits for something the application shows (a heading, a message, a URL). A flaky test is a bug, so there are no retries.

**Running one file or one project:** `pnpm exec playwright test e2e/recovery.spec.ts --project=desktop` (the `setup` project runs first by itself). Within a file, tests share state and run in order, so a single test of a file may need its predecessors. A failure prints Playwright's own call log; `E2E_KEEP_SERVER_LOG=1` copies the server log to `test-results/server.log`.

**Not covered:** real HTTPS, Firefox and WebKit, and any hosted configuration or CDN. CI runs Chromium only.

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

An archive made by PostgreSQL 18's `pg_dump` (the hosted database's version, [Hosted Backups](hosted-backups.md)) is restored into the PostgreSQL 18 test container instead: `pnpm db:test18:up`, then the same command with `--postgres=18`, then `pnpm db:test18:down`. The tool reads which `pg_dump` made the archive and refuses one newer than the restore server before creating anything. Without the flag nothing changes: the PostgreSQL 17 container, as before.

`--file` must be a backup you made: restoring runs its contents as SQL, as the database superuser, on the disposable container. The archive is first copied to a private temporary file (removed when the command ends, including on Ctrl-C, SIGTERM, or a closed terminal; a run that is killed outright, with SIGKILL, can leave a `refrain-verify-…` folder in the temporary directory, which you delete by hand), and the checksum, the listing, and the restore all read that one copy. If a `.sha256` file sits next to the archive it must match, or nothing is restored (this catches damage and edits, not a file that was hostile from the start). The archive is then listed and refused if it is not a valid `pg_dump` archive. The restore runs as one transaction that stops at the first error. The check then confirms that every table of the restored copy is accounted for, that the three tables whose rows a backup leaves out (`auth_sessions`, `auth_verifications`, `auth_rate_limits`) came back empty, and, with `--compare-with`, compares the source and the restored copy table by table: the row count and a digest over the full text of every row of the **19 tables** that hold the writing, its status and publication history, deletion and versions, the slugs and their marks, the catalog, the reflections and memories, and the author's account including the password hash. The digests are computed in PostgreSQL and never printed. The migration count must match too. Any difference fails. A table that the tool neither compares nor deliberately excludes also fails, so a table added later cannot be silently left out. Without `--compare-with` it claims only that the archive restored without error. The comparison reads the source with `SELECT` only. Run it right after the backup, with nothing saved in the studio in between: a later save is a real difference, and the check will report it.

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
| Studio pages fail, or say "The studio isn’t available right now." | PostgreSQL is not running, or authentication is not configured (next row). Run `pnpm db:up` and check `docker compose ps`. The server log records only an error code, never connection details. |
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
| PostgreSQL images | `postgres:17.11-trixie`, `postgres:18.6-trixie` | The supported majors, the same images locally and in CI ([Test database](#test-database)) |

Planned dependencies (Tiptap) are added with the features that need them, after the same compatibility check.

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

Since the repository became public on 2026-11-06, the rules above are enforced by GitHub, and were verified that day ([evidence](evidence/public-release.md#publication)):

- changes reach `main` only through pull requests (no approval count required, so the sole maintainer can merge their own);
- the checks `Verify` and `Database tests (PostgreSQL 18)` must pass before merging;
- force pushes and deletion of `main` are blocked.

Admin enforcement is off, so an admin can override, and GitHub marks an override as such. The rule is never to do so. Before publication, branch protection was unavailable on GitHub Free for private repositories (HTTP 403, "Upgrade to GitHub Pro or make this repository public"), and the rules were followed by convention.

The settings, all enabled and verified on 2026-11-06 (Settings):

1. **Branches → `main`:**
   - require a pull request before merging;
   - require the status checks `Verify` and `Database tests (PostgreSQL 18)`;
   - block force pushes and deletion.
2. **Actions → General:**
   - require approval for workflows from **all outside collaborators**;
   - keep the default `GITHUB_TOKEN` permission read-only (it is read-only today);
   - do not allow GitHub Actions to approve pull requests (not allowed today).
3. **Code security:**
   - turn on private vulnerability reporting ([SECURITY.md](../SECURITY.md));
   - turn on secret scanning with push protection;
   - turn on Dependabot alerts.

Public-repository risks the workflow already handles ([`.github/workflows/ci.yml`](../.github/workflows/ci.yml)):
- It runs on `pull_request` and pushes to `main` only. Never `pull_request_target` or `workflow_run`, so code from a fork never runs with secrets or a write token.
- Its permissions are `contents: read`.
- It uses no secrets: its database passwords are placeholders for throwaway containers.
- Every action is pinned to a full commit SHA.
- Nothing in it deploys, publishes, or merges.

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
| Integration tests | `pnpm test:integration` | In CI, against a disposable PostgreSQL 17 service container and, in a parallel job, a PostgreSQL 18 one, with test credentials, marked as disposable by the same script as the local test database. Global setup applies the committed migrations first. Covers connectivity, test-database isolation, migrations and delete rules, the schema constraints ([coverage](data-model.md#validation)), transactions, the academic queries, and the database-level parts of INV-1 to INV-5. |
| HTTP tests | `pnpm test:http` | In CI, after the build and the integration tests, against the same disposable service database (PostgreSQL 17, and 18 in the parallel job), and before the browser tests, which need the identity tables empty. The production build over real HTTP: studio access with and without a valid session, sign-in, cookies, sign-out, sign-up, origins, rate limiting, the author command, and the server log. |
| Dependency audit | `pnpm audit --audit-level=high` | In CI (M1.3C). High and critical advisories fail the run; the two moderate advisories listed under [Toolchain](#toolchain) are in development tools and are reviewed, not hidden. |
| Browser tests | `pnpm exec playwright test` | In CI (M1.3C), after `playwright install --with-deps chromium`: the production build in Chromium against the same disposable service database ([Browser tests](#browser-tests)). Public flows arrive with the public pages. |

The workflow has read-only `permissions` (`contents: read`), a concurrency group per pull request or branch, a timeout of 30 minutes for Verify (raised from 20 after it took about 19 minutes on PR #93 and on `main`; no check was removed) and 20 for the PostgreSQL 18 job, and no secrets. Its PostgreSQL credentials belong to a disposable service container and are not secrets. Actions are pinned to full commit SHAs. It does not publish artifacts or deploy.

## Testing approach

- **Domain rules:** unit tests with no database.
- **Persistence and SQL:** integration tests against real PostgreSQL, in the disposable [test database](#test-database). Database behavior is not mocked: foreign keys, `CHECK` constraints, and transactions are exactly what these tests must prove. A rejection test asserts the SQLSTATE and the name of the constraint that fired (helpers in [`src/testing/`](../src/testing/)), so it cannot pass because of an unrelated error.
- **Invariants:** each of ADR 0002's INV-1 to INV-5 has database-level tests now; the HTTP-level parts are listed in [Security § Required tests](security.md#required-tests) and arrive with the routes.
- **Privacy:** the tests listed in [Security § Required tests](security.md#required-tests).
- **Authentication:** integration tests run the real Better Auth instance on the test transaction, through the real request handler, with real `Request` and `Response` objects ([`identity.integration.test.ts`](../src/modules/identity/identity.integration.test.ts)); the [HTTP tests](#http-tests) run the production server. Session checks are never mocked.
- **Publication boundary (M2.1):** unit tests of the confirmation token against an independent implementation of its specification; PostgreSQL tests of the preview, the checked publish, every refusal, and each disclosed atom changing; real-connection tests of the state stamp and of publication behind a controlled entry lock; and static scans of the production source ([`src/publication-boundary.test.ts`](../src/publication-boundary.test.ts)). Integration workers get a synthetic `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, and author email in memory ([`worker-setup.ts`](../src/testing/worker-setup.ts)), so the tests never use your development secret. Tests that only need a published fixture call `publishForTest`, which previews and publishes through the real command; production code never does that.
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

- All repository documentation, code comments, commit messages, issues, and PR descriptions are in English. Interface strings: the public pages are in English and Brazilian Portuguese, from the dictionaries in `src/i18n/`; so is the Studio, from its own dictionaries in `src/i18n/studio/` ([ADR 0008](decisions/0008-interface-localization.md)).
- When behavior changes, the relevant document changes in the same PR.
- A significant architectural or data decision gets an ADR in [`docs/decisions/`](decisions/).
- Write in present tense for what exists, and label planned functionality explicitly as planned.
