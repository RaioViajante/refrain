# Evidence: every unnamed address `no-store` (G2)

**Status: on branch `fix/unmatched-route-no-store`, a draft pull request stacked on the v3 release candidate. Not merged, not deployed.** Recorded on 2026-11-15.

## The gap

On the protected v3 Preview ([Evidence: the v3 release candidate](v3-rc.md#hosted-checks)), an address that no route serves (`/no-such-page`) answered:

```
HTTP/2 404
cache-control: public, max-age=0, must-revalidate
x-vercel-cache: HIT
```

G2 asks for `Cache-Control: no-store` on every response class ([Hosted Launch § 6](../hosted-launch.md#6-hosted-release-gates-g1g8-and-their-dependencies)). The header rules in `next.config.ts` named only the sections:
- the Home;
- the album, artist, and memory sections, and About;
- their `/pt` forms;
- `sitemap.xml` and `robots.txt`;
- the Studio and authentication.

Any other address got no `Cache-Control` from the configuration.
- **Locally,** `next start` adds its own `private, no-cache, no-store` to a `404`, so the local tests passed.
- **On the host,** the platform served the build's prerendered not-found view from its cache with its default policy.
- **Locally, too,** the framework's literal `/_not-found` and `/_global-error` answered `s-maxage=31536000`. That was one of the owner's recorded follow-ups.

## The change

`next.config.ts` adds one rule, second after the indexing policy and before every section rule. It sets `Cache-Control: no-store` (and the indexing policy) on every address except:
- `/_next/static/` and `/_next/image`, the framework's content-hashed build files, which keep `public, max-age=31536000, immutable`;
- `/v3/` and `/artwork/`, the promoted, data-free assets in `public/`, which keep the framework's default.

The pattern is a fixed list (`/:path((?!_next/static/|_next/image|v3/|artwork/).*)`). It never depends on the request. Each section rule still comes later and sets its own value, which wins as the last rule set. The Studio and authentication keep `private, no-store, max-age=0, must-revalidate`. Nothing about the publication predicate, the proxy, or any page changes.

## Measured on the production build (`next start`, disposable database)

| Address | Before | After |
| --- | --- | --- |
| `/_not-found` | `s-maxage=31536000` | `no-store` |
| `/_global-error` (500) | `s-maxage=31536000` | `no-store` |
| `/no-such-page`, `/a/b/c`, `/pt/nao-existe`, `/no-such-page.rsc` | `private, no-cache, no-store, …` (the framework's) | unchanged |
| `/` | `no-store` | `no-store` |
| `/studio`, `/studio/sign-in`, `/api/auth/get-session` | `private, no-store, max-age=0, must-revalidate` | unchanged |
| `/_next/static/chunks/*.js` | `public, max-age=31536000, immutable` | unchanged |
| `/v3/paper.jpg`, `/artwork/refrain-404.webp` | `public, max-age=0` | unchanged |

## Tests

- `src/next-config.test.ts` (new test): the rule is second and `no-store`. Matched with the framework's own path matcher (`getPathMatch`), it covers the Home, unknown addresses at any depth, transport forms, `/pt` addresses, `/_not-found`, and `/_global-error`, and excludes exactly the build files and the two asset folders. Every private rule comes after it.
- `src/testing/route-structure.http.test.ts` (new): `/_not-found`, `/_global-error`, and `/no-such-address.rsc` are `no-store`, never `s-maxage`, never `public`.
- The existing rules are unchanged:
  - the indexing policy is on every rule, and its rule comes first;
  - every public rule is `no-store`;
  - every private rule is `PRIVATE_NO_STORE`;
  - no rule names `/_next`.

| Check | Result |
| --- | --- |
| `pnpm lint`, `pnpm typecheck`, `pnpm format:check` | Clean |
| `pnpm test` | 58 files, 1,308 passed |
| `pnpm build` | Succeeded |
| `pnpm test:http` (database reset first) | 20 files, **786 passed** |

## Not verified

- **The host.** The rule takes effect there only in a new deployment. Closing this part of G2 needs the same `/no-such-page` request on a protected deployment of this change, showing `no-store`.
- **The cache indicator (#76).** The platform may still mark the shared not-found render `x-vercel-cache: HIT`. With `no-store` it may not keep it for a client or a shared cache. Whether the platform keeps it internally is #76's question, which this does not answer.
