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
- `/_next/static/…`, the framework's content-hashed build files, which keep `public, max-age=31536000, immutable`;
- exactly `/_next/image`, the framework's image optimizer, which keeps its own policy;
- each promoted, data-free file that exists in `public/v3/` and `public/artwork/`, named exactly. They keep the framework's default.

The list is read from the repository when the configuration loads, never from a request. A **missing** file under `/v3/` or `/artwork/`, a near-miss (`/v3/paper.jpgx`), and a path beside the optimizer (`/_next/imagex`) are the not-found view, and are `no-store` too. The independent review found that the first version, which excluded the whole `/v3/` and `/artwork/` prefixes, left those without `no-store`.

**Exception (recorded, Hosted Launch § 7 item 2):** a redirect from the framework's own `redirects()` (the canonical-host `308`, off unless its variable lists hosts) carries neither this rule's `no-store` nor the indexing header: under `next start` the framework returns a configured redirect before any header rule applies. Whether the host attaches header rules to it is part of the hosted G2 check.

**Residual (recorded):** the framework matches header rules without regard to case, so an uppercase spelling of an exact asset name (`/V3/paper.jpg`) is excluded as well. On the host's case-sensitive file system that address is a `404` with the generic not-found view and no data, and without the configured `no-store`. Each section rule still comes later and sets its own value, which wins as the last rule set. The Studio and authentication keep `private, no-store, max-age=0, must-revalidate`. Nothing about the publication predicate, the proxy, or any page changes.

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

- `src/next-config.test.ts` (new test): the rule is second and `no-store`. It is matched with the framework's own path matcher (`getPathMatch`).
  - **It covers:** the Home, unknown addresses at any depth, transport forms, `/pt` addresses, `/_not-found`, `/_global-error`, missing or misspelled asset files, and paths beside the optimizer.
  - **It excludes exactly:** the build files, the optimizer, and the existing asset files.
  - Every private rule comes after it.
- `src/testing/route-structure.http.test.ts` (new):
  - `/_not-found`, `/_global-error`, `/no-such-address.rsc`, `/v3/missing.jpg`, `/artwork/missing.webp`, and `/_next/imagex` are `no-store`, never `s-maxage`, never `public`;
  - `/studio/sign-in` and `/pt/studio/sign-in` keep exactly `private, no-store, max-age=0, must-revalidate`.
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
| `pnpm test:http` (database reset first), after the review's fixes | 20 files, **790 passed** |

## Not verified

- **The host.** The rule takes effect there only in a new deployment. Closing this part of G2 needs the same `/no-such-page` request on a protected deployment of this change, showing `no-store`.
- **The cache indicator (#76).** The platform may still mark the shared not-found render `x-vercel-cache: HIT`. With `no-store` it may not keep it for a client or a shared cache. Whether the platform keeps it internally is #76's question, which this does not answer.

## Independent review

One review, in a separate context, read-only: **GO**, with no Critical, High, or Medium finding. Its findings and what was done:

- **Low:** the open-ended `/v3/` and `/artwork/` prefixes and the unanchored `_next/image` left missing files and near-misses without `no-store`. Fixed: the exclusions now name each existing file exactly, and the optimizer exactly. The case-insensitive residual is recorded above.
- **Low:** this file called `/_next/image` a content-hashed build file. Corrected.
- **Missing tests:** missing assets, near-misses, and an HTTP check of a Studio path's policy under the new order. Added.
- **Not verified by the review:** the platform's precedence for overlapping `Cache-Control` rules. If it kept the first rule, every overlapping value would still be a `no-store` variant. A hosted check of `/no-such-page`, `/v3/missing.jpg`, and `/studio` on a protected deployment of this change is still required.
