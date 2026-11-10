import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { cache } from "react";

import {
  getPublicArtist,
  publicReadsEnabled,
  publicSiteOrigin,
  resolvePublicArtistAddress,
  type PublicArtist,
} from "@/modules/publication/public";

import { ArtistView } from "./artist-view";

// A public artist page (M3.5), read through the Publication module's reading
// entry point alone. An artist is public only because a served album journal
// is about an album that credits it (`publicArtists`); a catalog-only artist,
// an archived one, or one credited only on writing that is not public answers
// exactly as an unknown address does. The status was decided before the page
// rendered (src/proxy.ts); this page resolves the address again, because it
// must not trust that a request went through the proxy, and because the state
// can change in between. In that narrow case it can only answer not found,
// never show anything.
//
// The page is rendered on the server per request, in one pass, and sent
// complete (`instant = false`, as the Home is): it reads the same without
// client JavaScript, and the build prerenders nothing of it. Nothing is
// cached, and every response is `no-store` (next.config.ts).

// The interface is English until next-intl arrives; this selects the version
// of each journal only (ADR 0002, D1.2).
const READER_LOCALE = "en";

type Loaded = { kind: "page"; artist: PublicArtist } | { kind: "not_found" };

// Deduplicated within one request, so the metadata and the page agree.
const load = cache(async (slug: string): Promise<Loaded> => {
  // Runtime only, never at build time.
  await connection();
  if (!publicReadsEnabled()) {
    return { kind: "not_found" };
  }
  const resolution = await resolvePublicArtistAddress(slug);
  if (resolution.outcome !== "found") {
    return { kind: "not_found" };
  }
  const artist = await getPublicArtist(resolution.artistId, READER_LOCALE);
  return artist ? { kind: "page", artist } : { kind: "not_found" };
});

const NOT_FOUND_METADATA: Metadata = {
  title: "Not found · refrain",
  description: "A personal music journal.",
};

export async function generateMetadata({
  params,
}: Readonly<{ params: Promise<{ slug: string }> }>): Promise<Metadata> {
  const { slug } = await params;
  const loaded = await load(slug);
  // The same metadata as the not-found view for anything that is not served.
  if (loaded.kind !== "page") {
    return NOT_FOUND_METADATA;
  }
  const { artist } = loaded;
  const title = `${artist.name} · refrain`;
  // Nothing biographical and nothing the author did not write: what the page
  // is, in the site's own words.
  const description = `Album journals about music by ${artist.name}.`;
  const origin = publicSiteOrigin();
  return {
    title,
    description,
    ...(origin
      ? {
          metadataBase: new URL(origin),
          alternates: { canonical: `/artists/${artist.address}` },
        }
      : {}),
    // No image: a social preview would copy the photograph to another
    // service's cache, outside its attribution (docs/evidence/m3-5.md).
    openGraph: {
      type: "website",
      siteName: "refrain",
      title,
      description,
      locale: "en_US",
      ...(origin ? { url: `/artists/${artist.address}` } : {}),
    },
  };
}

export default async function ArtistPage({
  params,
}: Readonly<{ params: Promise<{ slug: string }> }>) {
  const { slug } = await params;
  const loaded = await load(slug);
  if (loaded.kind !== "page") {
    notFound();
  }
  return <ArtistView artist={loaded.artist} />;
}
