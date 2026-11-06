# Hosted Backups and Disaster Recovery

**Status (2026-11-06):** F-02, issue [#65](https://github.com/RaioViajante/refrain/issues/65), gate **G6** in [#47](https://github.com/RaioViajante/refrain/issues/47). The toolchain in [`ops/backup/`](../ops/backup/) is **built and tested locally, on synthetic data, against a disposable PostgreSQL 18 server**. **Nothing is provisioned:**
- no `refrain_backup` role exists in Neon;
- no automation repository, secret, or schedule exists;
- no production data has been exported;
- no key pair has been generated.

The retention and recovery policy is [ADR 0007](decisions/0007-hosted-backups-and-retention.md), **Proposed** and waiting for the owner. G6 stays open until the criteria in [Closing F-02 and G6](#closing-f-02-and-g6) are met. Until then the hosted database holds only synthetic `[Test]` records ([Security § Data protection](security.md#data-protection)).

The local procedure for the development database is separate and unchanged: [Development § Backup and restore](development.md#backup-and-restore).

## Architecture

```
Neon (PostgreSQL 18, direct endpoint, TLS verify-full)
   │  read-only role refrain_backup, one exported snapshot
   ▼
GitHub Actions, private repository refrain-backups (daily, 05:41 UTC)
   ├─ pg_dump 18 (custom format) + fingerprint + inventory, same snapshot
   ├─ restore the plaintext dump into a NEW database on a throwaway
   │  PostgreSQL 18 service container; compare fingerprints     ── fails the run
   ├─ tar | age -R <owner's public key>  (no plaintext written)
   └─ artifact: refrain-<UTC>.tar.age + .sha256 + summary, kept 90 days
          │
          ▼  monthly, by the owner
Mac: download → `check` → `drill` (decrypt with the owner key, restore into a
new database on postgres-test-18, compare) → copy the encrypted bundle to
iCloud Drive and an offline drive, kept 12 months
```

**Why this shape:**
- **Independent of Neon and Vercel.** The bundles live on GitHub, and their monthly copies live off GitHub. The Neon history window (6 hours on the Free plan) is the provider's own and does not count.
- **Encrypted before it is stored.** GitHub holds only ciphertext, and the decryption key never reaches GitHub.
- **Restored daily.** A dump that cannot be restored fails that day's run, not a recovery months later.
- **Nothing is paid** (see [Cost and quotas](#cost-and-quotas)).
- **One small, auditable toolchain:** bash, `psql`, `pg_dump`, `pg_restore`, and `age` in one pinned image, without the application's code or its npm dependencies, because the job holds a production credential.

**Alternatives considered:**
- **A `launchd` job on the Mac.** No third party would hold the credential, but it runs only while the Mac is awake and online.
- **Vercel Cron.** It has no `pg_dump` and stays on the same provider as hosting.
- **`pg_read_all_data`.** See [The backup role](#the-backup-role).
- **Neon's own branches or snapshots.** They are not independent.

## The toolchain

[`ops/backup/Dockerfile`](../ops/backup/Dockerfile): `postgres:18.6-trixie` pinned by digest (the hosted server's major version, and the image of `postgres-test-18`), plus `age` 1.2.1 and `ca-certificates` from Debian trixie. It never starts a server. [`ops/backup/refrain-backup.sh`](../ops/backup/refrain-backup.sh) has three commands:

| Command | What it does | What it proves |
| --- | --- | --- |
| `backup <empty dir>` | Dumps, fingerprints, restores and compares the plaintext dump, encrypts, and writes `refrain-<UTC>.tar.age`, its `.sha256`, and `summary.txt` | The dump restores and equals the source, before encryption |
| `check <bundle>` | Checks the `.sha256` and the age header | The encrypted file is intact (it is not decrypted) |
| `drill <bundle>` | Decrypts with the owner's identity, checks the bundle's own records, restores into a new database, and compares with the backup-time fingerprint | The bundle decrypts, and the copy restores and equals the source as it was |

**Configuration comes from the environment only.** Nothing secret is an argument, appears in a process listing, or is printed:
- `PGSERVICEFILE`: libpq services `refrain_source` and `refrain_restore`.
- `PGPASSFILE`: passwords, mode `0600`.
- `REFRAIN_BACKUP_RECIPIENTS_FILE`: the public key.
- `REFRAIN_BACKUP_IDENTITY_FILE`: the owner's key, for the drill only.

**Fail-closed rules, each tested:**
- **The source:**
  - The connection is forced to `sslmode=verify-full sslrootcert=system` (system CA store and host name).
  - It must be PostgreSQL 18.
  - It must not be a superuser.
- **The restore server:**
  - It must be on a loopback host.
  - It must be PostgreSQL 18.
  - Its maintenance database must carry the disposable marker `refrain:disposable-test-database`, which never exists in production.
  - The script only ever `create`s a database named `refrain_verify_<random>_test`, and drops only that database.
- **Inputs and output:**
  - The output directory must be empty.
  - A recipients file that holds a private key is refused.
- **Error messages:** tool errors are reduced to the tools' own first lines. `DETAIL`, `CONTEXT`, and `QUERY` lines, which can quote row values, are dropped, along with host names and connection strings.
- **The test escape:** `REFRAIN_BACKUP_TEST_ONLY_INSECURE_SOURCE=1` exists for the tests. It allows a non-TLS source only on a loopback host and a `*_test` database.

## What a backup contains

A **whole-database** `pg_dump --format=custom` (PostgreSQL 18):
- **The schema:** tables, columns, defaults, constraints, indexes, sequences, and the enum types.
- **All rows** of every table, except the ones listed below.
- **Owners and grants**, so a recovery into Neon can restore the runtime role's privileges.

Dumping the whole database, rather than `--schema=public --schema=drizzle`, means a schema the role cannot read makes `pg_dump` fail instead of being skipped. (Selecting `public` explicitly also makes PostgreSQL 18 emit a `CREATE SCHEMA public` that cannot be restored.)

**It includes** every language version with its status, the deletion state, the publication history, slugs, ratings, reflections and their flags, memories, the catalog, the author's account **with its password hash**, and the migration history. Drafts, private writing, and Recently deleted entries are all in it.

**It leaves out the rows** of `auth_sessions`, `auth_verifications`, and `auth_rate_limits` (`--exclude-table-data`; the tables themselves are kept, empty), the same list as the local tool's `EXCLUDED_DATA` (a unit test keeps them equal):
- a restore never brings back a session or a one-time value;
- the author signs in again.

**Inside the bundle**, next to the dump:
- **`source.fingerprint`**, taken in the same snapshot as the dump: one line per fact, covering:
  - schemas, tables and their row-level-security settings, and columns;
  - constraints and their validation state, and indexes;
  - sequences and their current values;
  - enum types, functions, triggers, views, and policies;
  - for each table, its row count and an md5 over the text of every row in a fixed order (`excluded` for the three tables above).
  - The digests are not secret, but they are never printed.
- **`inventory.txt`:** entry identifiers, kinds, deletion flags, and per-language statuses, and reflection identifiers and flags. It holds no titles, writing, or slugs. It is the input to the recovery review ([ADR 0007 § 3](decisions/0007-hosted-backups-and-retention.md)).
- **`meta.txt`:** the format version, the time, the `pg_dump` version, and the dump's sha256.

**Compression:** the custom format compresses each table's data with gzip at a moderate level, the default, which every PostgreSQL 18 build reads. `zstd` would be smaller but is not needed at this size (kilobytes), and `age` adds no compression. The artifact upload uses `compression-level: 0`.

## Consistency

1. One session opens `REPEATABLE READ, READ ONLY` and exports its snapshot (`pg_export_snapshot()`), then holds it open.
2. The fingerprint and the inventory are read in that snapshot (`SET TRANSACTION SNAPSHOT`), and so is `pg_dump --snapshot=<id>`.
3. The source and its dump are therefore the same instant, even if the author writes during the run.
4. Sequence values are not transactional: if a number were drawn during the run, the comparison would fail and the next run would retry. Refrain's only sequence is the migration table's.
5. This needs the **direct** Neon endpoint. Neon: "Always use direct connections for `pg_dump`", because PgBouncer's transaction mode does not support `SET`.

## Verification, at three levels that are not interchangeable

1. **The plaintext dump, before encryption** (every daily run). The job restores the dump into a fresh database on a throwaway PostgreSQL 18 service and runs these checks:
   - The restore runs with `--exit-on-error --single-transaction`, and its success means every constraint was valid on the restored data: foreign keys, unique, check, and not-null.
   - The fingerprint must be byte-identical. That covers structure, constraint validation, and every table's count and digest.
   - The three excluded tables must be empty.
   - Every sequence that feeds a column must be ahead of the values already used.

   This proves the dump. **It does not prove that the encrypted bundle decrypts.**
2. **The encrypted artifact is intact** (`check`, the freshness workflow). The file matches its `.sha256` and is an age file, and the artifact exists and is unexpired. This proves storage. **It proves nothing about decryption or content.**
3. **A genuine drill** (`drill`, monthly and before closing G6). The owner decrypts with the owner's key, on the Mac, and restores into a new database. The comparison against the backup-time fingerprint must pass. age authenticates every chunk, so a changed or truncated bundle fails here (tested). **Only this level shows that recovery works.** Levels 1 and 2 never replace it.

Row counts alone are never the claim: the comparison is structure plus a digest of every row, and a successful constraint-checked restore.

## The backup role

[`ops/backup/backup-role.sql`](../ops/backup/backup-role.sql), with [`backup-role-audit.sql`](../ops/backup/backup-role-audit.sql) for review:

```sql
create role refrain_backup with login nosuperuser nocreatedb nocreaterole
  noreplication nobypassrls noinherit connection limit 3;
alter role refrain_backup set default_transaction_read_only = on;
alter role refrain_backup set statement_timeout = '20min';
alter role refrain_backup set idle_in_transaction_session_timeout = '30min';
grant connect on database neondb to refrain_backup;
grant usage on schema public, drizzle to refrain_backup;
grant select on all tables in schema public, drizzle to refrain_backup;
grant select on all sequences in schema public, drizzle to refrain_backup;
alter default privileges for role neondb_owner in schema public, drizzle
  grant select on tables to refrain_backup;      -- and on sequences
```

The password is set with `\password` and generated in the password manager (Neon requires at least 60 bits of entropy). It never goes in a file or on a command line.

**What the role cannot do** (asserted by the audit's 14 checks, and by behavior: each statement below is refused with `42501` on the test server):
- **Write:** no insert, update, delete, or truncate, and no `nextval`.
- **Create:** no table, schema, database, or role.
- **Escalate:** no `SET ROLE` to the owner, no membership in any role, no owned objects, and no bypass of RLS.
- **Lifting read-only does not help:** a session that sets `default_transaction_read_only = off` is still refused by privileges. The read-only default is defense in depth, not the boundary.
- **Residual:** like every role, it can create temporary tables (PostgreSQL grants `TEMP` to `PUBLIC`). Revoking that would change the runtime role's privileges, which is out of scope.

**Why not `pg_read_all_data`:** in PostgreSQL 18 it "allows reading all data (tables, views, sequences), as if having SELECT rights on those objects and USAGE rights on all schemas", in every schema and database of the server, now and later. Explicit grants on the two application schemas are narrower. The default privileges cover tables a migration (run as `neondb_owner`) adds later, which is tested. A table created by any other role is not readable, so the backup fails and says so (fail closed, tested).

**Row-level security:** neither the grants nor `pg_read_all_data` bypass RLS. `pg_dump` sets `row_security = off` and errors if the role is subject to a policy, so if G4 ever adds RLS, backups fail loudly (tested) rather than dumping part of a table. The fix then is a deliberate `BYPASSRLS` decision in the same ADR.

**Credentials:**
- **Never the runtime role `refrain_app`**, which correctly cannot read `drizzle`.
- **Never the Neon owner** for scheduled backups.

## Encryption and key custody

The automation holds only the **public** recipient (`age1…`, a repository variable, not a secret). The private key is the owner's alone.

**Generate once, offline, on the Mac** (when provisioning is authorized):

```sh
mkdir -m 700 ~/refrain-backup-key && cd ~/refrain-backup-key
docker build -t refrain-backup-tools ~/Developer/personal/refrain/ops/backup
docker run --rm -it --network none -v "$PWD:/k" refrain-backup-tools \
  sh -c 'age-keygen | age -p -a > /k/refrain-backup-identity.age'
```

1. `age-keygen` prints `Public key: age1…`. That is the recipient: store it in the repository variable and in Proton Pass.
2. `age -p` asks for a passphrase. Generate it in Proton Pass first.
3. The identity is saved passphrase-encrypted ("If an identity file passed to `-i` is a passphrase encrypted age file, it will be automatically decrypted"). It is never written in clear.

**Store it in two independent places:**
- **Proton Pass:** an item "Refrain backup key" holding the public key, the passphrase, and the `refrain-backup-identity.age` file as an attachment.
- **Offline:** the same `.age` file on an encrypted USB drive kept apart from the Mac, plus a paper print of its armored text. Keep the passphrase on paper, sealed, **in a different place from the drive**.

Then delete `~/refrain-backup-key`. For each drill, export the file from Proton Pass into a `0700` temporary folder, and delete it afterwards.

**Losing both copies of the key makes every backup unreadable.** There is no recovery. Test the offline copy at the first drill. A compromised key: generate a new pair, update the variable, and keep the old key until every bundle encrypted to it has expired. Old bundles stay readable to whoever holds the old key.

Plaintext exists only in the job's temporary directory, inside the tools container (removed on exit, including on failure), and in the drill's temporary directory on the Mac (removed on exit). `tar` streams straight into `age`, so no plaintext archive is ever written.

## The automation repository

**Not created.** Templates: [`ops/backup/automation/`](../ops/backup/automation/). GitHub never runs workflows from that folder in this repository. Structure of the private repository `refrain-backups`:

```
.github/workflows/backup.yml     daily backup (schedule + manual dispatch only)
.github/workflows/freshness.yml  fails when no successful backup in 30 h
.github/CODEOWNERS               the owner, for every file
toolkit/                         a copy of ops/backup/ from a reviewed Refrain commit
toolkit/SHA256SUMS               its checksums, checked by the job
toolkit/SOURCE                   the Refrain commit it was copied from
README.md                        pointer to this document
```

**Security controls:**
- **Token and triggers:**
  - `permissions: {}` at the top, then `contents: read` (backup) or `actions: read` (freshness) per job.
  - Triggers are only `schedule` and `workflow_dispatch`: no `pull_request`, `pull_request_target`, or `push` trigger, so no untrusted code ever runs with the secret.
  - Fork pull-request workflows stay disabled.
- **Actions** are pinned to full commit SHAs (`actions/checkout` v7.0.1, `actions/upload-artifact` v7.0.2), and the image is pinned by digest. The toolkit is vendored, never fetched at run time.
- **Run safety:**
  - `concurrency: refrain-backup` without cancelling, so two runs never overlap.
  - `timeout-minutes: 20`, below the role's 30-minute idle limit.
- **Secrets:**
  - `REFRAIN_BACKUP_SOURCE_SERVICE` holds the direct endpoint's `host`, `port`, `dbname`, and `user` lines.
  - `REFRAIN_BACKUP_PGPASS` holds one `.pgpass` line.
  - Both are written to owner-only files in `$RUNNER_TEMP` with `printf` (a shell builtin, never visible as an argument), mounted read-only into the container, and removed in an `always()` step.
- **Who can change workflows:** a single-owner private repository with no collaborators. Controls by plan:
  - **GitHub Free:** environments, protected branches, and code-owner reviews are unavailable for private repositories ("Users with GitHub Free plans can only configure environments for public repositories"). The secrets are then repository secrets, and the control is that nobody else has access. Delete the `environment:` line.
  - **GitHub Pro:** add an environment `production-backup` limited to the default branch, holding the secrets, and a ruleset requiring a pull request and the owner's review for the default branch.
  - Required reviewers on the environment would block every scheduled run, so they are not used.
- **Failure reporting:**
  - **A failed run** emails the owner. GitHub sends scheduled-workflow notifications "to the user who initially created the workflow", so the owner must create the workflow file.
  - **A missed run:** GitHub can delay or drop scheduled runs at high load. The freshness workflow fails when no successful run with an unexpired artifact finished in the last 30 hours.
  - **A repository too quiet to run:** the monthly drill is the backstop. GitHub documents the 60-day automatic disable for public repositories only.
- **Account risk:** GitHub is one independent provider, not the only durable location. If the GitHub account is lost, the monthly copies (iCloud Drive plus the offline drive) and the key (Proton Pass plus offline) still allow a recovery, with up to a month of writing at risk. Losing the account also stops new backups.

## Cost and quotas

GitHub's billing page, read 2026-11-06:
- **Included each month:** "$12 USD" of Actions compute and "500 MB" of artifact storage on Free; "$18 USD" and "1 GB" on Pro. Compute is a dollar amount, not minutes.
- **Without a payment method**, "usage is blocked once you consume the included compute usage". That is a failure the freshness check and the drill would surface.
- **Expected use:** a few minutes a day on `ubuntu-24.04` (image build, about 1 minute; dump, restore, and encryption, under a minute at today's size) and the freshness check. That is well under the included compute. Storage is about 90 bundles × tens of kilobytes, well under 500 MB.
- **Re-estimate** when the database grows.
- **Retention:** artifacts expire after `retention-days: 90`, within the private-repository maximum of 400 days. Deleting a run deletes its artifacts. A deleted artifact "cannot be restored".
- **No paid service** is used, and none should be bought for this.

## Monthly owner copy and drill

On the first weekend of each month, about 30 minutes, on the Mac with FileVault on:

1. **Download** the latest successful run's artifact into a new `0700` folder outside the repository and outside iCloud Drive: `gh run download <run-id> -R <owner>/refrain-backups -D ~/refrain-drill/<YYYY-MM>`, or download it from the Actions page and unzip it.
2. **Check it:** `pnpm db:test18:up` (the disposable PostgreSQL 18 server), then build the image as in [Encryption and key custody](#encryption-and-key-custody), and run `check`:

   ```sh
   docker run --rm -v ~/refrain-drill/2026-12:/out:ro refrain-backup-tools \
     refrain-backup check /out/refrain-<UTC>.tar.age
   ```
3. **Drill.** Export the identity from Proton Pass into `~/refrain-drill/key/` (`0700`). Write a service file whose `refrain_restore` is `host=127.0.0.1 port=5432 dbname=refrain_test user=refrain_test`, and a pgpass for the disposable test credentials (in `.env.example`). Then run the drill, attached to that container's network:

   ```sh
   docker run --rm -it --network container:refrain-postgres-test-18-1 \
     -v ~/refrain-drill/2026-12:/out:ro -v ~/refrain-drill/cfg:/cfg:ro \
     -v ~/refrain-drill/key:/key:ro -e PGSERVICEFILE=/cfg/pg_service.conf \
     -e PGPASSFILE=/cfg/pgpass -e REFRAIN_BACKUP_IDENTITY_FILE=/key/refrain-backup-identity.age \
     refrain-backup-tools refrain-backup drill /out/refrain-<UTC>.tar.age
   ```

   It asks for the passphrase and must end with `drill passed`. Then delete `~/refrain-drill/key/` and run `pnpm db:test18:down`. The drill never touches `postgres-test` (17) or the development database.
4. **Keep the copy.** Copy the `.tar.age` and its `.sha256` (never a decrypted file) to a private iCloud Drive folder and to the offline encrypted drive. Check `shasum -a 256 -c` on each copy.
5. **Delete** monthly copies older than 12 months from both places ([ADR 0007 § 2](decisions/0007-hosted-backups-and-retention.md)).
6. **Record** the date, the bundle name, its sha256, and "drill passed" in the private log (Proton Pass note). Never record the content.

Optionally, wrap the copy in the AES-256 disk image of the local procedure as well. It adds nothing cryptographically, but keeps one procedure for both kinds of backup.

## Recovery

Never automatic, never into the serving database, and never with public reads on. It is a writer of public state (G3).

1. **Freeze.** Keep `REFRAIN_PUBLIC_READS_ENABLED=false`. Stop writing.
2. **Choose a bundle** (the newest that passes `check`) and drill it on the Mac first.
3. **Restore into a NEW Neon database or branch,** created for the purpose with the owner's authorization. Never over the serving database. Run the tools image from the Mac:
   1. Decrypt into a `0700` folder.
   2. Run `pg_restore --exit-on-error --single-transaction --no-owner` into the new database, as the owner, through the direct endpoint with `sslmode=verify-full`. Keep privileges, so the runtime role's grants return.
   3. Run the backup-role audit, and check the runtime role's privileges.
4. **Make nothing public by the restore** ([ADR 0007 § 3](decisions/0007-hosted-backups-and-retention.md), proposed):
   1. In one transaction, every `published` language version becomes `private` and its `published_at` is cleared. This is the same rule as restoring a deleted journal (ADR 0005); publication history and slugs are kept.
   2. Compare the restored inventory with the newest inventory available. Any entry that a later backup no longer had was permanently deleted after this backup. The owner reviews each one and deletes it again before anything else.
5. **Invalidate.** Sessions are not in a backup. Rotate `BETTER_AUTH_SECRET` as well, so no cookie or 15-minute confirmation token signed before the incident is valid.
6. **Switch.** Point `DATABASE_URL` at the new database, and redeploy the same commit. Verify the Studio, then re-run the release gates.
7. **Republish.** The author republishes through the Studio's confirmed workflow (ADR 0006), one entry at a time.

## Provisioning (each step needs the owner's explicit authorization)

1. Accept or amend [ADR 0007](decisions/0007-hosted-backups-and-retention.md).
2. Generate the age key pair, and store it in Proton Pass and offline ([above](#encryption-and-key-custody)).
3. Create `refrain_backup` in Neon:
   1. Use `backup-role.sql` as `neondb_owner`, then set the password with `\password`.
   2. Run `backup-role-audit.sql`, which must print `result|pass`.
   3. Confirm that Neon allows the grants, and that `neondb_owner` is the role that runs migrations.
4. Create the private repository `refrain-backups` (no collaborators, fork pull-request workflows off), and vendor `ops/backup/` from a reviewed Refrain commit with `SHA256SUMS` and `SOURCE`. Add the two secrets and the variable. With Pro, also add the environment and the ruleset.
5. Run `workflow_dispatch` once. Download the artifact and do the first drill (this is the first export of production data). Only after it passes, let the schedule run.
6. Record the evidence in #65. The owner then reviews G6 in #47.

## Closing F-02 and G6

F-02 and G6 close only on recorded evidence that the owner has reviewed:

1. ADR 0007 is accepted (retention, deletion, and the recovery rules).
2. `refrain_backup` exists in Neon, and its audit prints `result|pass`. The runtime role and the owner credentials are not used by the automation.
3. The scheduled job has run successfully for at least 7 consecutive days. Each run restored its dump into PostgreSQL 18 and passed the comparison, and the freshness check is green.
4. At least one **real encrypted bundle** has been downloaded, checked, decrypted with the owner's key **from the offline copy**, and drilled on the Mac with `drill passed`.
5. A copy of that bundle exists outside GitHub (iCloud Drive and the offline drive), and its `shasum -c` passes.
6. Logs, summaries, and artifacts were inspected and hold no plaintext, credential, or content.
7. The recovery procedure has been rehearsed into a new database (not the serving one) at least once, including the demotion to private, and the time it took is recorded.

## Remaining risks

- **One GitHub account** holds both the automation and up to 90 days of bundles. The monthly copy limits the loss to a month.
- **Monthly copies depend on the owner's habit.** A missed month widens the gap, and the private log makes it visible.
- **Key loss is unrecoverable.** That is why there are two independent copies, and a test of the offline one.
- **The free allowance can be exhausted** (blocked runs). The freshness check reports it.
- **Neon-specific behavior is untested locally:**
  - whether Neon allows the grants and default privileges as written;
  - TLS `verify-full` with `sslrootcert=system` against Neon's certificate chain;
  - snapshot export on the direct endpoint;
  - compute auto-suspend during a run.
  All are checked at the first dispatch.
- **Permanently deleted writing survives** in bundles for up to 90 days and in monthly copies for up to 12 months ([ADR 0007](decisions/0007-hosted-backups-and-retention.md)).
- **The passphrase-protected identity** (`age -p`) was not exercised by the automated tests, because they use a disposable identity without a passphrase. It is exercised at the first drill.
- **The macOS `db:backup:verify --postgres=18` route** restores a decrypted dump but does not compare it with the backup-time fingerprint. The drill does that.
