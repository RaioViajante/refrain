// What a Studio server action returns to the browser, and nothing more. It is
// deliberately small: a fixed code, the names of invalid fields, and what
// blocks a deletion. Never a database error, a stack trace, SQL, or the input
// echoed back. Types only, so client components can import it.

export type StudioFailure =
  | "unauthorized"
  | "unavailable"
  | "invalid_input"
  | "not_found"
  | "in_use"
  | "duplicate"
  | "archived"
  | "conflict"
  | "deleted"
  | "not_deleted"
  | "unsupported"
  // ADR 0006 § 12. None carries a token, a disclosure, or any writing.
  | "confirmation_required"
  | "confirmation_invalid"
  | "confirmation_expired"
  | "confirmation_stale"
  | "nothing_to_publish"
  | "no_address"
  // Made in the browser, never by the server: the request did not come back.
  | "unreachable"
  // The version is no longer in the state the screen showed.
  | "status_changed"
  // MusicBrainz and the Cover Art Archive (M3.2). Nothing was written.
  | "provider_unavailable"
  | "provider_not_found"
  | "stale"
  | "unsupported_release"
  | "already_linked"
  | "not_linked"
  | "public_page"
  // Wikimedia Commons (M3.3). Nothing was written.
  | "photo_not_usable"
  | "failed";

export type FieldProblem = "required" | "too_long" | "invalid";

export type ActionResult<Data = void> =
  | { ok: true; data: Data }
  | {
      ok: false;
      code: StudioFailure;
      /** Field path to problem, for `invalid_input`. */
      fields?: Record<string, FieldProblem>;
      /** What still depends on a record, for `in_use`. */
      blockedBy?:
        | "album_credits"
        | "track_credits"
        | "journals"
        | "memories"
        | "albums"
        | "reflections";
    };
