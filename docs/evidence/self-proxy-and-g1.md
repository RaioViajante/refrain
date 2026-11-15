# Evidence: the test servers' self-proxy, fixed, and what it was hiding (G1)

**Status: on branch `fix/test-server-self-proxy`, a draft pull request. DO NOT MERGE: with this fix, 20 HTTP tests fail. They show a G1 gap that the self-proxy hid.** Recorded on 2026-11-15.

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
