import { connection } from "next/server";

import { publicReadsEnabled } from "@/modules/publication/public";

// robots.txt, a route handler for the same reason as the sitemap: every public
// response is `no-store`. It describes only public addresses: the studio and
// the authentication endpoints are disallowed. No content address is
// disallowed, so that a crawler can read each page's `noindex`.
//
// Under the initial indexing policy (src/indexing-policy.ts) it does not name
// the sitemap: the sitemap still answers as before, but nothing advertises it
// while every page asks not to be indexed. Naming it again is part of lifting
// the policy (docs/security.md#indexing).

const NO_STORE = { "Cache-Control": "no-store" } as const;

export async function GET() {
  await connection();
  if (!publicReadsEnabled()) {
    return new Response("Not Found", { status: 404, headers: NO_STORE });
  }
  const lines = [
    "User-agent: *",
    "Disallow: /studio",
    "Disallow: /pt/studio",
    "Disallow: /api/",
    "",
  ];
  return new Response(lines.join("\n"), {
    headers: {
      ...NO_STORE,
      "Content-Type": "text/plain; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
