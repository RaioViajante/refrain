import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";

import {
  listPublicArtistArchive,
  publicReadsEnabled,
  type PublicArtistCard,
} from "@/modules/publication/public";

import {
  archiveMetadata,
  NOT_FOUND_METADATA,
} from "@/app/(archives)/_components/archive-metadata";

import { ArtistsArchive, ARTISTS_LEAD } from "./artists-archive";

// The public Artists archive (M3.8a; the approved V4.4 `Artists` screen),
// anonymous, read through the Publication module's reading entry point alone.
// It lists exactly the artists whose page is served (ADR 0006 A5), and no
// photograph. While public reads are off the proxy answers the unknown-address
// `404` before this page renders (ADR 0006, D4; src/proxy.ts); the page checks
// the switch again itself. Rendered per request in one pass (`instant =
// false`), cached nowhere, `no-store` (next.config.ts).

/**
 * This route renders on the server per request and waits for its data before
 * it sends the page, instead of sending a prerendered shell first: the page
 * must be complete without client JavaScript.
 */
export const instant = false;

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

export async function generateMetadata(): Promise<Metadata> {
  await connection();
  if (!publicReadsEnabled()) {
    return NOT_FOUND_METADATA;
  }
  return archiveMetadata("/artists", "Artists", ARTISTS_LEAD);
}

export default async function ArtistsArchivePage() {
  const loaded = await load();
  if (loaded.kind === "not_found") {
    notFound();
  }
  return (
    <ArtistsArchive artists={loaded.kind === "list" ? loaded.artists : null} />
  );
}
