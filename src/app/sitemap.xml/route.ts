import { connection } from "next/server";

import {
  listPublicAlbumJournalAddresses,
  listPublicArtistAddresses,
  listPublicMemoryAddresses,
  publicReadsEnabled,
  publicSiteOrigin,
} from "@/modules/publication/public";

// The sitemap lists the Home, the three archives (M3.8a), the address of
// every publicly visible album journal, of every public artist page (M3.5),
// and of every publicly visible memory (M3.7), and nothing else, read through
// the publication queries (the same rule that `resolvePublicSlug` applies, so
// every listed address is served). It is a route handler, and not the
// `sitemap.ts` convention, because that convention sends `Cache-Control:
// public, max-age=0, must-revalidate`, and ADR 0006 § 11 requires `no-store`
// on every public response (M3.1 spike).

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
  // The artist pages (M3.5): exactly the addresses `resolvePublicArtistAddress`
  // finds, from the same visible-artist rule.
  const artists = await listPublicArtistAddresses();
  // The memories (M3.7): exactly the addresses `resolvePublicSlug` finds for a
  // memory.
  const memories = await listPublicMemoryAddresses();
  const entries = [
    `${origin}/`,
    // The archives (M3.8a): pages of the site itself, the same in every state
    // of the journal, listed while public reads are on.
    `${origin}/albums`,
    `${origin}/artists`,
    `${origin}/memories`,
    ...addresses.map((slug) => `${origin}/albums/${slug}`),
    ...artists.map((address) => `${origin}/artists/${address}`),
    ...memories.map((slug) => `${origin}/memories/${slug}`),
  ]
    .map((address) => `  <url><loc>${escapeXml(address)}</loc></url>`)
    .join("\n");
  const xml =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    `${entries}\n` +
    `</urlset>\n`;
  return new Response(xml, {
    headers: {
      ...NO_STORE,
      "Content-Type": "application/xml; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
