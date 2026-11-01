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
