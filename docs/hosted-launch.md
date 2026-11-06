# Hosted Launch: Custom Domain and Public Release (M5)

**Status: plan only (2026-11-06).** Nothing below has been executed:
- no DNS record, Vercel domain, environment variable, deployment, or protection setting has changed;
- public reads stay off;
- every hosted release gate (G1 to G8, [#47](https://github.com/RaioViajante/refrain/issues/47)) stays open.

Each stage in [Authorization](#2-stages-and-authorization) needs the owner's separate, explicit approval.

The goal: `https://refrain.raioviajante.com` becomes Refrain's canonical address, first **protected** (only the owner can reach it), and **public** only after the release gates close. The Studio stays private throughout: behind Better Auth, and server-side authorization on every request and action.

## 1. Current state

Inspected read-only on 2026-11-06. **Production is not `main`.**

| What | Value | Source |
| --- | --- | --- |
| `main` | `abedc396dbe52d7e6c7e0359d5c1180dbad55a42`, CI green (run 42256472096) | GitHub |
| Production deployment | `dpl_HTKitAaHNyYV67zf8bUHyp95ZdNq`, Ready and promoted, region `gru1` | Vercel API |
| Its source | `6115e17ec1545551a653ff5464d29b387995171e` (the F-01 fix): a CLI upload of a clean checkout, not a Git build | Vercel API (`source: cli`), [F-01 evidence](security.md#studio-responses) |
| `6115e17` → `abedc39` | No runtime change. Build inputs differ only by one new `package.json` script (`test:backup`); everything else is tests, documentation, and the `ops/` backup toolchain, which the application never imports | `git diff` |
| Production addresses | `refrain-chi.vercel.app` (the project's only domain) and `refrain-bryanalvarenga-5889s-projects.vercel.app` (assigned automatically), both on `dpl_HTKit…` | Vercel API |
| Other aliases | Seven Git-branch aliases (`refrain-git-…`), each on a **cancelled** deployment | Vercel API |
| Deployments | 1 Ready (production); every other is cancelled (7 production, 16 preview) | Vercel API |
| Deployment Protection | Vercel Authentication on **All Deployments**; no password protection, no trusted IPs, no bypass tokens | Vercel API |
| Git deployments | `createDeployments: disabled`, plus the Ignored Build Step; Git fork protection on | Vercel API |
| Production environment (names only) | `DATABASE_URL`, `BETTER_AUTH_SECRET`, `REFRAIN_AUTHOR_EMAIL` (sensitive); `BETTER_AUTH_URL` (= `https://refrain-chi.vercel.app`); `REFRAIN_PUBLIC_READS_ENABLED` (= `false`, also in Preview); four provider base URLs | Vercel API |
| DNS | `raioviajante.com` on Cloudflare nameservers. Its apex already serves another project of the same Vercel team (`raioviajante.com`), and the domain is **verified in this team**. `refrain.raioviajante.com` does not exist (`NXDOMAIN`). No CAA record | `dig @1.1.1.1`, Vercel API |
| Recommended DNS target for the subdomain | `CNAME c12e5e7322cdc695.vercel-dns-016.com.` (rank 1; `cname.vercel-dns.com.` rank 2) | Vercel API `GET /v6/domains/refrain.raioviajante.com/config` |
| Vercel CLI | 64.0.1: `deploy --prod --skip-domain` and `promote` are supported | `vercel deploy --help` |

**Better Auth and origin checks** (from the code, [`src/modules/identity`](../src/modules/identity/), Better Auth 1.7.12 as installed):
- **One origin:** `baseURL` and the only `trustedOrigins` entry are both `BETTER_AUTH_URL`.
- **Two exact-origin checks, before the library:**
  - the authentication handler refuses any `POST` whose `Origin` is not exactly that value, with `403 INVALID_ORIGIN` ([`handler.ts`](../src/modules/identity/handler.ts));
  - every Studio Server Action calls `hasTrustedOrigin()`, the same exact comparison, after authorizing ([`authorization.ts`](../src/modules/identity/authorization.ts)).
- **Cookies:** host-only (no `Domain` attribute), `__Secure-refrain.session_token` over HTTPS, `HttpOnly`, `SameSite=Strict`. CSRF and origin checks are explicitly on (`disableCSRFCheck: false`, `disableOriginCheck: false`).
- **Sessions:** a fixed lifetime, never refreshed, read from PostgreSQL on every check.
- **Sign-in rate limit:** 5 a minute in **one bucket shared by every client**, because no proxy header is trusted.
- **Absolute URLs:** the public pages' canonical metadata and the sitemap take their origin from `BETTER_AUTH_URL` too ([`public-reads.ts`](../src/modules/publication/public-reads.ts)), so they follow the cutover automatically.
- **Hostname:** nothing in the application redirects a request to a canonical host today.

## 2. Stages and authorization

Each stage is a separate owner approval. Later stages never start because an earlier one succeeded.

| Stage | What changes | Still true afterwards |
| --- | --- | --- |
| **S0. Decisions** | Nothing in production. The owner decides on [§ 8](#8-owner-decisions-before-execution) | Everything as above |
| **S1. Attach the domain, protected** | A DNS-only `CNAME` in Cloudflare, and `refrain.raioviajante.com` added to the Vercel project as a production domain | All Deployments protection; public reads off; production still `dpl_HTKit…` with `BETTER_AUTH_URL=https://refrain-chi.vercel.app`, so the Studio is still used on `refrain-chi` |
| **S2. Move authentication to the domain** | `BETTER_AUTH_URL` (Production) becomes `https://refrain.raioviajante.com`; a staged production deployment of the approved `main` from a clean checkout; verification; promotion | All Deployments protection; public reads off; the Studio moves to the custom domain |
| **S3. Hosted gate work** | The [launch-critical fixes](#7-minimal-launch-critical-fixes) and the gate evidence, each as its own reviewed PR and verification | Protected; public reads off |
| **S4. Public release** | Only when every gate in [§ 6](#6-hosted-release-gates-g1g8-and-their-dependencies) is closed by owner-reviewed evidence: public reads on, and protection changed so that only the canonical domain is public | The Studio stays behind Better Auth; every other hostname protected or redirected |

S1 and S2 do **not** authorize S4. No gate is waived for the 2026-11-16 presentation ([§ 9](#9-academic-acceptance-plan-2026-11-16)).

## 3. DNS and TLS (stage S1)

1. **Vercel.** Project `refrain` → Settings → Domains → **Add** `refrain.raioviajante.com`, as a **production** domain (no Git branch).
   - **Ownership:** the apex is verified in the same team, so the docs give no reason to expect a `TXT` challenge (they ask for one when the domain belongs to another account). If one appears, add exactly what Vercel shows.
   - **Effect:** adding a production domain aliases it to the current production deployment (`dpl_HTKit…`). All Deployments protection covers it at once.
2. **Cloudflare** (the `raioviajante.com` zone): add `CNAME refrain → c12e5e7322cdc695.vercel-dns-016.com`.
   - **Proxy status: DNS only** (grey cloud). Vercel's guidance for Cloudflare is DNS only; a proxied record needs Full (strict), and Flexible can loop.
   - **TTL:** Auto.
   - **Copy the value Vercel's Domains page shows** at that moment. If it differs from the one above, use Vercel's.
   - **Change no other record.**
3. **Verify DNS:**
   - `dig +short CNAME refrain.raioviajante.com @1.1.1.1` and `@8.8.8.8` both show the Vercel target.
   - Vercel's Domains page shows the domain as valid; the API `GET /v6/domains/refrain.raioviajante.com/config` returns `misconfigured: false`.
4. **TLS.** Vercel issues a Let's Encrypt certificate automatically (HTTP-01, through Vercel, once the name points to it). No CAA record exists, so no issuer is restricted. Check:
   - `curl -sI https://refrain.raioviajante.com/` answers over HTTPS, with no certificate error;
   - `openssl s_client -connect refrain.raioviajante.com:443 -servername refrain.raioviajante.com </dev/null | openssl x509 -noout -issuer -subject -dates` shows the subject's name and a current validity.
5. **Protection on the new name:** anonymous `curl -s -o /dev/null -w '%{http_code} %{redirect_url}' https://refrain.raioviajante.com/studio` gives `302` to Vercel's sign-in, exactly as `refrain-chi` does today.
6. **Propagation:** the record is new, so no stale answer is cached. Recheck from two resolvers and a second network before S2.

**S1 changes nothing for the author:** sign-in still works only on `refrain-chi.vercel.app`. On the custom domain, sign-in fails closed with `403 INVALID_ORIGIN` until S2.

## 4. Better Auth cutover (stage S2)

### One canonical origin, not two

The application accepts **exactly one** origin, by design: the handler and every Server Action compare `Origin` with `BETTER_AUTH_URL` exactly.

- **Supporting both hostnames during a transition** would mean a code change: a list of exact origins in three places (`trustedOrigins`, the handler, `hasTrustedOrigin`), with its own security review and tests. It buys little, because cookies are host-only, so a session on one hostname never works on the other.
- **Recommendation:** a **single canonical origin**, switched in one step. No wildcard, no second origin, and no relaxed CSRF or origin check.

### What happens to sessions, cookies, and sign-in

- **Cookies** belong to the hostname that set them. A session made on `refrain-chi.vercel.app` is never sent to `refrain.raioviajante.com`. After S2, the author signs in once on the new domain.
- **Old sessions** stay in `auth_sessions` until they expire. They cannot be used from the custom domain. On `refrain-chi`, after S2, every Studio write and sign-out `POST` fails the origin check, so an old session can only read the Studio there. They may be left to expire, or revoked deliberately (a separate, recorded step; not required).
- **Sign-out** on the custom domain works normally. A sign-out attempted on `refrain-chi` after S2 is refused (`INVALID_ORIGIN`); the cookie simply expires.
- **Sign-in redirects** are relative (`/studio`, `/studio/sign-in`), so they stay on whichever host served the page.
- **CSRF** protection is unchanged: `SameSite=Strict` cookies and exact-origin `POST`s.
- **If sign-in fails after S2:**
  1. Check `BETTER_AUTH_URL` for an exact match: `https`, no trailing slash, the hostname spelled correctly.
  2. Check that the browser is on the custom domain, not an old hostname.
  3. Check Proton Pass autofill. The earlier failure was autofill.
  4. Otherwise, [roll back](#rollback-and-forward-recovery).

  The author's password, the account, and `BETTER_AUTH_SECRET` do not change, so no credential is rotated.

### Why the staged deployment cannot sign in

A staged production deployment (`--skip-domain`) is reached at its own generated `*.vercel.app` URL. With `BETTER_AUTH_URL=https://refrain.raioviajante.com` built in, every `POST` from that URL fails the exact-origin check. **Authenticated tests are only possible after promotion,** on the custom domain. The staged deployment is checked anonymously: protection, sign-in page, public-route `404`s with the switch off, F-01 headers.

## 5. The old hostnames

| Hostname | Kind | After S2 | Before S4 (public) |
| --- | --- | --- | --- |
| `refrain.raioviajante.com` | Production custom domain | The canonical Studio and site, protected | Public, the only public address |
| `refrain-chi.vercel.app` | Production domain of the project | Serves the same deployment. Sign-in and writes fail closed (`INVALID_ORIGIN`). Protected | **Redirect to the canonical domain**, or remove it from the project |
| `refrain-bryanalvarenga-5889s-projects.vercel.app` | Production alias assigned automatically | As above | Must be redirected by the application (it cannot be removed), and tested |
| Generated deployment URLs (`refrain-<hash>-…vercel.app`) | Per deployment | Protected | Must stay protected under the chosen mode, and tested |
| Seven Git-branch aliases (`refrain-git-…`) | Preview, on cancelled deployments | Protected | Protected; may be deleted when no longer wanted (a separate decision) |

**Why the inventory matters for S4.** Vercel documents that Standard Protection protects "all domains except production domains". It does not name the automatic production `*.vercel.app` addresses, and its migration note says the production generated URL "becomes restricted": the docs disagree with themselves on this. Two consequences:

1. Before any protection change, test every hostname above anonymously **on this project** after the change, while public reads are still off.
2. An old production hostname that ends up public must not serve the site under a second origin: duplicate content, and a sign-in page that cannot work there. The fix is a **canonical-host redirect in the application** ([§ 7](#7-minimal-launch-critical-fixes), item 2): a `308` from any production hostname that is not the canonical one to the same path on the canonical one. Optionally, also set `refrain-chi.vercel.app` to redirect in Vercel's Domains settings, if Vercel allows that for a `vercel.app` domain (not stated in its docs).

## 6. Hosted release gates G1–G8 and their dependencies

From [#47](https://github.com/RaioViajante/refrain/issues/47) and [Security § Public page release gates](security.md#public-page-release-gates). Only the owner closes a gate, on recorded evidence. **No waiver** is possible for G1, G2, the inventory of G3, the predicate and matrix tests of G5, or G8 (ADR 0006).

| Gate | Local evidence today | Missing for a hosted public site | Depends on |
| --- | --- | --- | --- |
| **G1** Status and redirect semantics | M3.1, M3.4, M3.5 HTTP tests (identical `404`, `308` only for a visible entry's old address) | The same checks on the **hosted** configuration and canonical domain. The owner's decision on a stored artist slug (artist addresses come from names; a rename leaves the old address `404`) | S2, and the switch on (for a private demo only, see § 9) |
| **G2** Cache behaviour | No shared cache, `no-store` responses, F-01 studio headers verified on the host | Through the **real public URL**: the next request after unpublish, delete, restore, unflag, rating cleared, address change, and text edit. Sitemap, metadata, back/forward. The repeated-slash `308` without `no-store` (an owner decision) | S2, G1 |
| **G3** Writers of public state | None. Not started | The inventory of every writer: application, scripts, migrations, fixtures, **restore** (the procedure exists in [Hosted Backups § Recovery](hosted-backups.md#recovery)), manual access, CI | — |
| **G4** Database-layer enforcement | None | An ADR deciding triggers, row-level security, least-privilege roles, or accepted risk; then implementation and tests | G3 |
| **G5** Predicate and configuration | The oracle and privacy matrix pass on the production build with the **test** role | The same against the production build with the **hosted role**. The secret's generation method recorded. HTTPS `BETTER_AUTH_URL`. The Studio unreachable without a session and `noindex` (it is: `robots: noindex, nofollow`). Error pages, `robots`, sitemap, and Open Graph serving only public content. Deployment-gate items 1–5 (#11) | S2, #11 |
| **G6** Backups | Toolchain built and tested ([Hosted Backups](hosted-backups.md)) | ADR 0007 accepted, provisioning, 7 green scheduled days, a real drill, a copy outside GitHub ([closing criteria](hosted-backups.md#closing-f-02-and-g6)) | #65 |
| **G7** Independent review | Per-milestone reviews in separate contexts | A review of the **public surface** as deployed. The M3.5 three-operation deadlock fixed or accepted in writing | G1–G5 implemented |
| **G8** Catalog wording | None (a documented gap) | Catalog edits (names, titles, credits, track order) change public wording without a confirmation. Resolve it, or record an independently verified safe alternative. No waiver | — |
| Deployment gate items 1–5 (#11) | Partly | **Client-aware sign-in protection** (today one shared bucket, so anyone can lock the author out once the site is public). The unauthorized `/studio` answer and its indexing. Malformed Server Action bodies. HTTPS cookies in a browser. Browser tests over HTTPS | S2 |
| Deployment gate item 6: album covers | Covers built for local use | The owner's recorded rights review (Cover Art Archive, MusicBrainz terms, attribution, removal, CSP, privacy notice), **or covers cleared** before public pages show them | — |
| Deployment gate item 7: artist photographs | Built, with licence and attribution | The per-photograph licence review, the removal channel, the privacy notice, `img-src` against the real host, **or photographs cleared** | — |
| #44 | — | The public album journal readable without JavaScript | — |
| #69 | — | The intermittent browser failure in `publication.spec.ts` explained (CI reliability for every launch PR) | — |

**Domain preparation (S1, S2) closes no gate.** It provides the hosted configuration that G1, G2, and G5 must be tested on.

## 7. Minimal launch-critical fixes

Each is its own reviewed PR, with tests, before S4. None changes production when merged: deployments are manual.

1. **Client-aware sign-in protection (#11).** Key the sign-in rate limit by a client address that the host sets and the client cannot forge, keeping a global ceiling.
   - Vercel sets client-address headers. Confirm which one is trustworthy on Vercel before configuring Better Auth's `ipAddressHeaders`.
   - Without this, a public site lets anyone lock the author out of sign-in.
2. **Canonical-host redirect.** In `src/proxy.ts`, for any request whose host is a production hostname other than the one in `BETTER_AUTH_URL`, answer `308` to the same path on the canonical origin.
   - Preview and generated deployment URLs stay as they are; they are protected.
   - Never redirect on an attacker-supplied value: compare the request host with a fixed list derived from the configuration.
   - HTTP tests cover `GET`, `HEAD`, a `POST` (which must not be followed), and the Studio.
3. **G8 catalog wording:** the owner's choice between a confirmation for catalog edits that change public wording, and an independently verified alternative (for example, refusing such edits while a page is public).
4. **G3 inventory and the G4 ADR**, then whatever G4 decides, through `/refrain-db-change`.
5. **Covers and photographs** (items 6 and 7): the owner's rights review, or clear them for the first public release.
6. **#44**, readable without JavaScript, and **#69**, the intermittent CI failure.
7. **Backups (G6)**, through #65.

Deliberately **not** proposed:
- a second trusted origin;
- a wildcard origin;
- relaxing CSRF or origin checks;
- a cache in front of public pages;
- a deployment protection bypass.

## Deployment sequence (stage S2)

On the day, with S1 done and verified:

1. **Source:**
   - the approved `main` commit, which will not be `6115e17`;
   - a fresh clone with no other files, checked out detached at that commit;
   - `git status` clean, and `git rev-parse HEAD` recorded.
2. **Checks on that commit:**
   - CI green on it;
   - locally `pnpm install --frozen-lockfile`, `pnpm build` (no `DATABASE_URL`).
3. **Environment:** Production `BETTER_AUTH_URL` → `https://refrain.raioviajante.com`. Change no other variable.
   - This does not affect the running deployment.
   - **From here, a deployment built from this project uses the new value**, so no other production deployment is made until promotion or rollback.
4. **Staged deployment:**
   - `vercel deploy --prod --skip-domain` from the clean checkout, linked to project `refrain`;
   - record the deployment ID, its URL, and `meta`;
   - check that the uploaded file list matches `git ls-files` (provenance).
5. **Anonymous checks on the staged URL:**
   - Vercel's sign-in redirect;
   - with the owner's Vercel session in a fresh browser profile: the sign-in page renders, and `POST /api/auth/sign-in/email` is refused with `INVALID_ORIGIN` (expected);
   - public routes `404` with the switch off;
   - the F-01 probe: every Studio form `private, no-store`.
6. **Promote:** `vercel promote <staged id>`. Both production aliases and the custom domain move to it. Record the time.
7. **Authenticated checks on `https://refrain.raioviajante.com`,** as in the F-01 verification:
   - sign in, the Desk;
   - CRUD of one synthetic `[Test]` record, then deleting it;
   - the F-01 probe as the author and without a session;
   - sign-out ends the session;
   - an old-hostname `POST` refused.
8. **Record:** in an evidence file, with no secret, cookie, or private content.

## Rollback and forward recovery

- **Rollback** (author cannot sign in, or a regression):
  1. `vercel promote dpl_HTKitAaHNyYV67zf8bUHyp95ZdNq`. Promotion does not rebuild, and a deployment keeps the environment it was built with, so it serves again with `BETTER_AUTH_URL=https://refrain-chi.vercel.app`, and the author signs in on `refrain-chi` as before.
  2. Then set Production `BETTER_AUTH_URL` back to `https://refrain-chi.vercel.app`, so that any later deployment matches.

  `dpl_HTKit…` carries the F-01 fix. The vulnerable `cd34f06` deployment was deleted and must never be restored or promoted.
- **Forward recovery** (preferred for anything but a failed cutover): fix on a branch, review, merge, then a new staged deployment and promotion, as above.
- **DNS:** the `CNAME` can be removed in Cloudflare at any time; the Vercel aliases are unaffected. Removing the domain from the Vercel project is also reversible. Never change the apex or any other record.
- **Never, as a recovery step:**
  - disable Vercel Authentication;
  - create a bypass;
  - turn on public reads;
  - widen the trusted origins.

## 8. Owner decisions before execution

1. **S1:** approve adding the domain in Vercel and the DNS-only `CNAME` in Cloudflare.
2. **S2:** approve the `BETTER_AUTH_URL` change, the commit to deploy, and the staged deployment and promotion. Confirm that the author signs in on the new domain afterwards.
3. **Old hostnames:** keep `refrain-chi.vercel.app` protected until S4, then redirect it or remove it.
4. **Order of the fixes in § 7**, and the decisions inside them: G8's approach, the artist slug (G1), covers and photographs, and the repeated-slash `308` (G2).
5. **ADR 0007 and the backups (#65).** These are needed before any real writing is hosted, and before G6.
6. **The demonstration on 2026-11-16** ([§ 9](#9-academic-acceptance-plan-2026-11-16)): which tier.

## 9. Academic acceptance plan (2026-11-16)

The requirements (AC-01 to AC-06) and their evidence are in [Evidence: M4](evidence/m4.md).
- **The preserved local demonstration database is not changed or reset** by anything here.
- **Real writing is not hosted** before G6.

**Tier A: always possible.** On the protected custom domain, after S2, with synthetic `[Test]` data:

| Requirement | What is shown |
| --- | --- |
| Frontend and backend | Sign in on `https://refrain.raioviajante.com`, the Desk, a Studio page |
| PostgreSQL persistence | Create a `[Test]` album, reload, and it is still there |
| Two or more related tables, with keys | Albums with credited artists, through the junction table; a refused delete of a referenced record (RESTRICT) |
| CRUD | Create, read, update, and delete an artist, or an album journal |
| JOIN | The Albums page, which lists each album with its credited artists |
| Aggregate or subquery | The Albums page's track counts (`COUNT … GROUP BY`) and "used in n entries" (a correlated subquery) |
| Private Studio | Signed out, `/studio` sends to sign-in, and a Server Action without a session is refused |

**Tier B: public access to published content.** The public pages need `REFRAIN_PUBLIC_READS_ENABLED=true`. On a reachable host, that requires G1 to G8 closed. Two honest options:

1. **Demonstrate the public pages locally,** from the M4 kit on the disposable database: publish a `[Test]` journal, then open its public page. No gate is needed.
2. **On the hosted site, only if the owner decides in writing** that a deployment reachable only through the owner's Vercel Authentication counts as "not reachable by anyone other than the author". Then enable the switch on that protected deployment for the demonstration only, with synthetic data, and turn it off afterwards. This is the owner's decision under #47's wording, recorded there. It is not a gate closure, and not a public launch.

**Not possible by 2026-11-16 without closing the gates:** a public website on `refrain.raioviajante.com`.

## Related

- [Security § Public page release gates](security.md#public-page-release-gates), [§ Deployment gate](security.md#deployment-gate), and [§ Studio responses](security.md#studio-responses) (F-01).
- [Hosted Backups](hosted-backups.md) (F-02, G6).
- [Evidence: public release of the repository](evidence/public-release.md). The source repository is public; that is separate from this plan.
