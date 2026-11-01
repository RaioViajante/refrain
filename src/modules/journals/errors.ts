import type { FieldErrors } from "@/validation";

/**
 * Expected failures of journal commands. The code is fixed; it never carries
 * a database message, SQL, or the submitted text.
 *
 * - `entry_not_found`: no such album journal.
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
 * - `published_text_locked`: the language version being saved is published.
 *   Changing published text needs the author's confirmation of what changes
 *   publicly (ADR 0006 § 5), which arrives with M2.2; until then a save of a
 *   published version is refused and nothing changes.
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
  | "published_text_locked";

export class JournalError extends Error {
  override name = "JournalError";

  constructor(
    readonly failure: JournalFailure,
    readonly details: { fields?: FieldErrors } = {},
  ) {
    super(`Journal operation refused: ${failure}`);
  }
}
