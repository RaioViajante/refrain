# Hosted Backups and Disaster Recovery

**Status (2026-11-07):** F-02, issue [#65](https://github.com/RaioViajante/refrain/issues/65), gate **G6** in [#47](https://github.com/RaioViajante/refrain/issues/47). The toolchain in [`ops/backup/`](../ops/backup/) is **built and tested locally, on synthetic data, against a disposable PostgreSQL 18 server**. The policy, [ADR 0007](decisions/0007-hosted-backups-and-retention.md), was **accepted by the owner on 2026-11-07**. **Nothing is provisioned:**
- no `refrain_backup` role exists in Neon;
- no automation repository, secret, or schedule exists;
- no production data has been exported;
- no key pair has been generated.

Accepting the policy provisions nothing and closes nothing. Each step in [Provisioning](#provisioning-each-step-needs-the-owners-explicit-authorization) needs the owner's separate authorization. G6 stays open until the criteria in [Closing F-02 and G6](#closing-f-02-and-g6) are met. Until then the hosted database holds only synthetic `[Test]` records ([Security § Data protection](security.md#data-protection)).

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
- **No paid service** beyond the owner's existing GitHub Pro subscription. The expected use fits well within Pro's included allowance. Whether an overage could ever be billed depends on the account's payment method and budget, which the owner checks before provisioning (see [Cost and quotas](#cost-and-quotas)).
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
| `reconcile <candidate> <newer>` | Decrypts only the two inventories, and lists by identifier the entries the candidate holds that the newer bundle no longer held, and those whose state changed | What a recovery from the candidate would bring back that was deleted, or unpublished, since |

**Configuration comes from the environment only.** Nothing secret is an argument, appears in a process listing, or is printed:
- `PGSERVICEFILE`: libpq services `refrain_source` and `refrain_restore`.
- `PGPASSFILE`: passwords, mode `0600`.
- `REFRAIN_BACKUP_RECIPIENTS_FILE`: the public key.
- `REFRAIN_BACKUP_IDENTITY_FILE`: the owner's key, for the drill only.

**Fail-closed rules, each tested:**
- **The source:**
  - The connection is forced to `sslmode=verify-full sslrootcert=system` (system CA store and host name).
  - It must be PostgreSQL 18.
  - It must not be a superuser, and must not be able to write a table, create in the database or in any schema, create roles or databases, bypass RLS, or be a member of any role (which could `SET ROLE` to a writer). This refuses the Neon owner (which is not a PostgreSQL superuser) and the runtime role.
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
- **Owners and grants**, so a recovery into Neon can restore the runtime role's privileges. The daily check restores and compares them too (see below).

Dumping the whole database, rather than `--schema=public --schema=drizzle`, means a schema the role cannot read makes `pg_dump` fail instead of being skipped. (Selecting `public` explicitly also makes PostgreSQL 18 emit a `CREATE SCHEMA public` that cannot be restored.) The comparison covers `public` and `drizzle`, so **a database with any other schema is refused** (tested) rather than dumped without being compared.

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
  - the owner and ACL of every schema, relation, column, type, and function, and the default privileges, plus every role they name;
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
5. **Tested:** a test pauses the run right after the snapshot is exported, then commits a new artist and an edited text. The backup still passes its restore comparison, and neither write is in the dump.
5. This needs the **direct** Neon endpoint. Neon: "Always use direct connections for `pg_dump`", because PgBouncer's transaction mode does not support `SET`.

## Verification, at three levels that are not interchangeable

1. **The plaintext dump, before encryption** (every daily run). The job restores the dump into a fresh database on a throwaway PostgreSQL 18 service and runs these checks:
   - The restore runs with `--exit-on-error --single-transaction`, and its success means every constraint was valid on the restored data: foreign keys, unique, check, and not-null.
   - The restore also applies the owners and grants. Each role they name that the throwaway server lacks (`neondb_owner`, `refrain_app`, `refrain_backup`) is created there as a `NOLOGIN` placeholder for that run and dropped afterwards (tested). So a grant that would not restore fails the day it is made, not during a recovery.
   - The fingerprint must be byte-identical. That covers structure, owners and grants, constraint validation, and every table's count and digest.
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

**What the role cannot do** (asserted by the audit's 15 checks, and by behavior: each statement below is refused with `42501` on the test server):
- **Write:** no insert, update, delete, or truncate, and no `nextval`.
- **Create:** no table, schema, database, or role.
- **Escalate:** no `SET ROLE` to the owner, no membership in any role, no owned objects, no bypass of RLS, and no `SECURITY DEFINER` routine it can execute (none exists today; the audit fails if one appears).
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

**Tested with disposable keys:**
- A key generated exactly this way (passphrase typed on a terminal) is stored encrypted, with no `AGE-SECRET-KEY` in the file.
- A backup encrypted to its public key passes the drill with the right passphrase.
- It fails with a wrong passphrase, and with another identity, and restores nothing.
- Neither the passphrase nor a key appears in the output.

The owner's real key is not created until provisioning.

**Losing both copies of the key makes every backup unreadable.** There is no recovery. Test the offline copy at the first drill. A compromised key: generate a new pair, update the variable, and keep the old key until every bundle encrypted to it has expired. Old bundles stay readable to whoever holds the old key.

Plaintext exists only in the job's temporary directory, inside the tools container (removed on exit, including on failure), and in the drill's temporary directory on the Mac (removed on exit). `tar` streams straight into `age`, so no plaintext archive is ever written.

## The automation repository

**Not created.** Templates: [`ops/backup/automation/`](../ops/backup/automation/). GitHub never runs workflows from that folder in this repository.

**Two repositories, two visibilities.** `RaioViajante/refrain` is **public**. It holds only the reviewed toolchain, these documents, and templates with no credential, key, dump, or writing. `RaioViajante/refrain-backups` must be **private**, and stays private even though the application source is public: it holds the backup credential as secrets, and its artifacts are the encrypted backups. Never change its visibility. Never copy a credential, the private key, a bundle, a summary from a real run, or any writing into `refrain`, including its issues and pull requests.

Structure of the private repository `refrain-backups`:

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
  - Both are written to owner-only files (`0600` in a `0700` folder) in `$RUNNER_TEMP` with `printf` (a shell builtin, never visible as an argument), mounted read-only into the container (which runs as the same user), and removed in an `always()` step.
- **Who can change workflows:** a single-owner private repository with no collaborators. The owner has **GitHub Pro** (confirmed by the owner, 2026-11-07). GitHub's documentation, read 2026-11-07, confirms these for private repositories on Pro, and the plan uses only these:
  - **An environment `production-backup` holding the two secrets.** "For access to environment secrets in private or internal repositories, you must use GitHub Pro, GitHub Team, or GitHub Enterprise."
  - **Its deployment branches limited to `main`**, so a workflow on any other branch cannot read the secrets. "For users on GitHub Pro or GitHub Team plans, deployment branches and tags are also available for private repositories."
  - **The recipient as a variable**, at repository or environment level. "For users on GitHub Pro or GitHub Team plans, environment variables are also available for private repositories."
  - **`main` as a protected branch**, with force pushes and deletion not allowed. GitHub Pro lists "Protected branches" among its tools for private repositories.
  - **`CODEOWNERS`** naming the owner. Pro lists "Code owners". Required code-owner review is **not** turned on: the only owner cannot approve their own pull request, so it would block every change.
- **Not available or not confirmed on Pro, so not used:**
  - **Required reviewers and wait timers on the environment.** "If you are on a GitHub Free, GitHub Pro, or GitHub Team plan, required reviewers are only available for public repositories", and the same for wait timers. They would also block every scheduled run.
  - **Rulesets.** GitHub's page describes them "for customers on GitHub Team and GitHub Enterprise plans", and Pro's plan page does not list them. The protected branch is used instead.
- **Upload guard:** the upload runs only after a successful backup step. A guard step first requires exactly one `refrain-*.tar.age`, its matching `.sha256`, a summary saying the restore check passed, an age header, and no `AGE-SECRET-KEY`, `postgres://`, or plaintext-dump signature (tested against a real output folder, and against four damaged variants).
- **Failure reporting:**
  - **A failed run** emails the owner, if the owner's notification settings for GitHub Actions are on (they can be limited to failed runs). GitHub sends scheduled-workflow notifications "to the user who initially created the workflow". If another user changes the cron syntax, notifications go to that user. If the workflow is disabled and re-enabled, they go to whoever re-enabled it. So **the owner commits the schedule** (Provisioning step 10), and only the owner re-enables a disabled workflow.
  - **A missed run:** GitHub can delay or drop scheduled runs at high load. The freshness workflow fails when no successful run with an unexpired artifact finished in the last 30 hours.
  - **A repository too quiet to run:** the monthly drill is the backstop. GitHub documents the 60-day automatic disable for public repositories only.
- **Account risk:** GitHub is one independent provider, not the only durable location. If the GitHub account is lost, the monthly copies (iCloud Drive plus the offline drive) and the key (Proton Pass plus offline) still allow a recovery, with up to a month of writing at risk. Losing the account also stops new backups.

## Cost and quotas

**Account (stated by the owner, 2026-11-07):** GitHub Pro. The billing dashboard showed metered usage fully offset by included usage discounts, with nothing additional payable. Metered usage is **gross usage before discounts, not a bill**. The dashboard's totals alone do not say which repositories used it, or how much of the Pro allowance is left this cycle. The figures stay with the owner; this public repository records only what the plan needs.

**GitHub's documentation, read 2026-11-07:**
- **Included each month with Pro:** "$18 USD" of Actions compute, "1 GB" of artifact storage (shared with GitHub Packages), and "10 GB" of cache storage. "The included compute usage is expressed as a monetary amount, not a fixed number of minutes."
- **Public repositories:** standard GitHub-hosted runners "in public repositories" are free, and that usage "does not reduce the included compute usage". Refrain's CI, now that `refrain` is public, does not use the allowance. `refrain-backups` is private, so its runs do.
- **Rate:** a standard Linux 2-core runner costs "$0.006" per minute, and "GitHub rounds the minutes and partial minutes each job uses up to the nearest whole minute". So $18 is about 3,000 such minutes. That figure is derived, not stated.
- **Storage** is billed separately from minutes. "Storage charges accrue every hour", and it is measured in GB-hours. The overage price is "$0.25 USD" per GB-month.
- **Without a valid payment method,** "usage is blocked once you consume the included compute usage". There is no charge, and no backup either until the next cycle.
- **With a valid payment method,** usage beyond the allowance "is billed to your account". Spending "may be limited by one or more budgets".
- **Budgets** can be set "for a specific repository or for your whole account". With "Stop usage when budget limit is reached", "additional usage is blocked" once the budget is exhausted. Without it, "usage will not be stopped": the owner only gets an email. Alerts can be sent at 75%, 90%, and 100%. A budget "applies only to metered usage from the date of its creation onwards".
- **Not documented, so not assumed:**
  - whether a **$0** budget with "Stop usage" still lets included usage run, or blocks everything;
  - whether any budget already exists on the account by default;
  - whether an Actions budget also covers artifact storage.

**Expected use (estimated, not measured):**
- about 4 billed minutes for each daily backup (image build, dump, restore, encryption, upload) and 1 for the freshness check;
- so about 150 minutes, or **about $0.90 a month**, against the $18 included;
- storage of about 90 bundles of tens of kilobytes each, well under 1 GB.

The first manual run (Provisioning step 6) measures the real billed minutes. Re-estimate from it, and again when the database grows.

**Billing check before provisioning (the owner, read-only unless the owner decides otherwise).** At github.com/settings/billing:
1. **Usage:** filter by product (Actions) and by repository. Record how much of the $18 compute and the 1 GB storage is used this cycle, and by which **private** repositories. Other private repositories share the same allowance. Public-repository usage should appear only as discounted.
2. **Payment information:** is a payment method on file?
   - **No:** GitHub blocks usage at the included amount, so nothing can be charged. A budget is optional. Do not add a payment method for this.
   - **Yes:** go to step 3.
3. **Budgets and alerts:** list the existing budgets. If there is none for Actions, the decision is the owner's. The recommendation is a **GitHub Actions** budget for the account with **"Stop usage when budget limit is reached"** selected and all alerts on, created **before** `refrain-backups` exists, because a budget counts only usage after its creation. Choose the amount:
   - **$0.** The strictest setting for compute beyond the allowance. GitHub does not document whether it also blocks the included usage. If it does, the first manual run is refused for billing reasons. That is visible, costs nothing, and the owner then decides whether to raise it.
   - **A small amount, such as $1.** It bounds Actions **compute** charges at that amount, if included usage runs out. Whether it also bounds storage is not documented.

   An account-level budget covers every private repository the owner has, which is the point. GitHub's example says an exhausted stopping budget blocks "all GitHub-hosted runners"; whether that also stops the free runs of the **public** `refrain` CI is not documented. Watch the next `refrain` CI run after creating it. A budget scoped to `refrain-backups` alone, created after step 4 and before step 6, avoids that question but leaves other private repositories unbudgeted.
4. **Included usage alerts:** keep GitHub's alerts at 90% and 100% of the included allowance on. GitHub sends them whether or not a budget exists.
5. **Storage:** confirm that the account's artifact and Packages storage is well under 1 GB. Whether the Actions budget covers storage is not documented. At about 10 MB of bundles, an overage would take years of growth.

Keep the details (usage, payment-method status, budget amount) in the owner's private log. In the public #65, record only "billing check done" and whether a stopping budget is in place. These steps change no setting unless the owner chooses to create a budget.

**Retention:** artifacts expire after `retention-days: 90`, within the private-repository maximum of 400 days. Deleting a run deletes its artifacts. A deleted artifact "cannot be restored".

**No paid service** is used, and none should be bought for this. The aim is no charge beyond the Pro subscription. That holds while use stays within the included allowance, or when no payment method is on file. With a payment method, only a stopping budget limits an overage, and only as far as the budget covers.

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

   **The drill never starts the application.** The restored copy lives only in a scratch database on the local disposable server, which nothing public reads, and it is dropped at the end. Separately, check that `REFRAIN_PUBLIC_READS_ENABLED` is still `false` in Vercel (Production and Preview) before and after: the drill does not depend on it, but a recovery does.
   - **An interrupted drill or backup** (Ctrl-C, `docker stop`) drops its scratch database and its placeholder roles before exiting (tested).
   - **A run killed outright** (SIGKILL) can leave a `refrain_verify_…_test` database or a `NOLOGIN` placeholder role, only on the disposable server. `pnpm db:test18:down` discards both, and CI's server is discarded with the job.
4. **Keep the copy.** Copy the `.tar.age` and its `.sha256` (never a decrypted file) to a private iCloud Drive folder and to the offline encrypted drive. Check `shasum -a 256 -c` on each copy.
5. **Delete** monthly copies older than 12 months from both places ([ADR 0007 § 2](decisions/0007-hosted-backups-and-retention.md)). Age is the bundle's UTC timestamp in its name, not the file's date.

   **Expiry does not depend on the drill.** Keep a separate, dated monthly reminder for this deletion, and do it even in a month when the drill is skipped. Otherwise a missed drill would keep a copy past the 12 months that ADR 0007 promises.
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
4. **Make nothing public by the restore** ([ADR 0007 § 3](decisions/0007-hosted-backups-and-retention.md), accepted):
   1. Run [`ops/backup/recovery-demote.sql`](../ops/backup/recovery-demote.sql) on the new database. In one transaction, every `published` language version becomes `private` and its `published_at` is cleared, the same update as the Publication module's own restore (ADR 0005). Publication history and slugs are kept. It fails, changing nothing, if anything published remains (tested).
   2. Run `refrain-backup reconcile <restored bundle> <newest bundle available>` (tested).
      - Each `deleted-since` entry was permanently deleted after this backup: the owner deletes it again before anything else.
      - Each `changed-since` entry shows its state then and now: the owner decides it.
      - If no newer bundle exists, the owner reviews every restored entry, all of which are private after step 1.
   3. Run [`ops/backup/recovery-check.sql`](../ops/backup/recovery-check.sql) (read-only) immediately before the switch. It fails while any version is published (tested).

   These are steps of the owner's procedure, enforced by tested SQL, not by the application: skipping them is possible, which is why the switch below comes after the check.
5. **Invalidate.** Sessions are not in a backup. Rotate `BETTER_AUTH_SECRET` as well, so no cookie or 15-minute confirmation token signed before the incident is valid.
6. **Switch.** Point `DATABASE_URL` at the new database, and redeploy the same commit. Verify the Studio, then re-run the release gates.
7. **Republish.** The author republishes through the Studio's confirmed workflow (ADR 0006), one entry at a time.

## Provisioning (each step needs the owner's explicit authorization)

Every step below that changes production, infrastructure, or an account needs the owner's **separate, explicit authorization**. No agent generates, sees, or stores the private key, the passphrase, or a database password. A step that fails stops the sequence, and is recorded.

**Where evidence goes.** `refrain` is public, so its issue #65 gets **attestations only**: a step done, a check passed, a run's conclusion, a commit. Run IDs, row counts, digests, summaries, usage, payment status, and budget details go in the owner's **private log** (the Proton Pass note), or in an issue of the private `refrain-backups`. No secret or content goes anywhere.

| # | Step | Who | Changes | Evidence (never a secret or content) |
| --- | --- | --- | --- | --- |
| 0 | **Policy:** accept [ADR 0007](decisions/0007-hosted-backups-and-retention.md) | Owner | Documentation | **Done 2026-11-07** |
| 0a | **Billing check** ([Cost and quotas](#cost-and-quotas)), and a budget only if the owner chooses | Owner | None, or one budget | Usage this cycle, payment method present or not, the budget's amount and "stop usage" setting |
| 1 | **Generate the age key pair** offline ([Encryption and key custody](#encryption-and-key-custody)) | Owner only | None in any service | The public recipient `age1…` (not secret) |
| 2 | **Verify custody:** the identity and passphrase in Proton Pass, and an independent offline copy (drive and paper, the passphrase kept apart). Decrypt a throwaway test file with the **offline** copy | Owner only | None | "Offline identity decrypts the test file", with the date |
| 3 | **Create and audit `refrain_backup`** in Neon ([The backup role](#the-backup-role)), through `/refrain-db-change` | Owner. An agent may help only if authorized for exactly this; the owner sets the password with `\password` | One read-only role in the production database | `backup-role-audit.sql` prints `result\|pass`; an attempted write is refused with `42501`; Neon accepted the grants and `neondb_owner` is the role that runs migrations (the default privileges depend on it); the direct (not `-pooler`) host; a `verify-full` connection succeeds |
| 4 | **Create `RaioViajante/refrain-backups`, private**, with no collaborators | Owner, or an agent the owner authorizes | A new private repository | Visibility `PRIVATE`, collaborators none |
| 5 | **Configure it.** Vendor `ops/backup/` into `toolkit/` from a reviewed `refrain` commit, with `SHA256SUMS` and `SOURCE`. Add the workflows **without their `schedule:` triggers**, so nothing runs before step 8 passes. Then add:<ul><li>the environment `production-backup`, deployment branches limited to `main`;</li><li>the two secrets in the environment, entered in GitHub's interface or by `gh secret set` reading from standard input, never as an argument;</li><li>the recipient variable;</li><li>`main` protected (no force push, no deletion);</li><li>`CODEOWNERS`, with its comment corrected: the template's comment still mentions a ruleset requiring a review, which Pro does not offer and this plan does not use. Correct it in the template too, in a separate change, before vendoring.</li></ul>Fork pull-request workflows stay off | Owner, or an agent for everything except the secrets | Repository settings | The `SOURCE` commit, `sha256sum --check` passing, the workflow diff against the templates (only the removed `schedule:` blocks), the settings as configured |
| 6 | **One manual backup:** `workflow_dispatch` of `backup.yml`. **This is the first export of production data** | Owner's authorization for this run | One run, one artifact | **Private log:** run ID, billed minutes, the summary's counts and digests. **Public #65:** the run's conclusion, billed minutes, and "logs and summary inspected: no credential, plaintext, or content" |
| 7 | **Download and decrypt** with the owner's **offline** identity ([Monthly owner copy and drill](#monthly-owner-copy-and-drill)) | Owner only | None in any service | `check` passes, and the `.sha256` matches |
| 8 | **Genuine PostgreSQL 18 restore drill** on `postgres-test-18` | Owner (an agent may run the commands without the key) | Local disposable server only | `drill passed`, and `pnpm db:test18:down` run |
| 9 | **Copies outside GitHub:** iCloud Drive and the offline drive | Owner only | None in any service | `shasum -a 256 -c` passes on each copy |
| 10 | **Enable the schedules:** the owner commits the `schedule:` blocks of both workflows, exactly as templated, so failure notifications go to the owner | Owner | Two scheduled workflows | The commit, and the first scheduled backup and freshness runs |
| 11 | **Seven consecutive successful scheduled runs**, with freshness green | Automatic | None | Run IDs and dates. A failure or a missed day restarts the count |
| 12 | **Recovery rehearsal** ([Recovery](#recovery)) into a new database, never the serving one, including the demotion to private and the reconciliation, timed (closing criterion 7). The target, a new Neon branch or database or the local disposable server, is the owner's choice and needs its own authorization | Owner | A new, non-serving database, or none | The time taken, `recovery-check.sql` passing, the target dropped afterwards |
| 13 | **Record the evidence** and ask for the owner's review of G6 (#47) | Owner | None | Public #65: attestations only. Private log: the details |

**The fastest safe path to the first verified backup** is steps 0a to 8, probably in one session of about two hours (an estimate):
- The owner does 0a, 1, and 2 alone.
- The owner can authorize 3, 4, 5, and 6 together, as one bundle with a stop after each step.
- The owner does 7 and 8, the only steps that need the private key.

Nothing is scheduled until step 8 passes.

## Closing F-02 and G6

F-02 and G6 close only on recorded evidence that the owner has reviewed:

1. ADR 0007 is accepted (retention, deletion, and the recovery rules). **Met on 2026-11-07.**
2. `refrain_backup` exists in Neon, and its audit prints `result|pass`. The runtime role and the owner credentials are not used by the automation.
3. The scheduled job has run successfully for at least 7 consecutive days. Each run restored its dump into PostgreSQL 18 and passed the comparison, and the freshness check is green.
4. At least one **real encrypted bundle** has been downloaded, checked, decrypted with the owner's key **from the offline copy**, and drilled on the Mac with `drill passed`.
5. A copy of that bundle exists outside GitHub (iCloud Drive and the offline drive), and its `shasum -c` passes.
6. Logs, summaries, and artifacts were inspected and hold no plaintext, credential, or content.
7. The recovery procedure has been rehearsed into a new database (not the serving one) at least once, including the demotion to private, and the time it took is recorded.

## Remaining risks

- **One GitHub account** holds both the automation and up to 90 days of bundles. The monthly copy limits the loss to a month.
- **Monthly copies depend on the owner's habit.** A missed month widens the gap, and the private log makes it visible. **Their expiry also depends on the owner:** the separate monthly reminder is what keeps the 12-month limit.
- **Key loss is unrecoverable.** That is why there are two independent copies, and a test of the offline one.
- **The included allowance can be exhausted** (blocked runs, or a charge if a payment method is on file without a stopping budget). The freshness check reports it.
- **Neon-specific behavior is untested locally:**
  - whether Neon allows the grants and default privileges as written;
  - TLS `verify-full` with `sslrootcert=system` against Neon's certificate chain;
  - snapshot export on the direct endpoint;
  - compute auto-suspend during a run;
  - whether the Neon database has extensions that the stock PostgreSQL 18 image lacks. A whole-database dump would carry their `CREATE EXTENSION`, and the restore check would then fail loudly every day until it is handled.
  All are checked at the first dispatch.
- **Permanently deleted writing survives** in bundles for up to 90 days and in monthly copies for up to 12 months ([ADR 0007](decisions/0007-hosted-backups-and-retention.md)).
- **The recovery demotion is a manual step** with a tested script and a refusing check. Nothing stops an operator who skips both, except the procedure, and public reads staying off until the gates are re-run.
- **The passphrase-protected identity** is tested with disposable keys through a pseudo-terminal. The owner's real key and the offline copy are first exercised at the first drill.
- **The macOS `db:backup:verify --postgres=18` route** restores a decrypted dump but does not compare it with the backup-time fingerprint. The drill does that. CI runs the backup suite against the Compose `postgres-test-18` service, so this route is tested there too, with no test skipped.
