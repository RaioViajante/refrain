# Evidence: the test servers' self-proxy, fixed, and what it was hiding (G1)

**Status: on branch `fix/test-server-self-proxy`, a draft pull request. DO NOT MERGE until the owner decides on [the 17 remaining URL-form assertions](#the-owners-decision-meeting-the-17-assertions-as-written-is-infeasible). With the harness fixed, 20 HTTP tests failed. The application fix for the crawlers resolved 3 with no assertion changed. The other 17 are the router's URL forms, whose format the framework decides after the proxy. They reveal no stored data (measured below).** Recorded on 2026-11-15.

## The cause, confirmed

Next.js 16.4.3 writes every loopback hostname in the request the proxy sees as `localhost`. The rule is `NextURL`'s `REGEX_LOCALHOST_HOSTNAME`, which matches `127.x.x.x`, `[::1]`, and `localhost`. The router compares a rewrite's origin with its own, which it builds from `-H` (`resolve-routes.js`, `getRelativeURL`).

The test servers ran `next start -H 127.0.0.1`. So the proxy's rewrite to the shared not-found view (`new URL("/__refrain-unknown-address", request.url)`) looked external, and the server **proxied it to itself over HTTP**. Under load that failed: 61 of 200 concurrent requests answered `500` ([Evidence: the v3 release candidate](v3-rc.md)). It never involved a request's `Host` header.

## The fix (harness only)

`src/testing/production-server.ts` starts the server with `node --dns-result-order=ipv4first … next start -H localhost`:
- it still listens on `127.0.0.1` only, where every test connects;
- the framework's own origin becomes `http://localhost:<port>`, equal to the proxy's normalized one, so the rewrite stays internal;
- the origin is a fixed name, never a request value.

| Check | Before | After |
| --- | --- | --- |
| `x-middleware-rewrite` on an unknown memory address | `http://localhost:<port>/__refrain-unknown-address` (external) | `/__refrain-unknown-address` (internal) |
| 200 concurrent requests to an unknown memory address | 61 answered `500` | **0** |
| `pnpm test:e2e:run` (full, `E2E_KEEP_SERVER_LOG=1`) | 356/357, 1 failed (the `500`) | **357 passed, 0 failed**; no `Failed to proxy` in any server log |
| `pnpm test:http` (full) | 783 passed | **20 failed** (below) |

## What the self-proxy was hiding

Through the self-proxy, the proxied request lost the router's request headers, so every rewritten answer was the HTML not-found document. Over the internal rewrite, which is what the hosting platform does, some request forms of an address that is **not served** answer the not-found view's RSC payload instead. The unknown address in the same form answers HTML. They are no longer identical, as ADR 0006 D4 and G1 require. Example, `/albums` segment file (tree) with public reads off:

```
- (unknown address) "<!DOCTYPE html><html lang=\"en\">…"
+ (the archive)     ":HL[\"/_next/static/chunks/….css\",\"style\"] … 1:[[\"children\",{\"s\":\"/_not-found\",…}]]"
```

Nothing private is in either body: the payload is the generic not-found view's. But the response differs by request form, which the contract forbids. The hosted deployment very likely behaves this way **today**, because Vercel never self-proxies. This was not checked on the host.

The failing tests, as `pnpm test:http` names them:

```
src/testing/public-archives.http.test.ts > the About page, in both languages > is the unknown address in Portuguese too while reads are off, in every method and transport form
src/testing/public-archives.http.test.ts > with public reads off, every archive is the unknown address in every request form > about, .rsc: identical status, headers, and body
src/testing/public-archives.http.test.ts > with public reads off, every archive is the unknown address in every request form > about, segment file (full): identical status, headers, and body
src/testing/public-archives.http.test.ts > with public reads off, every archive is the unknown address in every request form > about, segment file (page): identical status, headers, and body
src/testing/public-archives.http.test.ts > with public reads off, every archive is the unknown address in every request form > about, segment file (tree): identical status, headers, and body
src/testing/public-archives.http.test.ts > with public reads off, every archive is the unknown address in every request form > albums, .rsc: identical status, headers, and body
src/testing/public-archives.http.test.ts > with public reads off, every archive is the unknown address in every request form > albums, segment file (full): identical status, headers, and body
src/testing/public-archives.http.test.ts > with public reads off, every archive is the unknown address in every request form > albums, segment file (page): identical status, headers, and body
src/testing/public-archives.http.test.ts > with public reads off, every archive is the unknown address in every request form > albums, segment file (tree): identical status, headers, and body
src/testing/public-archives.http.test.ts > with public reads off, every archive is the unknown address in every request form > artists, .rsc: identical status, headers, and body
src/testing/public-archives.http.test.ts > with public reads off, every archive is the unknown address in every request form > artists, segment file (full): identical status, headers, and body
src/testing/public-archives.http.test.ts > with public reads off, every archive is the unknown address in every request form > artists, segment file (page): identical status, headers, and body
src/testing/public-archives.http.test.ts > with public reads off, every archive is the unknown address in every request form > artists, segment file (tree): identical status, headers, and body
src/testing/public-archives.http.test.ts > with public reads off, every archive is the unknown address in every request form > memories, .rsc: identical status, headers, and body
src/testing/public-archives.http.test.ts > with public reads off, every archive is the unknown address in every request form > memories, segment file (full): identical status, headers, and body
src/testing/public-archives.http.test.ts > with public reads off, every archive is the unknown address in every request form > memories, segment file (page): identical status, headers, and body
src/testing/public-archives.http.test.ts > with public reads off, every archive is the unknown address in every request form > memories, segment file (tree): identical status, headers, and body
src/testing/public-request-forms.http.test.ts > crawlers and link-preview bots > facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php): a served page, a redirect, and a hidden address
src/testing/public-request-forms.http.test.ts > crawlers and link-preview bots > Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots): a served page, a redirect, and a hidden address
src/testing/public-request-forms.http.test.ts > crawlers and link-preview bots > Twitterbot/1.0: a served page, a redirect, and a hidden address
```

## Next step (not done here)

The fix belongs in `src/proxy.ts`. For the request forms that the framework answers with the router's payload, the unknown address's answer and a hidden address's answer must be produced the same way. That probably means making the rewrite target and the request headers it carries the same for both, or answering those forms directly. It needs its own pull request and an independent review. Afterwards this harness fix can merge, with the full HTTP suite green. Until then, the harness keeps hiding the gap, and the hosted G1 evidence must include these request forms.

## Further investigation (2026-11-15): no existence leak found

Probes on the production build with this harness fix, on the disposable PostgreSQL 18 database with the suites' synthetic data:

| Comparison | Result |
| --- | --- |
| A **draft** album journal against an **unknown** album address, in the **same** form: `.rsc`, segment file (tree), segment file (full), `RSC` header | **Identical** (status, content type, and body, with the slug masked) in every form |
| Each archive with reads off (`/albums`, `/artists`, `/memories`, `/about`), `.rsc` and segment files, against an unknown album address in the same form | The same status (`404`) and content type (`text/x-component`). The bodies are the not-found view's Flight payload; each echoes its own requested path |
| A link-preview crawler (`Slackbot`), draft against unknown | They differ only in (1) Flight byte offsets, which follow the **requested slug's length**, and (2) a random per-render key. **The same unknown address requested twice also differs** in (2). Googlebot's answers are identical |

So the 20 failures compare a router-form answer with an **HTML** baseline. That identity held only because the self-proxy turned every rewritten request into a plain request for the fixed internal path. Over the framework's internal rewrite, which is what the hosting platform does, the requested path and its form are echoed into the answer. None of the differences depends on whether an entry exists, its state, or the switch.

**Tried and reverted.** Removing the router's request headers (`rsc`, `next-router-*`, `next-url`) from the proxy's not-found rewrite did not change the result: still 20 failures. For URL forms (`.rsc`, `.segments/…`), Next.js marks the request as a router request from the **path**, before the proxy runs (`base-server.js`, `handleRSCRequest`), so headers cannot undo it.

## Resolution work (2026-11-15, second pass)

### Where the format is decided (Next.js 16.4.3 source, confirmed with the router's debug log)

1. The router invokes the proxy with the original path (`/albums.rsc`). It sends **no** `RSC` header: the log shows the middleware request headers as `accept, host, user-agent, x-forwarded-*`.
2. The proxy rewrites to `/__refrain-unknown-address`. The router takes that as the new `parsedUrl`, then calls `invokeRender` with the **original** `req.url` (`server/lib/router-server.js`, `invokeRender`, which sets only the `invokePath` request metadata).
3. The render server rebuilds `parsedUrl` from `req.url` and calls `handleRSCRequest` on it **before** it uses `invokePath` (`server/base-server.js`, around lines 585–606). `handleRSCRequest` (around lines 160–200) matches the `.rsc` or `.segments/…segment.rsc` suffix, sets the router headers itself, and marks the request as a router request.

So, for a URL form, whether a **rendered** answer is HTML or a router payload is decided by the requested path, **after the application's proxy and out of its reach**. The proxy can still answer such a request itself, without rendering (Alternative A, item 2), but no answer it can produce equals the rendered HTML document those 17 assertions compare with. A rewrite cannot change `req.url`. Removing request headers in the proxy cannot help (tried: still 20). The app has no hook between the rewrite and the render.

### Fixed in the application: the crawlers (3 of 20)

Next.js renders differently for "HTML-limited" crawlers (Slackbot, Twitterbot, facebookexternalhit). Their Flight data carried byte offsets that follow the requested slug's length, so a draft's address and an unknown one differed (Googlebot's never did). The proxy's three not-found rewrites now forward the request **without its `User-Agent`** (`notFoundRequestHeaders` in `src/proxy.ts`). The shared view is then rendered the same way for every client. The destination is still a fixed path on the request's own origin, and nothing from the request reaches it.

**Result: those three tests pass with no assertion changed**, and `public-request-forms.http.test.ts` is green.

### What remains: 17 URL-form answers, and what they reveal

The 17 failures are the archives' (`/albums`, `/artists`, `/memories`, `/about`) and `/pt/about`'s `.rsc` and segment-file forms, with public reads off. Each is compared with an **unknown album address requested as an HTML document**.

Measured on the production build, with the corrected harness:

| Property | Result |
| --- | --- |
| Status, content type, `Cache-Control` | `404`, `text/x-component`, `private, no-cache, no-store, max-age=0, must-revalidate`, the same as an unknown address in the same form |
| **Each of the 14 URL-form answers, with an empty database and then with the suites' synthetic published journals, drafts, artist pages, and memories** | **Byte-identical, 14 of 14** (the framework's per-render IDs masked) |
| Any stored text (`[Test]`, titles, artists, the seed prefix) in any of them | **None** |
| A draft against an unknown album address in the same URL form | Identical (first pass, above) |

They reveal no entry, no publication state, and nothing stored: only that the requested address was in a router form, which the requester chose.

## The owner's decision (meeting the 17 assertions as written is infeasible)

### Alternative A: keep the assertions, and what that would take

The 17 assertions demand that a router URL form answer the **HTML** document of an unknown address. The application cannot produce that, because the render server decides the format from `req.url` after the proxy (above). Every way of forcing it was examined and rejected:

1. **Fetching the HTML from itself** in the proxy, to the internal address. This is the self-proxy this pull request removes: it failed under load with `500`, and on the host Deployment Protection would block it without a bypass secret. **Rejected.**
2. **The proxy returning a fixed body** for those forms. It would not equal the rendered not-found view, so it fails the same assertions. Unless every unknown address returned that fixed body, which would remove the shared not-found view (ADR 0008 § 8, the v3 404) and break its tests. **Rejected.**
3. **Removing the archives' URL forms from the proxy's matcher.** The framework then renders the archive route in that form, which answers `notFound()` with reads off: the same router payload. **No change.**
4. **A framework change** (an option not to derive the format from the path after a rewrite). It does not exist in Next.js 16.4.3. **Out of reach.**

Keeping them means keeping the self-proxy harness, which hides the platform's real behaviour and fails intermittently. The 17 checks would keep passing locally while never describing the host.

### Alternative B: a narrowly scoped amendment, proposed for the owner's explicit review (not made)

> **For the router's URL forms only** (`<address>.rsc` and `<address>.segments/…/*.segment.rsc`) of an address that is not served, with public reads off or for a hidden entry:
> - the status is `404`, and every header is identical to an unknown address's in the same form;
> - the body is the shared not-found view's router payload, **byte-identical with any database state** (empty, or with published, draft, private, deleted, and unpublished entries), with the framework's per-render IDs masked;
> - it contains no stored text.
>
> Byte identity with the HTML document of an unknown address is **not** required for these forms. Every other form (HTML documents, `HEAD`, other methods, header-driven router requests, `_next/data`, crawlers, conditional and range requests) keeps the current byte-identity assertions unchanged, as does hidden against unknown in the same form.

Test changes this would need, and nothing else:
- the 17 cases in `public-archives.http.test.ts` assert the properties above instead of byte identity with the HTML baseline;
- a **new** test fixes the empty-against-populated identity measured here.

It needs the owner's written approval, an independent review, and a note under ADR 0006 D4 or G1 in the owner's words. **It is not made in this pull request.** The session's safety classifier blocked an earlier attempt to change those assertions as a weakening of privacy tests, and that decision belongs to the owner.

### Recommendation

**Alternative B.** The properties it keeps are what G1 protects: no entry, state, or stored text distinguishable. The hosting platform already behaves this way today, and the current assertions pass only through a harness defect. Until the owner decides, this pull request stays a draft: CI fails with exactly these 17 tests, and the self-proxy remains on `release/v3-rc`.


## Verification of this pull request's source changes (2026-11-15)

Run at `fa975a8`, plus the review fixes below. Disposable databases only.

| Check | Result |
| --- | --- |
| `pnpm lint`, `pnpm typecheck`, `pnpm format:check` | Clean |
| `pnpm test` | 58 files, **1,307 passed** |
| `pnpm build` | Succeeded |
| `pnpm test:http` (corrected harness, database reset first) | 784 tests: **766 passed, 18 failed**: the 17 URL-form cases above, and the new cookie test as first written, which also matched the framework's own `x-middleware-rewrite` marker. That test was narrowed to the request-header copies. Then `public-album-journal.http.test.ts` and `public-request-forms.http.test.ts`: **132 passed** |
| `pnpm test:e2e:run` (corrected harness, every project, `E2E_KEEP_SERVER_LOG=1`) | **357 passed, 0 failed, 4 skipped**; no `Failed to proxy` in any of the three servers' logs |
| URL-form answers with reads off, an empty database against the synthetic data | **14 of 14 byte-identical**; no stored text |

## Independent review

One review, in a separate context, read-only: **GO for both source changes** (the harness and the proxy's not-found request), with no Critical, High, or Medium finding. It confirmed from the framework's source:
- only `User-Agent` is removed; cookies, `accept-language`, the router headers, and `x-forwarded-*` are kept;
- the request-header copies are deleted before the response is built;
- nothing that renders the not-found view reads a request header;
- `X-Robots-Tag` still comes from the header rules, so `noindex` holds for every crawler;
- the rewrite destination is still the fixed path on the request's own origin;
- 308, 405, 503, served pages, and the Studio are untouched.

It verified the framework mechanics behind the 17 failures (`router-server.js:363`, `base-server.js:606` and 163–180), and found that those responses reveal nothing beyond what an unknown address in the same form reveals. With the switch off, the archive routing returns `not_found` without reading the database. The switch's value is already visible to anyone: an archive answers `404` or `200`.

| Finding | What was done |
| --- | --- |
| **Low:** if `localhost` had no IPv4 address, the server would listen elsewhere, and another process on `127.0.0.1:<port>` could answer the readiness check | Fixed: the helper refuses to start unless `localhost` resolves first to `127.0.0.1` |
| **Low:** no test showed that the request-header copies (holding the cookie) never reach the client | Added: a draft and an unknown address, EN and PT, with a cookie and a crawler's agent. No `x-middleware-request-*` header and no override list. The cookie value appears in no header or body, and the only rewrite marker is the fixed internal path |
| **Info:** a page's own `notFound()` (the publish/unpublish race) still renders in a crawler's mode | No new leak: that race is already distinguishable by its streamed `200` |
| **Info:** the request-header override on the host is unproven | Part of the hosted G1 evidence |
| **Overstated:** "cannot be fixed in the application" | Corrected above. The proxy could answer those forms itself, but not with what the assertions demand |
