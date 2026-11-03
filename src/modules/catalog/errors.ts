import type { FieldErrors } from "@/validation";

/**
 * Expected failures of catalog commands. The code is fixed; it never carries
 * a database message, SQL, or the submitted values.
 *
 * - `invalid_input`: the input failed validation (`fields` names which).
 * - `not_found`: the record, or a record it refers to, does not exist.
 * - `archived_reference`: a new link to an archived artist, track, or album.
 * - `duplicate_identifier`: a MusicBrainz identifier is already in the catalog.
 * - `in_use`: a delete or removal that writing or the catalog still depends
 *   on (`blockedBy` says what). Archive the record instead.
 *
 * MusicBrainz and the Cover Art Archive (M3.2):
 *
 * - `provider_unavailable`: the provider could not be reached, answered too
 *   slowly, was rate limiting, or sent something outside its contract.
 *   Nothing was written; the catalog and the writing keep working.
 * - `provider_not_found`: the provider has no such record.
 * - `review_stale`: what the provider says now (or the album's identity or
 *   artwork) is not what the author reviewed. Nothing was written; review it
 *   again.
 * - `unsupported_release`: the release cannot be imported as one album (no
 *   tracks, too many, a recording listed twice, or a text over the catalog's
 *   limits). It can still be entered by hand, or linked.
 * - `already_linked`: the record already has a different MusicBrainz identity;
 *   it is never replaced.
 * - `not_linked`: the album has no MusicBrainz identity to find artwork with.
 * - `public_page`: the album or artist is shown on a public page, so its
 *   artwork, its photograph (M3.5), or an artist's restore that would show a
 *   photograph does not happen without a confirmation that does not exist
 *   yet (ADR 0006 D5, gate G8).
 *
 * Wikimedia Commons (M3.3), with `provider_*` and `review_stale` above:
 *
 * - `photo_not_usable`: the file no longer meets the license and attribution
 *   policy (its license, credit, format, or size changed on Commons).
 *   Nothing was written.
 */
export type CatalogFailure =
  | "invalid_input"
  | "not_found"
  | "archived_reference"
  | "duplicate_identifier"
  | "in_use"
  | "provider_unavailable"
  | "provider_not_found"
  | "review_stale"
  | "unsupported_release"
  | "already_linked"
  | "not_linked"
  | "public_page"
  | "photo_not_usable";

/** What stands in the way of a delete or removal. */
export type CatalogBlocker =
  | "album_credits"
  | "track_credits"
  | "journals"
  | "memories"
  | "albums"
  | "reflections";

export class CatalogError extends Error {
  override name = "CatalogError";

  constructor(
    readonly failure: CatalogFailure,
    readonly details: { fields?: FieldErrors; blockedBy?: CatalogBlocker } = {},
  ) {
    super(`Catalog operation refused: ${failure}`);
  }
}
