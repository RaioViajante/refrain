import type { Metadata } from "next";
import { connection } from "next/server";

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
  HomeUnavailable,
} from "@/app/(public)/_components/home-view";
import {
  PUBLIC_CONTENT_ID,
  PublicFrame,
} from "@/app/(public)/_components/public-frame";

// The public Home (M3.4; the approved V4.4 `Home` screen), anonymous. It always
// answers 200 (ADR 0006, amendment A4). What it lists is read through the
// Publication module's reading entry point alone, per request, after
// `connection()`: nothing about a journal is rendered at build time or cached,
// and every response is `no-store` (next.config.ts).
//
// The whole page is rendered on the server, per request, in one pass, and
// sent complete: the lists are in the HTML itself, so the page reads the same
// with JavaScript off. Under Cache Components a page whose data sits behind
// Suspense is sent as a prerendered shell, and its data streams afterwards in
// hidden markup that only a script reveals, so a reader without JavaScript
// saw no lists. `instant = false`, on the route file, allows this route to block instead;
// it caches nothing and prerenders nothing about a journal.
//
// While public reads are off, the lists are the ones for a site with nothing
// published, so the page is what an empty journal would answer and reveals
// nothing (ADR 0006, A4; src/testing/public-home.http.test.ts).

// The interface is English until next-intl arrives; this selects the version
// of each journal only (ADR 0002, D1.2).
const READER_LOCALE = "en";

// The page's own copy of the answer for a site with nothing published, so
// this guard does not depend on the reading entry point's (ADR 0006 A4, A6).
const NOTHING_PUBLISHED: PublicHome = {
  recent: [],
  albums: [],
  artists: [],
  memories: [],
};

/** What the Home lists, or null when the database could not answer. */
async function load(): Promise<PublicHome | null> {
  // Runtime only, never at build time. Outside the `try`: the framework uses
  // it to defer rendering, and that must never be caught.
  await connection();
  if (!publicReadsEnabled()) {
    return NOTHING_PUBLISHED;
  }
  try {
    return await getPublicHome(READER_LOCALE);
  } catch {
    // Never logged: a driver message can carry connection details. The page
    // says, in a fixed sentence, that the lists could not be read.
    return null;
  }
}

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

export default async function HomePage() {
  const home = await load();
  return (
    <PublicFrame current="home">
      <main className="public-shell ph" id={PUBLIC_CONTENT_ID} tabIndex={-1}>
        <HomeOpening />
        {home ? <HomeListings home={home} /> : <HomeUnavailable />}
      </main>
    </PublicFrame>
  );
}
