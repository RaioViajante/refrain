import type { PublicChangeDelta } from "@/modules/publication";
import type { FieldErrors } from "@/validation";

/**
 * Expected failures of journal commands. The code is fixed; it never carries
 * a database message, SQL, or the submitted text.
 *
 * - `entry_not_found`: no such album journal (or memory, for the memory
 *   commands). An entry of another kind is never found.
 * - `entry_not_deleted`: restoring, and "Delete now", are only for entries in
 *   Recently deleted. A repeated or concurrent second restore receives it.
 * - `entry_deleted`: the journal is in Recently deleted, so it cannot change.
 * - `album_not_found`, `album_archived`: a journal is about an album that
 *   exists and is not archived.
 * - `version_conflict`: the journal changed since the editor loaded it
 *   (`entries.version`), so the save was refused instead of overwriting.
 * - `unsupported_content`: the stored text has formatting the plain editor
 *   cannot represent; it is left untouched.
 * - `slug_unavailable`: no free slug was found for the journal.
 * - `track_not_in_album`, `track_archived`: a reflection is on a recording
 *   that belongs to the journal's album and is not archived. An existing
 *   reflection on an archived recording can still be edited.
 * - `unavailable`: the application secret is not configured, so no
 *   confirmation can be checked. Nothing is saved when one is needed.
 * - `status_changed`: a version's visibility is no longer what the author's
 *   screen showed (another tab or session changed it), so nothing was changed.
 * - `nothing_to_publish`: the save would leave a published language version
 *   with no opening sentence and no body. Unpublish it first.
 * - `no_current_slug`: a language version cannot be published without a
 *   current address; an invariant failure, reported and not retried.
 * - `confirmation_required`, `confirmation_invalid`, `confirmation_expired`,
 *   `confirmation_stale`: the save would change what a reader sees of a public
 *   journal or memory and the author's confirmation of exactly that change is missing,
 *   not authentic, too old, or for another state (ADR 0006 § 5 and § 12).
 *   Nothing is written. The first, third, and fourth carry the fresh change
 *   (`delta`), never a token.
 * - `track_not_found`: a memory names a recording that is not in the catalog.
 *   (`track_archived` also applies to a memory: a new link to an archived
 *   recording is refused, and an existing one is kept.)
 */
export type JournalFailure =
  | "invalid_input"
  | "entry_not_found"
  | "entry_not_deleted"
  | "entry_deleted"
  | "album_not_found"
  | "album_archived"
  | "version_conflict"
  | "unsupported_content"
  | "slug_unavailable"
  | "track_not_in_album"
  | "track_archived"
  | "track_not_found"
  | "unavailable"
  | "nothing_to_publish"
  | "no_current_slug"
  | "status_changed"
  | "confirmation_required"
  | "confirmation_invalid"
  | "confirmation_expired"
  | "confirmation_stale";

export class JournalError extends Error {
  override name = "JournalError";

  /**
   * The exposure delta of a refused confirmed save: private writing, for an
   * authorized request only, never logged. Non-enumerable on purpose, so
   * printing the error cannot print the author's writing.
   */
  declare readonly delta?: PublicChangeDelta;

  constructor(
    readonly failure: JournalFailure,
    readonly details: { fields?: FieldErrors } = {},
    delta?: PublicChangeDelta,
  ) {
    super(`Journal operation refused: ${failure}`);
    if (delta !== undefined) {
      Object.defineProperty(this, "delta", {
        value: delta,
        enumerable: false,
        writable: false,
      });
    }
  }
}
