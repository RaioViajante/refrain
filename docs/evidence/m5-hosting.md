# Evidence: M5 Hosting, Stages S1 and S2

The record of the first two stages of [Hosted Launch](../hosted-launch.md), executed on 2026-11-06 with the owner's separate authorization for each.
- **S1:** `refrain.raioviajante.com` attached and protected.
- **S2:** the Studio moved to that domain.

Nothing here makes anything public. Vercel Authentication covers All Deployments, the public-reads switch is off, and **every hosted release gate (G1–G8, #47) stays open**.

The checks recorded statuses, headers, and booleans only: never a credential, cookie, token, or journal text.

## S1: the protected custom domain

| Step | Evidence |
| --- | --- |
| Preflight | `main` `4caf07b`, CI green. `dpl_HTKitAaHNyYV67zf8bUHyp95ZdNq` (`6115e17`) the only Ready deployment, both production aliases on it. All Deployments protection: no bypass, password, trusted IP, or OPTIONS allowlist. Git deployments disabled. `BETTER_AUTH_URL=https://refrain-chi.vercel.app`; `REFRAIN_PUBLIC_READS_ENABLED=false`. The domain was not attached to any project or alias in the team, and was `NXDOMAIN` on 1.1.1.1, 8.8.8.8, and 9.9.9.9 |
| Vercel (19:58 UTC) | `vercel domains add refrain.raioviajante.com refrain`: a production domain, `verified: true` (the apex is verified in the same team, so no `TXT` record was needed), no redirect, no Git branch. Its alias went to `dpl_HTKit…` automatically, so no correction was needed |
| Cloudflare (by the owner) | `refrain.raioviajante.com. 300 IN CNAME c12e5e7322cdc695.vercel-dns-016.com.`, DNS only. Cloudflare's authoritative nameserver returns it, with no proxy addresses. The other records (`raioviajante.com`, `www`, `dump`, `docs`, `lab`) answer with their own Vercel targets |
| DNS | The same `CNAME` from 1.1.1.1, 8.8.8.8, and 9.9.9.9. Vercel's domain configuration: `misconfigured: false`, and `vercel domains verify` reports "configured_correctly" |
| TLS | Let's Encrypt (`YR1`), subject and SAN `refrain.raioviajante.com`, valid 2026-11-06 19:08 UTC to 2027-02-04. `curl` and `openssl` verify it. The first handshakes failed for a few minutes while it was being issued. HTTP answers `308` to HTTPS |
| Protection | Twelve anonymous paths (the Studio, public routes, sitemap, `robots`, `get-session`, RSC forms) each answer the same 263-byte `302` to Vercel's sign-in, with no application content. An anonymous `POST` gets `401` from Vercel |
| Unchanged | The aliases, the deployment, protection and Git settings, all 26 environment variables, and no new deployment |

## S2: the Studio on the canonical domain

**Preflight, immediately before any change:**
- `main` was `4caf07b`, CI green.
- All three production addresses pointed at `dpl_HTKit…`, checked by **alias**, not by the project's production-target field, which named a cancelled deployment.
- Protection and Git deployments were unchanged, and public reads were off.
- The owner confirmed that Studio sign-in still worked on `refrain-chi.vercel.app`, which proves the rollback path.
- `vercel promote` was available.
- **Database baseline** (read-only, as the runtime role): PostgreSQL 18.6; 1 user, 0 sessions, 1 `[Test]` artist, 1 album, 2 tracks, 2 entries, 0 published versions.

**The cutover:**

| Step | Evidence |
| --- | --- |
| Environment (20:25:29 UTC) | Production `BETTER_AUTH_URL` changed from `https://refrain-chi.vercel.app` to `https://refrain.raioviajante.com`. That was the only variable changed: 26 before and after, none removed. Public reads stayed `false` |
| Source | A fresh clone checked out at `4caf07bbb239a08b96d68e2c8c770c092c1b197f`, tree `713699e…`. Its only untracked item was the `.vercel/` project link. A separate clone of the same commit passed `pnpm install --frozen-lockfile` and `pnpm build` |
| Staged deployment | `vercel deploy --prod --skip-domain`: `dpl_BzRwrBYXiX9U7dDVp23kbXxhDWr7`, Ready, `STAGED`, no alias, region `gru1`, metadata `githubCommitSha 4caf07b`. `gitDirty: 1` reflects the `.vercel/` link folder only. **The uploaded source files are exactly the 458 tracked files except `.gitignore`**, with nothing untracked. No production alias moved |
| Staged checks, anonymous | Seven paths gave Vercel's `302`, with no application content. An anonymous `POST` got `401` |
| Staged checks, with the owner's Vercel session (no Refrain sign-in) | The sign-in page renders. The reviewed F-01 probe (SHA-256 `02cd786…`): all 26 Studio responses `private, no-store`; no `[Test]` text, Desk, or session; 8 redirects to sign-in. `get-session` is `no-store`. With reads off, public routes, the sitemap, and `robots` answer the identical `404` with `no-store`, and the Home answers its generic page (ADR 0006 A4). A sign-in `POST` with synthetic credentials is refused, `403 INVALID_ORIGIN` |
| Promotion (20:30:40 UTC) | `vercel promote dpl_BzRwrBYXiX9U7dDVp23kbXxhDWr7`, with no rebuild. `refrain.raioviajante.com`, `refrain-chi.vercel.app`, and `refrain-bryanalvarenga-5889s-projects.vercel.app` all moved to it |
| Signed-in checks on `https://refrain.raioviajante.com`, owner's sign-in (20:36 UTC) | Sign-in `200`; the Desk visible; the session persists across two reloads. Catalog, Artists, Albums, Journals, and Memories each `200`, `private, no-store`. The F-01 probe as the author: 26 Studio responses `private, no-store`, author content present. 97 router RSC and prefetch requests, all `private, no-store`. No 5xx |
| The old origin | On `refrain-chi.vercel.app`, the session is not visible (cookies are host-only), and a sign-in `POST` is refused, `403 INVALID_ORIGIN` |
| Sign-out | `200`. `get-session` then shows no session. The F-01 probe without a session: 26 Studio responses `private, no-store`, no author content, 8 redirects to sign-in |
| After | Database row counts identical to the baseline. Protection and Git settings identical. Public reads `false`. Anonymous `/studio` answers Vercel's `302` on both hostnames. Only one deployment was made, and only one promoted |

## Observations and limits

- **Write test: none,** by the owner's choice. Refusal of unauthenticated Server Actions was not replayed against the host, because that would need the framework's internal action identifiers. It is covered by the HTTP test suite on this commit (561 tests, including every Studio action without a session). On the host, every Studio page, RSC, and prefetch request without a session was refused.
- **Cache indicator on public `404`s.** With reads off they carry `x-vercel-cache: HIT` alongside `no-store`. It is generic content, but it is part of the open **G2** item on cache-hit indicators, not something S2 introduced.
- **Vercel Authentication's own callback** (`307` to `/studio/sign-in`) carries `public, max-age=0, must-revalidate`. It is a platform response before the application, already recorded under G2.
- **The first canonical check window** was closed by accident before sign-in, and was rerun. The partial run shows only the expected behaviour: the sign-in page, the generic Home, and `404`s.

## Rollback (still available)

`dpl_HTKitAaHNyYV67zf8bUHyp95ZdNq` (`6115e17`) is Ready, and keeps its own `BETTER_AUTH_URL=https://refrain-chi.vercel.app`. To roll back:
1. `vercel promote dpl_HTKitAaHNyYV67zf8bUHyp95ZdNq`.
2. Check all three aliases.
3. Set Production `BETTER_AUTH_URL` back to `https://refrain-chi.vercel.app`.
4. Confirm the Studio sign-in on `refrain-chi`.

Protection stays on All Deployments and reads stay off. The deleted vulnerable deployment (`cd34f06`) is never a target.
