import type { NextConfig } from "next";

// The Content-Security-Policy, as in src/security-headers.ts (this file cannot
// import application modules; src/security-headers.test.ts keeps them equal):
// no framing, and images only from this application, inline data, and the
// Cover Art Archive with the Internet Archive hosts it redirects to (M3.2).
const CONTENT_SECURITY_POLICY =
  "frame-ancestors 'none'; img-src 'self' data: blob: https://coverartarchive.org https://archive.org https://*.archive.org";

const nextConfig: NextConfig = {
  // Data is dynamic unless it is explicitly cached with `use cache`, so nothing
  // is prerendered from the database by accident (docs/architecture.md).
  cacheComponents: true,
  partialPrefetching: true,
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
  // clickjacking of the sign-in form) and never sniffed or leaked through a
  // referrer. Caching is controlled where the responses are made: studio
  // pages are dynamic, and the auth handler sets `Cache-Control: no-store`.
  async headers() {
    const privateHeaders = [
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Content-Security-Policy", value: CONTENT_SECURITY_POLICY },
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
    return [
      { source: "/albums/:path*", headers: publicHeaders },
      // The same headers, so that these answer as every other public address
      // does when public reads are off.
      { source: "/sitemap.xml", headers: publicHeaders },
      { source: "/robots.txt", headers: publicHeaders },
      { source: "/studio/:path*", headers: privateHeaders },
      { source: "/api/auth/:path*", headers: privateHeaders },
    ];
  },
};

export default nextConfig;
