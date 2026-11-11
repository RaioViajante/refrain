import type { NextConfig } from "next";

// The Content-Security-Policies, as in src/security-headers.ts (this file
// cannot import application modules; src/security-headers.test.ts keeps them
// equal): no framing, and images only from this application, inline data,
// and the Cover Art Archive with the Internet Archive hosts it redirects to
// (M3.2). The studio also allows Wikimedia Commons' thumbnail host, for
// artist photographs (M3.3); public pages do not.
const CONTENT_SECURITY_POLICY =
  "frame-ancestors 'none'; img-src 'self' data: blob: https://coverartarchive.org https://archive.org https://*.archive.org";
const STUDIO_CONTENT_SECURITY_POLICY =
  "frame-ancestors 'none'; img-src 'self' data: blob: https://coverartarchive.org https://archive.org https://*.archive.org https://thumb.wikimedia.org";
// The public artist pages (M3.5): the public policy plus exactly Wikimedia's
// thumbnail host, for the artist's photograph; nothing else.
const ARTIST_CONTENT_SECURITY_POLICY =
  "frame-ancestors 'none'; img-src 'self' data: blob: https://coverartarchive.org https://archive.org https://*.archive.org https://thumb.wikimedia.org";

// Every studio and authentication response: kept by no cache, shared or
// private, and never reused without asking the server (F-01).
const PRIVATE_NO_STORE = "private, no-store, max-age=0, must-revalidate";

const nextConfig: NextConfig = {
  // Data is dynamic unless it is explicitly cached with `use cache`, so nothing
  // is prerendered from the database by accident (docs/architecture.md).
  cacheComponents: true,
  partialPrefetching: true,
  // The answer of an address no route serves, now that no root layout covers
  // every address (ADR 0008 § 8).
  experimental: { globalNotFound: true },
  // The proxy answers a trailing slash itself, with the same `308` to the same
  // address, because the framework's own redirect runs before the proxy and
  // cannot carry `Cache-Control: no-store` (ADR 0006, amendment A2; see
  // src/address-normalization.ts).
  skipTrailingSlashRedirect: true,
  // Do not advertise the framework in response headers.
  poweredByHeader: false,
  // AGENTS.md is maintained by hand; `next dev` must not append to it.
  agentRules: false,
  // The studio and the authentication endpoints are never framed (no
  // clickjacking of the sign-in form), never sniffed or leaked through a
  // referrer, and never stored by any cache. `Cache-Control` is set here, not
  // left to the framework: under Cache Components every studio page is
  // partially prerendered, and on Vercel the document is the cached generic
  // shell with the author's data streamed into the same response, which the
  // platform answers with `public, max-age=0, must-revalidate` unless a header
  // says otherwise (F-01, issue #63, docs/security.md#studio-responses).
  async headers() {
    const privateHeaders = [
      { key: "Cache-Control", value: PRIVATE_NO_STORE },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Content-Security-Policy", value: STUDIO_CONTENT_SECURITY_POLICY },
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "no-referrer" },
    ];
    // The public pages (M3.1). `no-store` is set here as well as by the
    // framework and the proxy, because a prerendered shell that answers a
    // router prefetch is otherwise left to the framework's default, and a cache
    // that kept it would outlive an unpublish (ADR 0006 § 11). The other
    // headers: no sniffing, no referrer beyond the origin, and no framing. The
    // sitemap and robots.txt set their own, in their route handlers.
    const publicHeaders = [
      { key: "Cache-Control", value: "no-store" },
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Content-Security-Policy", value: CONTENT_SECURITY_POLICY },
    ];
    // The same, with the artist pages' image policy (M3.5).
    const artistHeaders = publicHeaders.map((header) =>
      header.key === "Content-Security-Policy"
        ? { key: header.key, value: ARTIST_CONTENT_SECURITY_POLICY }
        : header,
    );
    return [
      // The Home (M3.4): exactly `/`. It lists public journals per request, so
      // it is `no-store` like every other public response.
      { source: "/", headers: publicHeaders },
      // `/albums/:path*` also matches `/albums` itself, the Albums archive
      // (M3.8a); the same for the other two.
      { source: "/albums/:path*", headers: publicHeaders },
      { source: "/artists/:path*", headers: artistHeaders },
      // M3.7: the memories, with the public policy (no image is shown).
      { source: "/memories/:path*", headers: publicHeaders },
      // The Portuguese forms of the same pages (ADR 0006 A7, item 6), one rule
      // per section and none broad enough to reach `/pt/studio`, which keeps
      // the private headers of the Writing Studio when it exists.
      { source: "/pt", headers: publicHeaders },
      { source: "/pt/albums/:path*", headers: publicHeaders },
      { source: "/pt/artists/:path*", headers: artistHeaders },
      { source: "/pt/memories/:path*", headers: publicHeaders },
      // The same headers, so that these answer as every other public address
      // does when public reads are off.
      { source: "/sitemap.xml", headers: publicHeaders },
      { source: "/robots.txt", headers: publicHeaders },
      { source: "/studio/:path*", headers: privateHeaders },
      // The desk's transport files sit beside `/studio`, not under it
      // (`/studio.rsc`, `/studio.segments/…`), so `/studio/:path*` does not
      // match them.
      { source: "/studio\\.:transport(.*)", headers: privateHeaders },
      { source: "/api/auth/:path*", headers: privateHeaders },
      // The Portuguese Studio's addresses (ADR 0006 A7, item 7). No route
      // serves them until the Studio is localized (PR 3), and they already
      // carry the Studio's private headers, never a public rule's.
      { source: "/pt/studio/:path*", headers: privateHeaders },
      { source: "/pt/studio\\.:transport(.*)", headers: privateHeaders },
    ];
  },
};

export default nextConfig;
