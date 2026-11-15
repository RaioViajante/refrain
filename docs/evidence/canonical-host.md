# Evidence: the canonical-host redirect (built, off)

**Status: on branch `feat/canonical-host-redirect`, a draft pull request stacked on the v3 release candidate. Not merged, not deployed, and off by default.** Recorded on 2026-11-15. Hosted Launch § 7, item 2.

## What it does

`next.config.ts` gains `redirects()`, which returns `canonicalHostRedirectsFromEnvironment()` from `src/canonical-host.ts`. That pure module is kept apart so `next.config.ts` itself reads no environment variable, which `src/indexing-policy.test.ts` holds:

- **Off unless `REFRAIN_CANONICAL_REDIRECT_HOSTS` is set.** Unset or blank, there is no rule, which is the state of every deployment today.
- **Set:** each listed hostname, matched exactly (a `has: host` rule whose dots are escaped, matched by the framework against the whole value), answers `308` to the same path and query on the **canonical origin**. That origin is `BETTER_AUTH_URL`'s.
- **No request can choose the destination.** It is a configured value; the request's `Host`, path, and query decide only *whether* a listed host is redirected, never *where*.
- **It fails closed.** The build stops if:
  - `BETTER_AUTH_URL` is missing, not `https`, or has a path, query, credentials, or port;
  - a listed value is not an exact hostname (no wildcard, scheme, port, path, or empty entry);
  - the canonical host itself is listed, which would make a loop.
- **The framework never redirects `/_next/…`.** Build files keep serving on any host.

Preview and generated deployment addresses are never listed, so they keep their own origin. They stay protected by Vercel Authentication.

## Measured on a production build with the redirect on

The build ran in a separate worktree with:
- `REFRAIN_CANONICAL_REDIRECT_HOSTS=refrain-chi.vercel.app,refrain-bryanalvarenga-5889s-projects.vercel.app`;
- `BETTER_AUTH_URL=https://refrain.raioviajante.com`.

It served on `next start -H 127.0.0.1`, and was requested with each `Host`:

| `Host` | Path | Answer |
| --- | --- | --- |
| `refrain-chi.vercel.app` (and `REFRAIN-CHI.VERCEL.APP`) | `/` | `308` → `https://refrain.raioviajante.com` |
| the same | `/albums/grace?x=1&y=%2F` | `308` → `https://refrain.raioviajante.com/albums/grace?x=1&y=%2F` |
| the same | `/studio/journals` | `308` → `…/studio/journals` |
| the same | `/%2F%2Fevil.com` | `308` → `https://refrain.raioviajante.com/%2F%2Fevil.com` (same origin) |
| the same, `POST /api/auth/sign-in/email` | — | `308` before any handler. A client that follows it reaches the canonical origin with the old `Origin`, which the exact-origin check refuses |
| `refrain-bryanalvarenga-5889s-projects.vercel.app` | all of the above | the same `308`s |
| `refrain.raioviajante.com`, `refrain-v3-rc.vercel.app`, `evil.refrain-chi.vercel.app` | all of the above | **no redirect**: the site's own answers (`200`, `404`, the Studio's private headers) |
| any host | `//evil.com/x` | the framework's existing repeated-slash `308` to the **relative** `/evil.com/x`, the same on every host. Not introduced here |

## Open for the owner

- **`Cache-Control` on the `308`.** The framework sends its redirects without a `Cache-Control` header, as it does for the repeated-slash `308`, which [Hosted Launch § 6, G2](../hosted-launch.md#6-hosted-release-gates-g1g8-and-their-dependencies) already lists as an owner decision. A permanent redirect is cacheable by default, so a browser may remember an old host's `308` after the variable is removed. The mapping holds no data. The owner decides whether that is acceptable, or whether the redirect should move into the proxy (which can set `no-store`), at the cost of running the proxy on every path.
- **Activation.** Setting the variable on Production, then a staged deployment, is S4 work. It needs the owner's approval, and it is checked anonymously on every hostname, as in [Hosted Launch, the public release sequence](../hosted-launch.md#public-release-sequence-stage-s4).

## Tests

`src/next-config.test.ts`:
- off when unset or blank, and equal to this configuration's `redirects()`;
- exact-host matching, with look-alikes refused: `refrain-chiXvercel.app`, a subdomain, a suffix, the canonical host, the Preview alias, and a generated URL;
- a fixed destination and a `308`;
- duplicates collapsed;
- five malformed canonical origins and eight malformed host lists refused.

| Check | Result |
| --- | --- |
| `pnpm lint`, `pnpm typecheck`, `pnpm format:check` | Clean |
| `pnpm test` | 58 files, **1,322 passed** |
| `pnpm build` with one listed host | Succeeded; `routes-manifest.json` holds exactly one `has: host` rule, `refrain-chi\\.vercel\\.app` → `https://refrain.raioviajante.com/:path*`, `308` |
| `pnpm build` listing the canonical host | **Stopped**: "must not name the canonical host" |
| `pnpm build` (redirect off, the default) | Succeeded; no `has: host` rule |
| `pnpm test:http` on the default build (database reset first) | 20 files, **783 passed** (unchanged: the redirect is off) |
