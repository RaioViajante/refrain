# Cutover: refrain.raioviajante.com moves to the new Refrain

**Executed only with the owner's final approval** ([decision 0002](../decisions/0002-mixtape-archive-product.md) § 7). **Executed on 2026-11-20** (see [Execution record](#execution-record-2026-11-20)); the steps below describe what was actually done and still apply to a repeat or a rollback.

| | New Refrain | Archived music diary (v3) |
| --- | --- | --- |
| Vercel project | `refrain-mixtapes` (no Git connection; deploys from a clean export of the approved commit) | `refrain` (still Git-connected to this repository; every push to `main` creates a production record that its Ignored Build Step cancels) |
| Database | Neon `refrain-mixtapes-db` (São Paulo, free plan), shared by Preview and Production | Neon `refrain-db`, `refrain-v3-staging` — never modified or deleted here |
| Protection | `all_except_custom_domains` after the cutover (custom domain public; deployment URLs behind Vercel Authentication) | `all` — every deployment **and its custom domain** behind Vercel Authentication, since the v3 presentation (2026-11-15–17) |

Run every command from a checkout linked to `refrain-mixtapes` (`cat .vercel/project.json` must say `"projectName":"refrain-mixtapes"`). Keep every pulled env file outside the repository (`umask 077`) and delete it afterwards. Never print credentials, cookies, or the bypass secret.

## 0. Ready to start (all must be true)

- [ ] `main` contains the release; CI is green on it (unit, integration, Playwright).
- [ ] In the preview, the owner signed in with their own credentials (`pnpm studio:credentials`), reviewed and **published** the tapes and texts meant for launch, and uploaded the photographs with rights confirmed.
- [ ] Indexing (decided by the owner): the public site is indexable once officially published. Only a **production** deployment with `SITE_INDEXABLE=true` drops `noindex` (`src/lib/indexing.ts`); previews, local builds, and the Studio always send `noindex`, and `robots.txt` always disallows `/studio`.
- [ ] The drawn marks, cursors, and favicons stay off unless their rights are documented (`docs/assets.md`).
- [ ] `.vercelignore` excludes `backups/`, dumps, `local/`, `reference/`, and `.env*`.

## 1. Backups (and a tested restore) before anything moves

`scripts/backup-database.sh <env-file> <label>` works for any PostgreSQL database: it discovers the tables itself, connects to the source **read-only** (`default_transaction_read_only=on`, enforced by the server), writes `backups/<label>-<UTC>.dump` with its `.sha256` (git-ignored), restores it into a throwaway container, and compares, for every table, the row count and a content checksum (an md5 per row over its full text, photos' bytes included, sorted and combined). It prints **"restore verified"** only if every table matches; otherwise it fails with the differing tables. `BACKUP_SELFTEST_TAMPER=1` alters the throwaway copy to prove a difference is caught (it must fail). It needs `PGHOST`/`PGHOST_UNPOOLED`, `PGUSER`, `PGPASSWORD`, `PGDATABASE`.

1. **New Refrain:** `vercel env pull <outside>/preview.env --environment=preview --yes` (from this checkout, linked to `refrain-mixtapes`), then `scripts/backup-database.sh <outside>/preview.env refrain-prelaunch`. Copy the `.dump` and `.sha256` to a second place outside the repository and compare the hash (the `.sha256` records the `backups/…` path, so compare the digest directly).
2. **Archived music diary (another schema; never modified):** its `DATABASE_URL` is a **sensitive** Vercel variable, so `vercel env pull` returns it empty and the CLI cannot back it up. Take the backup from the Neon console instead (create a branch of `refrain-db` as a point-in-time snapshot, or `pg_dump` with the connection string from the console, then `scripts/backup-database.sh` on an env file with the `PG*` variables). The cutover never touches this database.

## 2. Production configuration of `refrain-mixtapes`

1. Database: Production uses the same Neon database as Preview (the owner's content is there). `DATABASE_URL` was added to Production as a **sensitive** variable with the Preview value, piped from the pulled env file (`printf '%s' "$value" | vercel env add DATABASE_URL production --sensitive`), never printed.
   - The Neon integration is still connected to Preview only: if Neon rotates the password, update the Production variable (or connect the integration to Production in Vercel → Storage).
   - Preview deployments write to the same database; deploy previews only on purpose, or point Preview at a Neon branch.
2. Owner credentials: the **owner** runs `pnpm studio:credentials production` in their own terminal (prompts without echo; hashes locally; nothing printed).
3. Indexing: `printf true | vercel env add SITE_INDEXABLE production` (Production only; never Preview).
4. Confirm with `vercel env ls production`: `DATABASE_URL`, `STUDIO_EMAIL`, `STUDIO_PASSWORD_HASH`, `SITE_INDEXABLE` present, all created **before** the deployment of step 3 (variables apply only to deployments created after them).
5. Migrations: `HOSTED_DATABASE_URL=<unpooled URL> node scripts/migrate-hosted.mts --expect-host <unpooled host>` (dry run), then with `--apply` if anything is pending.

## 3. Production deployment (still private)

1. Deploy a clean export of the approved commit, never the working checkout (local dumps and private files must not be uploaded):
   `git archive <sha> | tar -x -C <tmp>`, copy `.vercel/project.json` into `<tmp>/.vercel/`, then from `<tmp>`: `vercel deploy --prod --yes --meta gitCommitSha=<sha>`. Protection is still `all`, so the new production is private.
2. Verify through the protection with `vercel curl <path> --deployment <id>` (GET/HEAD only): `/`, `/mixtapes`, every published tape, `/sobre` → 200; a draft tape → 404; `/studio*` → 307 to `/studio/entrar`; every photo `/fotos/<id>` → 200 if rights are confirmed and it is in public use, otherwise 404; `/robots.txt` → `Allow: /`, `Disallow: /studio`.
   - On `*.vercel.app` URLs Vercel itself adds `X-Robots-Tag: noindex`; check indexing on the custom domain (step 5).
3. Render check in a browser at 1440 and 390 px (header `x-vercel-protection-bypass` from the project's automation bypass, held in memory only): status, no horizontal scroll, no broken images, no 5xx. Use `prefers-reduced-motion: reduce` for full-page screenshots; the scroll-driven reveals hide off-screen content otherwise.
4. Studio with real authentication, by the **owner** in their own interactive terminal: the hosted smoke (`playwright.hosted.config.ts`) with `HOSTED_STUDIO_EMAIL` / `HOSTED_STUDIO_PASSWORD` read without echo, `--trace off`, and a JSON report. It passes only with **3 passed, 0 skipped, 0 failed, 0 flaky** (the authenticated test skips itself when the credentials are empty, so a skip is a failure). The smoke leaves one `[Test]` tape, song, and photo: remove them through the Studio right after, and confirm read-only that no `[Test]` record remains.
5. Logs: `vercel logs --deployment <id> --since 1h --json`. The PostgreSQL driver's `sslmode` deprecation warning is logged at level `error` on each cold start; it is not a request error.

## 4. Domain switch (the only public step)

1. Record the rollback state: `GET /v4/aliases/refrain.raioviajante.com` (the v3 deployment it serves) and the `refrain` project's `ssoProtection`.
2. Set `refrain-mixtapes` protection to `all_except_custom_domains` (`PATCH /v9/projects/<id>` with `{"ssoProtection":{"deploymentType":"all_except_custom_domains"}}`). Nothing becomes public until the domain is attached.
3. Move the domain: remove `refrain.raioviajante.com` from project `refrain` (`DELETE /v9/projects/<refrain id>/domains/refrain.raioviajante.com`; the team domain and DNS stay), then add it to `refrain-mixtapes` (`POST /v10/projects/<id>/domains` with `{"name":"refrain.raioviajante.com"}`). Both projects are in the same team, so it is verified at once and DNS does not change.
4. If Vercel asks for a DNS change (TXT/CNAME), stop and roll back (step 6): it means the domain is verified elsewhere.
5. Confirm `GET /v4/aliases/refrain.raioviajante.com` points to the new production deployment.
6. `all_except_custom_domains` also exempts the project's own `refrain-mixtapes.vercel.app` domain, which then serves the site publicly. Redirect it: `PATCH /v9/projects/<id>/domains/refrain-mixtapes.vercel.app` with `{"redirect":"refrain.raioviajante.com","redirectStatusCode":308}`. Deployment URLs (`refrain-mixtapes-<hash>-…vercel.app`) stay behind Vercel Authentication.

## 5. After publication (within 15 minutes)

- `https://refrain.raioviajante.com/` → 200, valid TLS (Let's Encrypt), **no** `X-Robots-Tag` and no meta `noindex` on public pages; `/studio/entrar` → `X-Robots-Tag: noindex, nofollow`; `/robots.txt` allows `/` and disallows `/studio`.
- Pages: home, catalogue, every published tape, sobre, 404 — at 1440 and 390 px, no horizontal scroll, no broken images.
- Privacy: a draft tape → 404; `/studio*` → sign-in; every private photo `/fotos/<id>` → 404 and every public one → 200; `/backups/…`, `/.env` → 404.
- Protection: every deployment URL of `refrain-mixtapes` → 302 to Vercel login; `refrain-mixtapes.vercel.app` → 308 to the domain.
- Logs: nothing but the known `sslmode` warning; no 5xx.
- Do not run the hosted smoke (it publishes a `[Test]` tape for a few seconds) on the public domain; it ran on the same deployment in step 3.

## 6. Rollback (any check fails)

The v3 deployment it returns to is protected (`ssoProtection: all` on project `refrain`): rollback restores the pre-launch state, **a domain behind the Vercel login**, not a public v3. Making v3 public again is a separate owner decision (its protection to `all_except_custom_domains`).

1. Restore `refrain-mixtapes` protection to `all`.
2. Remove `refrain.raioviajante.com` from `refrain-mixtapes`; add it back to project `refrain` (`POST /v10/projects/<refrain id>/domains`).
3. Pin the domain to the recorded v3 deployment explicitly (the `refrain` project's production target is a canceled Git record, so do not rely on the default): `vercel alias set <v3 deployment id> refrain.raioviajante.com`, then confirm with `GET /v4/aliases/refrain.raioviajante.com`. No DNS change.
4. Data: nothing to restore for the archive. For the new database, if content was damaged, restore the step-1 dump into a new Neon branch with `pg_restore` (Neon accepts it unchanged) and point the project at it.

## 7. Afterwards (separate owner decisions)

- Revoke the "automation bypass" secret if no longer needed (Project → Settings → Deployment Protection).
- Schedule backups of the new database (e.g. weekly `scripts/backup-database.sh`).
- Back up the archived music diary's database from the Neon console (step 1.2).
- Retire the archived project and databases only on the owner's explicit instruction; never delete them as part of this cutover.

## Execution record (2026-11-20)

- Release: `main` `889951392632f24e668bd85724213af4da7c409b`, CI green (run 44643900894).
- Backup: `refrain-prelaunch-20261120T012358Z.dump` (8 848 129 bytes, SHA-256 `bdbe7fea…45d4`), restore verified (10 tables: 7 tapes, 174 songs, 174 tracks, 39 texts, 18 images with their files, 11 slots); second copy outside the repository, same digest. v3 backup not taken (sensitive variable; § 1.2).
- Production: `dpl_45fLXJubB9HxXcdjJ6q8X815ADeT` from a `git archive` of the release; migrations 4 of 4 already applied; Production variables created before the deployment.
- Private checks: pages, 7 tapes, 18 photos (8 public, 10 private), `robots.txt`, Studio redirects; render at 1440 and 390 px; owner-run hosted smoke 3 passed / 0 skipped, `[Test]` records removed (0 left, content counts unchanged).
- Publication: protection `all_except_custom_domains`; domain moved from `refrain` (it served v3 `dpl_AeGB1pLbYH9G4pipheh8V52ydcim`) to `refrain-mixtapes`, verified without DNS change; `refrain-mixtapes.vercel.app` redirected (308) to the domain.
- Public checks: TLS valid, public pages indexable, Studio `noindex`, 7 tapes 200, 18 photos as expected, deployment URLs 302, render at 1440 and 390 px clean, logs without errors besides the `sslmode` warning.
- Rollback ready: v3 `dpl_AeGB1pLbYH9G4pipheh8V52ydcim` is `READY`, `refrain` protection unchanged (`all`), DNS unchanged.
