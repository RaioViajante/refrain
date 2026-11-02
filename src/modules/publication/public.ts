// Publication module: the public reading entry point. Server-only.
//
// A second entry point beside `index.ts`, on purpose. Public pages, the proxy,
// and the sitemap read through this file alone, so they cannot name a
// publishing command, a token, or any write: it exports reads, bound to the
// application's database, and the public-reads switch. The studio never imports
// it (src/app/public-surface.test.ts). Every read applies the publication
// predicate (docs/security.md § Publication predicate), defined once.
import { getDb, withDatabase } from "@/db";

import {
  getPublicAlbumJournal as getPublicAlbumJournalFrom,
  listPublicAlbumJournalAddresses as listPublicAlbumJournalAddressesFrom,
} from "./public-album-journal";
import {
  routeAlbumJournalRequest as routeAlbumJournalRequestWith,
  type AlbumJournalRequest,
} from "./public-routing";
import { resolvePublicSlug as resolvePublicSlugFrom } from "./queries";

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
  PublicCredit,
  PublicJournalTrack,
} from "./public-album-journal";
export type { SlugResolution } from "./queries";
export { isNormalizedSlug } from "./slug";

export const getPublicAlbumJournal = withDatabase(getPublicAlbumJournalFrom);

export const listPublicAlbumJournalAddresses = withDatabase(
  listPublicAlbumJournalAddressesFrom,
);

/** Resolves an album-journal address: found, a redirect, or not found. */
export function resolvePublicAlbumJournalSlug(slug: string) {
  return resolvePublicSlugFrom(getDb(), "album_journal", slug);
}

/** What the address answers; see `public-routing.ts`. */
export function routeAlbumJournalRequest(request: AlbumJournalRequest) {
  return routeAlbumJournalRequestWith(getDb, request);
}
