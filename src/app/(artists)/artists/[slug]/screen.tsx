import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { cache } from "react";

import {
  getPublicArtist,
  publicReadsEnabled,
  resolvePublicArtistAddress,
  type PublicArtist,
} from "@/modules/publication/public";

import {
  notFoundMetadata,
  publicPageMetadata,
} from "@/app/(public)/_components/page-metadata";
import { PublicFrame } from "@/app/(public)/_components/public-frame";
import { dictionaryFor } from "@/i18n/dictionaries";
import type { InterfaceLocale } from "@/i18n/locales";

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

// The interface language reaches the read only as the reader's locale, which
// selects among versions that are already public (ADR 0002, D1.2; ADR 0006
// A7, item 1).

type Loaded = { kind: "page"; artist: PublicArtist } | { kind: "not_found" };

// Deduplicated within one request, so the metadata and the page agree.
const load = cache(
  async (slug: string, locale: InterfaceLocale): Promise<Loaded> => {
    // Runtime only, never at build time.
    await connection();
    if (!publicReadsEnabled()) {
      return { kind: "not_found" };
    }
    const resolution = await resolvePublicArtistAddress(slug);
    if (resolution.outcome !== "found") {
      return { kind: "not_found" };
    }
    const artist = await getPublicArtist(resolution.artistId, locale);
    return artist ? { kind: "page", artist } : { kind: "not_found" };
  },
);

export async function artistMetadata(
  params: Promise<{ slug: string }>,
  locale: InterfaceLocale,
): Promise<Metadata> {
  const { slug } = await params;
  const loaded = await load(slug, locale);
  // The not-found view's metadata for anything that is not served.
  if (loaded.kind !== "page") {
    return notFoundMetadata(locale);
  }
  const { artist } = loaded;
  return publicPageMetadata({
    locale,
    path: `/artists/${artist.address}`,
    title: `${artist.name} · refrain`,
    description: dictionaryFor(locale).artist.description(artist.name),
    type: "website",
  });
}

export async function ArtistScreen({
  params,
  locale,
}: Readonly<{ params: Promise<{ slug: string }>; locale: InterfaceLocale }>) {
  const { slug } = await params;
  const loaded = await load(slug, locale);
  if (loaded.kind !== "page") {
    notFound();
  }
  return (
    <PublicFrame
      locale={locale}
      path={`/artists/${loaded.artist.address}`}
      current="artists"
      inside
    >
      <ArtistView artist={loaded.artist} locale={locale} />
    </PublicFrame>
  );
}
