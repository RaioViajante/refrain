import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";

import {
  listPublicAlbumArchive,
  publicReadsEnabled,
  type PublicAlbumCard,
} from "@/modules/publication/public";

import {
  archiveMetadata,
  NOT_FOUND_METADATA,
} from "@/app/(archives)/_components/archive-metadata";

import { AlbumsArchive, ALBUMS_LEAD } from "./albums-archive";

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

/**
 * This route renders on the server per request and waits for its data before
 * it sends the page, instead of sending a prerendered shell first: the page
 * must be complete without client JavaScript.
 */
export const instant = false;

// The interface is English until next-intl arrives; this selects the version
// of each journal only (ADR 0002, D1.2).
const READER_LOCALE = "en";

type Loaded =
  | { kind: "list"; albums: PublicAlbumCard[] }
  | { kind: "unavailable" }
  | { kind: "not_found" };

async function load(): Promise<Loaded> {
  // Runtime only, never at build time. Outside the `try`: the framework uses
  // it to defer rendering, and that must never be caught.
  await connection();
  if (!publicReadsEnabled()) {
    return { kind: "not_found" };
  }
  try {
    return {
      kind: "list",
      albums: await listPublicAlbumArchive(READER_LOCALE),
    };
  } catch {
    // Never logged: a driver message can carry connection details.
    return { kind: "unavailable" };
  }
}

export async function generateMetadata(): Promise<Metadata> {
  await connection();
  if (!publicReadsEnabled()) {
    return NOT_FOUND_METADATA;
  }
  return archiveMetadata("/albums", "Albums", ALBUMS_LEAD);
}

export default async function AlbumsArchivePage() {
  const loaded = await load();
  if (loaded.kind === "not_found") {
    notFound();
  }
  return (
    <AlbumsArchive albums={loaded.kind === "list" ? loaded.albums : null} />
  );
}
