# Evidence: the initial indexing policy

Approved by the owner on 2026-11-13 as the first of three independent hosting improvements, on its own, and on the accepted requirements only: [Security § Deployment gate](../security.md#deployment-gate), item 2 ("whether a header-level `noindex` … is needed"), gate G5, and the [hosted-launch plan](../hosted-launch.md). It does not depend on the proposed ADRs 0009 or 0010. **Local only:** nothing is deployed, no environment variable changes, public reads stay off on every reachable host, and gates G1 to G8 stay open.

## Approved decisions

- **One constant, `noindex, nofollow`,** on every response the application controls where a header is possible. It is not an environment variable, so no configuration can lift it. Removing it needs a code change, a review, and the owner's explicit authorization.
- **The sitemap is preserved**, with its current contract. Only the `Sitemap:` line of `robots.txt` is removed. The `Disallow` lines stay, and no content route is disallowed.
- **No new content and no change** to authentication, authorization, the publication predicate, statuses, bodies, `Cache-Control`, or error handling.

## What changed

| File | Change |
| --- | --- |
| [`src/indexing-policy.ts`](../../src/indexing-policy.ts) | The constant and the header's name |
| [`next.config.ts`](../../next.config.ts) | A first header rule for every address (`/:path*`) that sets only `X-Robots-Tag`; the same header in the public and the private header sets |
| [`src/proxy.ts`](../../src/proxy.ts) | The header on every response the proxy builds: both `308`s, the `405`, the `503`, and the not-found headers of the public, artist, and Studio sets |
| [`(en)/layout.tsx`](../../src/app/(en)/layout.tsx), [`pt/layout.tsx`](../../src/app/pt/layout.tsx), [`page-metadata.ts`](../../src/app/(public)/_components/page-metadata.ts) | `robots: "noindex, nofollow"` in both roots and in the not-found metadata (the global not-found view is its own document). Written out, because these files may import no module ([`public-surface.test.ts`](../../src/app/public-surface.test.ts)) |
| [`robots.txt/route.ts`](../../src/app/robots.txt/route.ts) | No `Sitemap:` line |
| Tests | [`indexing-policy.test.ts`](../../src/indexing-policy.test.ts) and [`indexing.http.test.ts`](../../src/testing/indexing.http.test.ts) (new); [`next-config.test.ts`](../../src/next-config.test.ts), [`public-album-journal.http.test.ts`](../../src/testing/public-album-journal.http.test.ts), and [`public-archives.http.test.ts`](../../src/testing/public-archives.http.test.ts), which asserted the old `robots.txt` and the absence of a robots tag; a browser check in [`e2e/public.spec.ts`](../../e2e/public.spec.ts) |
| Documents | [Security § Indexing](../security.md#indexing) and item 2; [hosted-launch](../hosted-launch.md) § 6 (G5), § 7 (item 8), and the S4 sequence (steps 1 and 5); `AGENTS.md` |

## Response matrix

Verified on the production build (`next start`) over HTTP, against the disposable test database, with public reads on (`true`) and off (unset). Every row is in English and Portuguese unless noted. "Policy" means the exact header `X-Robots-Tag: noindex, nofollow`.

| Class | Requests | Reads on | Reads off |
| --- | --- | --- | --- |
| Pages | `/`, `/albums`, `/artists`, `/memories`, an album journal, an artist, a memory | `200`, policy, meta tag | Home `200`, the rest `404`; policy everywhere |
| Not found, every reason | Draft, private, deleted, unknown album; hidden and unknown memory; unknown artist; an address no route serves | `404`, policy, meta tag; a hidden address identical to an unknown one, header included | The same; a served journal identical to an unknown address |
| Transport forms | The 14 forms of `forms()` (router and segment prefetches, segment files, `.rsc`, `.json`, `/_next/data`, `Accept`, conditional and range requests) for a served, a hidden, and an unknown album; `_rsc` on the Home and the archives | Policy | Policy |
| Redirects | A previous album or memory address; a trailing slash (pages and Studio) | `308`, policy | Trailing slash `308`, policy |
| Refusals | `POST` or `DELETE` on a page, an archive, the sitemap, `robots.txt` | `405`, policy | `404`, policy |
| Encoded spellings | `/%61lbums/…`, `/%73itemap.xml`, `/%70t/…`, `/%73tudio`, `/st%75dio/…`, `/pt/st%75dio` | Policy | Policy |
| Failure | Database unreachable | `503`, policy | — |
| `robots.txt` | `GET` | `200`: `User-agent: *` and three `Disallow` lines; no `Sitemap:` | `404`, identical to an unknown address |
| Sitemap | `GET` | `200`, still lists the served journals; policy | `404`, identical to an unknown address |
| Studio | `/studio`, `/studio/sign-in`, `/studio/journals`, and their `/pt` forms, documents and `_rsc` | Policy, with and without the author's session; the author still sees the Studio and a visitor is still sent to sign-in; `Cache-Control` unchanged | — (the Studio does not depend on the switch) |
| Authentication | `/api/auth/get-session` with and without a session; an unknown `/api/auth/…` path | Policy | — |
| Server Action | An unauthenticated `createArtistAction`, at an English and a Portuguese Studio address | Policy; `unauthorized`; nothing written | — |
| Static files | A script and a stylesheet from `/_next/static`, `/artwork/refrain-404.webp`, `/artwork/refrain-home-character.webp`, `/_next/image` | Policy; `/_next/static` keeps `public, max-age=31536000, immutable` | — |
| Meta tag | Each page above, a not-found view, the Studio's sign-in, with and without JavaScript | Exactly one `<meta name="robots" content="noindex, nofollow">` of the application's own. A not-found view also has the framework's own `noindex` tag, as before | The same |

Across every response with the header, the test finds one value only. No private marker appears in anything a reader was sent. The author's own Studio responses are not part of that scan, because they show the author's drafts.

## Not covered

- **The framework's repeated-slash and backslash `308`.** Next.js answers `//albums/x` and `/albums//x` at the top of its router, before any header rule or the proxy (the same gap as its missing `no-store`, recorded in [M3.1](m3-1.md#g2-and-the-cache-hit-marker)). The response has no application header at all. It has no content to index, and the address it names carries the policy. A test fixes its shape. No small, safe change can reach it without working around the framework's router, which is not done.
- **The platform's own responses,** such as Vercel Authentication's sign-in. They are outside the application, and never relied on.
- **The hosted site.** Nothing is deployed. Before step 2 of the S4 sequence, the policy must be checked on the hosted deployment with the owner's session ([hosted-launch](../hosted-launch.md#public-release-sequence-stage-s4), step 1).

## Verification

Recorded in the pull request, with the commands run and their results.
