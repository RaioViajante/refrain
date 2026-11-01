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
 */
export type CatalogFailure =
  | "invalid_input"
  | "not_found"
  | "archived_reference"
  | "duplicate_identifier"
  | "in_use";

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
