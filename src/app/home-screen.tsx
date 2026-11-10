import type { Metadata } from "next";
import { connection } from "next/server";

import {
  getPublicHome,
  publicReadsEnabled,
  type PublicHome,
} from "@/modules/publication/public";

import {
  HomeListings,
  HomeOpening,
  HomeUnavailable,
} from "@/app/(public)/_components/home-view";
import { publicPageMetadata } from "@/app/(public)/_components/page-metadata";
import {
  PUBLIC_CONTENT_ID,
  PublicFrame,
} from "@/app/(public)/_components/public-frame";
import { dictionaryFor } from "@/i18n/dictionaries";
import type { InterfaceLocale } from "@/i18n/locales";

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

// The interface language reaches the read only as the reader's locale, which
// selects among versions that are already public (ADR 0002, D1.2; ADR 0006
// A7, item 1): the Portuguese Home lists the same entries, and a bilingual
// one may show another version, date, and place in the bounded lists.

// The page's own copy of the answer for a site with nothing published, so
// this guard does not depend on the reading entry point's (ADR 0006 A4, A6).
const NOTHING_PUBLISHED: PublicHome = {
  recent: [],
  albums: [],
  artists: [],
  memories: [],
};

/** What the Home lists, or null when the database could not answer. */
async function load(locale: InterfaceLocale): Promise<PublicHome | null> {
  // Runtime only, never at build time. Outside the `try`: the framework uses
  // it to defer rendering, and that must never be caught.
  await connection();
  if (!publicReadsEnabled()) {
    return NOTHING_PUBLISHED;
  }
  try {
    return await getPublicHome(locale);
  } catch {
    // Never logged: a driver message can carry connection details. The page
    // says, in a fixed sentence, that the lists could not be read.
    return null;
  }
}

export async function homeMetadata(locale: InterfaceLocale): Promise<Metadata> {
  // The site's own origin is read when a request is served, never at build
  // time. Nothing here depends on a journal, or on the switch.
  await connection();
  return publicPageMetadata({
    locale,
    path: "/",
    title: "refrain",
    description: dictionaryFor(locale).home.introduction.text,
    type: "website",
  });
}

export async function HomeScreen({
  locale,
}: Readonly<{ locale: InterfaceLocale }>) {
  const home = await load(locale);
  return (
    <PublicFrame locale={locale} path="/" current="home">
      <main className="public-shell ph" id={PUBLIC_CONTENT_ID} tabIndex={-1}>
        <HomeOpening locale={locale} />
        {home ? (
          <HomeListings home={home} locale={locale} />
        ) : (
          <HomeUnavailable locale={locale} />
        )}
      </main>
    </PublicFrame>
  );
}
