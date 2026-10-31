import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Data is dynamic unless it is explicitly cached with `use cache`, so nothing
  // is prerendered from the database by accident (docs/architecture.md).
  cacheComponents: true,
  partialPrefetching: true,
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
      { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "no-referrer" },
    ];
    return [
      { source: "/studio/:path*", headers: privateHeaders },
      { source: "/api/auth/:path*", headers: privateHeaders },
    ];
  },
};

export default nextConfig;
