import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";

import {
  listPublicArtistArchive,
  publicReadsEnabled,
  type PublicArtistCard,
} from "@/modules/publication/public";

import { archiveMetadata } from "@/app/(archives)/_components/archive-metadata";
import { notFoundMetadata } from "@/app/(public)/_components/page-metadata";
import { dictionaryFor } from "@/i18n/dictionaries";
import type { InterfaceLocale } from "@/i18n/locales";

import { ArtistsArchive } from "./artists-archive";

// The public Artists archive (M3.8a; the approved V4.4 `Artists` screen),
// anonymous, read through the Publication module's reading entry point alone.
// It lists exactly the artists whose page is served (ADR 0006 A5), and no
// photograph. While public reads are off the proxy answers the unknown-address
// `404` before this page renders (ADR 0006, D4; src/proxy.ts); the page checks
// the switch again itself. Rendered per request in one pass (`instant =
// false`), cached nowhere, `no-store` (next.config.ts).

type Loaded =
  | { kind: "list"; artists: PublicArtistCard[] }
  | { kind: "unavailable" }
  | { kind: "not_found" };

async function load(): Promise<Loaded> {
  // Runtime only, never at build time; outside the `try`.
  await connection();
  if (!publicReadsEnabled()) {
    return { kind: "not_found" };
  }
  try {
    return { kind: "list", artists: await listPublicArtistArchive() };
  } catch {
    // Never logged: a driver message can carry connection details.
    return { kind: "unavailable" };
  }
}

export async function artistsArchiveMetadata(
  locale: InterfaceLocale,
): Promise<Metadata> {
  await connection();
  if (!publicReadsEnabled()) {
    return notFoundMetadata(locale);
  }
  const t = dictionaryFor(locale).archives.artists;
  return archiveMetadata(locale, "/artists", t.title, t.lead.text);
}

export async function ArtistsArchiveScreen({
  locale,
}: Readonly<{ locale: InterfaceLocale }>) {
  const loaded = await load();
  if (loaded.kind === "not_found") {
    notFound();
  }
  return (
    <ArtistsArchive
      artists={loaded.kind === "list" ? loaded.artists : null}
      locale={locale}
    />
  );
}
