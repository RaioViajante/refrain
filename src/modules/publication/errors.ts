import type { PublishDisclosure } from "./disclosure";
import type { PublicChangeDelta } from "./surface";

/**
 * Expected failures of the publication commands. The code is fixed; it never
 * carries a database message, SQL, a token, or the submitted input.
 *
 * The first group is ADR 0003 and ADR 0005. The second is ADR 0006 § 12; none
 * of those writes anything, and a failed call changes nothing.
 */
export type PublicationFailure =
  | "entry_not_found"
  | "entry_deleted"
  | "entry_not_deleted"
  | "version_not_found"
  | "no_current_slug"
  | "invalid_status"
  | "invalid_slug"
  | "slug_taken"
  // ADR 0006 § 12
  | "invalid_input"
  | "unavailable"
  | "version_conflict"
  | "nothing_to_publish"
  | "confirmation_required"
  | "confirmation_invalid"
  | "confirmation_expired"
  | "confirmation_stale";

export class PublicationError extends Error {
  override name = "PublicationError";

  /**
   * Only `confirmation_required`, `confirmation_expired`, and
   * `confirmation_stale` carry the freshly computed disclosure, so the
   * studio can show the author what is true now. It is private writing: it
   * goes only to a request that passed authorization, and is never logged.
   * No failure carries a token (ADR 0006 § 3, "Where tokens come from").
   *
   * It is a non-enumerable property on purpose, so that `console.error`,
   * `util.inspect`, and `JSON.stringify` of the error cannot print the
   * author's writing into a log by accident.
   */
  declare readonly disclosure?: PublishDisclosure;

  /**
   * The same for a change to a public journal (ADR 0006 § 5): only
   * `confirmation_required`, `confirmation_expired`, and `confirmation_stale`
   * carry the freshly computed exposure delta. Private writing, and
   * non-enumerable for the same reason.
   */
  declare readonly delta?: PublicChangeDelta;

  constructor(
    readonly failure: PublicationFailure,
    disclosure?: PublishDisclosure,
    delta?: PublicChangeDelta,
  ) {
    super(`Publication refused: ${failure}`);
    if (disclosure !== undefined) {
      Object.defineProperty(this, "disclosure", {
        value: disclosure,
        enumerable: false,
        writable: false,
      });
    }
    if (delta !== undefined) {
      Object.defineProperty(this, "delta", {
        value: delta,
        enumerable: false,
        writable: false,
      });
    }
  }
}
