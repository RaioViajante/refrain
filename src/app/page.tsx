import type { Metadata } from "next";
import { connection } from "next/server";
import { cache, Suspense } from "react";

import {
  getPublicHome,
  publicReadsEnabled,
  publicSiteOrigin,
  type PublicHome,
} from "@/modules/publication/public";

import {
  HOME_INTRODUCTION,
  HomeListings,
  HomeOpening,
  MostRecent,
} from "@/app/(public)/_components/home-view";
import {
  PUBLIC_CONTENT_ID,
  PublicFrame,
} from "@/app/(public)/_components/public-frame";

// The public Home (M3.4; the approved V4.4 `Home` screen), anonymous. It always
// answers 200: its drawing and introduction are the same for every reader and
// every state of the journal, so they are a generic, data-free shell
// (ADR 0006, amendments A2 and A4). What it lists is read through the
// Publication module's reading entry point alone, per request, after
// `connection()`, behind Suspense: nothing about a journal is rendered at
// build time or cached, and every response is `no-store` (next.config.ts).
//
// While public reads are off, the list is the one for a site with nothing
// published, so the page is byte for byte what an empty journal would answer
// and reveals nothing (ADR 0006, A4; src/testing/public-home.http.test.ts).

// The interface is English until next-intl arrives; this selects the version
// of each journal only (ADR 0002, D1.2).
const READER_LOCALE = "en";

const NOTHING_PUBLISHED: PublicHome = { recent: [], albums: [] };

// Deduplicated within one request, so both parts of the page agree.
const load = cache(async (): Promise<PublicHome> => {
  // Runtime only, never at build time.
  await connection();
  if (!publicReadsEnabled()) {
    return NOTHING_PUBLISHED;
  }
  return getPublicHome(READER_LOCALE);
});

export async function generateMetadata(): Promise<Metadata> {
  // The site's own origin is read when a request is served, never at build
  // time. Nothing here depends on a journal, or on the switch.
  await connection();
  const origin = publicSiteOrigin();
  return {
    title: "refrain",
    description: HOME_INTRODUCTION,
    ...(origin
      ? { metadataBase: new URL(origin), alternates: { canonical: "/" } }
      : {}),
    openGraph: {
      type: "website",
      siteName: "refrain",
      title: "refrain",
      description: HOME_INTRODUCTION,
      locale: "en_US",
      ...(origin ? { url: "/" } : {}),
    },
  };
}

export default function HomePage() {
  return (
    <PublicFrame current="home">
      <main className="public-shell ph" id={PUBLIC_CONTENT_ID} tabIndex={-1}>
        <HomeOpening>
          <Suspense fallback={null}>
            <MostRecentLine />
          </Suspense>
        </HomeOpening>
        <Suspense fallback={null}>
          <Listings />
        </Suspense>
      </main>
    </PublicFrame>
  );
}

async function MostRecentLine() {
  return <MostRecent home={await load()} />;
}

async function Listings() {
  return <HomeListings home={await load()} />;
}
