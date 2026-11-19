# Cutover: refrain.raioviajante.com moves to the new Refrain

**Executed only with the owner's final approval** ([decision 0002](../decisions/0002-mixtape-archive-product.md) § 7). Until then the archived music diary (Vercel project `refrain`, its Neon databases `refrain-db` and `refrain-v3-staging`) keeps serving the domain, untouched.

| | New Refrain | Archived music diary (v3) |
| --- | --- | --- |
| Vercel project | `refrain-mixtapes` (no Git connection; deploys from a checkout) | `refrain` |
| Database | Neon `refrain-mixtapes-db` (São Paulo, free plan) | Neon `refrain-db`, `refrain-v3-staging` — never modified or deleted here |
| Protection | Vercel Authentication on **all** deployments (`ssoProtection: all`) | unchanged |

Run every command from a checkout linked to `refrain-mixtapes` (`cat .vercel/project.json` must say `"projectName":"refrain-mixtapes"`). Keep every pulled env file outside the repository and delete it afterwards.

## 0. Ready to start (all must be true)

- [ ] `main` contains the release; CI is green on it (unit, integration, Playwright).
- [ ] In the preview, the owner signed in with their own credentials (`pnpm studio:credentials`), reviewed and **published** the tapes and texts meant for launch, and uploaded the photographs with rights confirmed.
- [ ] Indexing decided: pages keep `noindex` until the owner says otherwise (`next.config.ts`, `src/app/layout.tsx`).
- [ ] The drawn marks, cursors, and favicons stay off unless their rights are documented (`docs/assets.md`).

## 1. Backups (and a tested restore) before anything moves

1. New database: `vercel env pull <outside>/preview.env --environment=preview --yes`, then `scripts/backup-hosted.sh <outside>/preview.env`. It must end with **"restore verified: every table matches."** Keep `backups/refrain-*.dump` and its `.sha256` (git-ignored) and copy them to a second place.
2. Archived music diary (read-only, for rollback insurance): pull **its** production env into a separate file and run `pg_dump --format=custom` against it with the same Docker image (or `scripts/backup-hosted.sh` with that file), restore-test it the same way. Nothing is written to its database.

## 2. Production configuration of `refrain-mixtapes`

1. Database: connect `refrain-mixtapes-db` to the **Production** environment (Vercel → Storage → refrain-mixtapes-db → Projects → environments). The owner's reviewed content is already there.
   - Afterwards, previews should not write to the production database: disconnect it from Preview, or point Preview at a Neon branch.
2. Owner credentials: `pnpm studio:credentials production` (prompts; nothing printed).
3. Confirm with `vercel env ls production`: `DATABASE_URL`, `STUDIO_EMAIL`, `STUDIO_PASSWORD_HASH` present.
4. Migrations: `HOSTED_DATABASE_URL=… node scripts/migrate-hosted.mts --expect-host <host>` (dry run), then with `--apply` if anything is pending.

## 3. Production deployment (still private)

1. `vercel deploy --prod --yes` from the release commit (`git status` clean, `git rev-parse HEAD` = the approved commit).
2. Verify through the protection with `vercel curl --deployment <url>`: `/`, `/mixtapes`, a published tape, `/sobre` → 200; a draft tape → 404; `/studio` → 307 to `/studio/entrar`; a private photo → 404; a published cover → 200.
3. Sign in to `/studio` on the production deployment URL (Vercel login first) and open the dashboard.

## 4. Domain switch (the only public step)

1. Allow the custom domain through Vercel Authentication, keeping every `*.vercel.app` URL protected: set `refrain-mixtapes` protection to `all_except_custom_domains`.
2. Move the domain: remove `refrain.raioviajante.com` from project `refrain`, add it to `refrain-mixtapes` (`vercel domains add refrain.raioviajante.com`, or Project → Settings → Domains). Both projects are in the same team, so DNS does not change; wait for the certificate (minutes).
3. If Vercel asks for a DNS change (TXT/CNAME), stop and ask the owner: it means the domain is verified elsewhere.

## 5. After publication (within 15 minutes)

- `curl -sI https://refrain.raioviajante.com/` → 200, `X-Robots-Tag: noindex, nofollow` (until indexing is decided), valid TLS.
- Pages: home, catalogue, every published tape, sobre, 404 — at 1440 and 390 px; footer and header links.
- Privacy: a draft tape → 404; `/studio` → sign-in; a draft photo `/fotos/<id>` → 404; previews require a session.
- Studio: sign in, save a harmless change and revert it, sign out.
- Vercel → `refrain-mixtapes` → Logs: no 5xx.

## 6. Rollback (any check fails)

1. Remove `refrain.raioviajante.com` from `refrain-mixtapes`; add it back to `refrain` (the archived deployment is untouched and still built). Minutes; no DNS change.
2. Restore `refrain-mixtapes` protection to `all`.
3. Data: nothing to restore for the archive. For the new database, restore the step-1 dump into a Neon branch if content was damaged.

## 7. Afterwards (separate owner decisions)

- Revoke the preview's "automation bypass" secret if no longer needed (Project → Settings → Deployment Protection).
- Schedule backups of the new database (e.g. weekly `scripts/backup-hosted.sh`).
- Retire the archived project and databases only on the owner's explicit instruction; never delete them as part of this cutover.
