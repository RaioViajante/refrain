import { connection } from "next/server";

import {
  publicReadsEnabled,
  publicSiteOrigin,
} from "@/modules/publication/public";

// robots.txt, a route handler for the same reason as the sitemap: every public
// response is `no-store`. It describes only public addresses: the studio and
// the authentication endpoints are disallowed, and the sitemap is named when
// the application's own origin is known.

const NO_STORE = { "Cache-Control": "no-store" } as const;

export async function GET() {
  await connection();
  if (!publicReadsEnabled()) {
    return new Response("Not Found", { status: 404, headers: NO_STORE });
  }
  const origin = publicSiteOrigin();
  const lines = [
    "User-agent: *",
    "Disallow: /studio",
    "Disallow: /api/",
    ...(origin ? ["", `Sitemap: ${origin}/sitemap.xml`] : []),
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
