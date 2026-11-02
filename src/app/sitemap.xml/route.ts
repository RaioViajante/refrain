import { connection } from "next/server";

import {
  listPublicAlbumJournalAddresses,
  publicReadsEnabled,
  publicSiteOrigin,
} from "@/modules/publication/public";

// The sitemap lists the address of every publicly visible album journal and
// nothing else, read through the publication queries (the same rule that
// `resolvePublicSlug` applies, so every listed address is served). It is a
// route handler, and not the `sitemap.ts` convention, because that convention
// sends `Cache-Control: public, max-age=0, must-revalidate`, and ADR 0006
// § 11 requires `no-store` on every public response (M3.1 spike).

const NO_STORE = { "Cache-Control": "no-store" } as const;

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export async function GET() {
  // Runtime only: never evaluated at build time.
  await connection();
  const origin = publicSiteOrigin();
  // The proxy answers the same 404 as an unknown address first. This is the
  // second check, in case a request reaches the route without it. An origin
  // that cannot be trusted fails closed in the same way.
  if (!publicReadsEnabled() || origin === null) {
    return new Response("Not Found", { status: 404, headers: NO_STORE });
  }
  const addresses = await listPublicAlbumJournalAddresses();
  const entries = addresses
    .map(
      (slug) =>
        `  <url><loc>${escapeXml(`${origin}/albums/${slug}`)}</loc></url>`,
    )
    .join("\n");
  const xml =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    (entries ? `${entries}\n` : "") +
    `</urlset>\n`;
  return new Response(xml, {
    headers: {
      ...NO_STORE,
      "Content-Type": "application/xml; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
