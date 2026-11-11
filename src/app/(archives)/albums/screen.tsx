import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";

import {
  listPublicAlbumArchive,
  publicReadsEnabled,
  type PublicAlbumCard,
} from "@/modules/publication/public";

import { archiveMetadata } from "@/app/(archives)/_components/archive-metadata";
import { notFoundMetadata } from "@/app/(public)/_components/page-metadata";
import { dictionaryFor } from "@/i18n/dictionaries";
import type { InterfaceLocale } from "@/i18n/locales";

import { AlbumsArchive } from "./albums-archive";

// The public Albums archive (M3.8a; the approved V4.4 `Albums` screen),
// anonymous, read through the Publication module's reading entry point alone.
// While public reads are off the proxy answers the unknown-address `404`
// before this page renders (ADR 0006, D4; src/proxy.ts); the page checks the
// switch again itself and then answers not found, because it must not trust
// that a request went through the proxy.
//
// The page is rendered on the server per request, in one pass, and sent
// complete (`instant = false`, as the Home and the detail pages are): it reads
// the same without client JavaScript, and the build prerenders nothing of it.
// Nothing is cached, and every response is `no-store` (next.config.ts).

// The interface language reaches the read only as the reader's locale, which
// selects among versions that are already public (ADR 0002, D1.2; ADR 0006
// A7, item 1). It is never an input to what is visible.

type Loaded =
  | { kind: "list"; albums: PublicAlbumCard[] }
  | { kind: "unavailable" }
  | { kind: "not_found" };

async function load(locale: InterfaceLocale): Promise<Loaded> {
  // Runtime only, never at build time. Outside the `try`: the framework uses
  // it to defer rendering, and that must never be caught.
  await connection();
  if (!publicReadsEnabled()) {
    return { kind: "not_found" };
  }
  try {
    return {
      kind: "list",
      albums: await listPublicAlbumArchive(locale),
    };
  } catch {
    // Never logged: a driver message can carry connection details.
    return { kind: "unavailable" };
  }
}

export async function albumsArchiveMetadata(
  locale: InterfaceLocale,
): Promise<Metadata> {
  await connection();
  if (!publicReadsEnabled()) {
    return notFoundMetadata(locale);
  }
  const t = dictionaryFor(locale).archives.albums;
  return archiveMetadata(locale, "/albums", t.title, t.lead.text);
}

export async function AlbumsArchiveScreen({
  locale,
}: Readonly<{ locale: InterfaceLocale }>) {
  const loaded = await load(locale);
  if (loaded.kind === "not_found") {
    notFound();
  }
  return (
    <AlbumsArchive
      albums={loaded.kind === "list" ? loaded.albums : null}
      locale={locale}
    />
  );
}
