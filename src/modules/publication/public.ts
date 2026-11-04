// Publication module: the public reading entry point. Server-only.
//
// A second entry point beside `index.ts`, on purpose. Public pages, the proxy,
// and the sitemap read through this file alone, so they cannot name a
// publishing command, a token, or any write: it exports reads, bound to the
// application's database, and the public-reads switch. The studio never imports
// it (src/app/public-surface.test.ts). Every read applies the publication
// predicate (docs/security.md § Publication predicate), defined once.
//
// Every read here also applies the public-reads switch first (ADR 0006, D4), so
// a caller that forgot to check it still discloses nothing while reads are
// off: the answer is the one for an address that does not exist. This is the
// facade's own defense in depth, beside the proxy's and the callers' checks
// and the scans that hold those in place; it never replaces the predicate.
import { getDb, type Locale } from "@/db";

import {
  getPublicAlbumJournal as getPublicAlbumJournalFrom,
  listPublicAlbumJournalAddresses as listPublicAlbumJournalAddressesFrom,
} from "./public-album-journal";
import {
  getPublicArtist as getPublicArtistFrom,
  listPublicArtistAddresses as listPublicArtistAddressesFrom,
  type PublicArtist,
} from "./public-artist";
import {
  getPublicHome as getPublicHomeFrom,
  type PublicHome,
} from "./public-home";
import {
  getPublicMemory as getPublicMemoryFrom,
  listPublicMemoryAddresses as listPublicMemoryAddressesFrom,
  type PublicMemory,
} from "./public-memory";
import {
  routeAlbumJournalRequest as routeAlbumJournalRequestWith,
  routeArtistRequest as routeArtistRequestWith,
  routeMemoryRequest as routeMemoryRequestWith,
  type AlbumJournalRequest,
} from "./public-routing";
import { publicReadsEnabled } from "./public-reads";
import {
  resolvePublicArtistAddress as resolvePublicArtistAddressFrom,
  resolvePublicSlug as resolvePublicSlugFrom,
  type ArtistAddressResolution,
  type SlugResolution,
} from "./queries";

export {
  PUBLIC_READS_VARIABLE,
  publicReadsEnabled,
  publicSiteOrigin,
} from "./public-reads";
export { routePublicDocumentRequest } from "./public-routing";
export type {
  AlbumJournalRequest,
  AlbumJournalRouting,
} from "./public-routing";
export type {
  PublicAlbumJournal,
  PublicArtwork,
  PublicCredit,
  PublicJournalTrack,
} from "./public-album-journal";
export type {
  PublicArtist,
  PublicArtistAlbum,
  PublicArtistPhoto,
  PublicArtistTrack,
} from "./public-artist";
export type { PublicHome, PublicJournalCard } from "./public-home";
export type {
  PublicMemory,
  PublicMemoryArtist,
  PublicMemoryMusic,
} from "./public-memory";
export type { ArtistAddressResolution, SlugResolution } from "./queries";
export { isNormalizedSlug } from "./slug";

export async function getPublicAlbumJournal(
  entryId: string,
  readerLocale: Locale,
) {
  if (!publicReadsEnabled()) {
    return null;
  }
  return getPublicAlbumJournalFrom(getDb(), entryId, readerLocale);
}

export async function listPublicAlbumJournalAddresses() {
  if (!publicReadsEnabled()) {
    return [];
  }
  return listPublicAlbumJournalAddressesFrom(getDb());
}

/**
 * What the public Home lists (M3.4). While reads are off it is the answer for
 * a site with nothing published, so the Home cannot tell the two apart
 * (ADR 0006, amendment A4).
 */
export async function getPublicHome(readerLocale: Locale): Promise<PublicHome> {
  if (!publicReadsEnabled()) {
    return { recent: [], albums: [] };
  }
  return getPublicHomeFrom(getDb(), readerLocale);
}

/** Resolves an album-journal address: found, a redirect, or not found. */
export async function resolvePublicAlbumJournalSlug(
  slug: string,
): Promise<SlugResolution> {
  if (!publicReadsEnabled()) {
    return { outcome: "not_found" };
  }
  return resolvePublicSlugFrom(getDb(), "album_journal", slug);
}

/** What the address answers; see `public-routing.ts`. */
export function routeAlbumJournalRequest(request: AlbumJournalRequest) {
  return routeAlbumJournalRequestWith(getDb, request);
}

/**
 * A public artist's page (M3.5), or null when the artist is not publicly
 * visible. While reads are off it is null for every artist.
 */
export async function getPublicArtist(
  artistId: string,
  readerLocale: Locale,
): Promise<PublicArtist | null> {
  if (!publicReadsEnabled()) {
    return null;
  }
  return getPublicArtistFrom(getDb(), artistId, readerLocale);
}

/** Resolves an artist address: found, or not found. */
export async function resolvePublicArtistAddress(
  address: string,
): Promise<ArtistAddressResolution> {
  if (!publicReadsEnabled()) {
    return { outcome: "not_found" };
  }
  return resolvePublicArtistAddressFrom(getDb(), address);
}

/** Every public artist address, for the sitemap. */
export async function listPublicArtistAddresses(): Promise<string[]> {
  if (!publicReadsEnabled()) {
    return [];
  }
  return listPublicArtistAddressesFrom(getDb());
}

/** What an artist address answers; see `public-routing.ts`. */
export function routeArtistRequest(request: AlbumJournalRequest) {
  return routeArtistRequestWith(getDb, request);
}

/**
 * A public memory's page (M3.7), or null when no language version of it is
 * publicly visible. While reads are off it is null for every memory.
 */
export async function getPublicMemory(
  entryId: string,
  readerLocale: Locale,
): Promise<PublicMemory | null> {
  if (!publicReadsEnabled()) {
    return null;
  }
  return getPublicMemoryFrom(getDb(), entryId, readerLocale);
}

/** Resolves a memory address: found, a redirect, or not found. */
export async function resolvePublicMemorySlug(
  slug: string,
): Promise<SlugResolution> {
  if (!publicReadsEnabled()) {
    return { outcome: "not_found" };
  }
  return resolvePublicSlugFrom(getDb(), "memory", slug);
}

/** Every public memory address, for the sitemap. */
export async function listPublicMemoryAddresses(): Promise<string[]> {
  if (!publicReadsEnabled()) {
    return [];
  }
  return listPublicMemoryAddressesFrom(getDb());
}

/** What a memory address answers; see `public-routing.ts`. */
export function routeMemoryRequest(request: AlbumJournalRequest) {
  return routeMemoryRequestWith(getDb, request);
}
