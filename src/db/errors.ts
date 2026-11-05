// Reading PostgreSQL errors behind a Drizzle query error. Pure: no database
// access. Commands map the codes below to fixed domain failures, so a raw
// database error, with its SQL and parameters, never reaches a client.

export interface DatabaseErrorShape {
  /** PostgreSQL SQLSTATE, for example 23503 (foreign_key_violation). */
  code: string;
  /** Name of the violated constraint, when PostgreSQL reports one. */
  constraint?: string;
  /**
   * PostgreSQL's detail line, for example "Key (id)=(…) is still referenced
   * from table …". It can contain values: commands read it to tell a
   * restricted delete from a missing parent, and never pass it on.
   */
  detail?: string;
}

/** SQLSTATE codes that Refrain's commands and tests recognize. */
export const SqlState = {
  /**
   * An `ON DELETE RESTRICT` (or `ON UPDATE RESTRICT`) foreign key refused to
   * delete or re-key a row that it refers to. PostgreSQL 18 reports this as
   * 23001; PostgreSQL 17 reports the same refusal as 23503.
   */
  restrictViolation: "23001",
  notNullViolation: "23502",
  foreignKeyViolation: "23503",
  uniqueViolation: "23505",
  checkViolation: "23514",
} as const;

/**
 * Whether a foreign key refused to delete or re-key a row because another row
 * still refers to it, as opposed to a write that names a parent that does not
 * exist. Both PostgreSQL 17 and 18 are supported:
 *
 * - PostgreSQL 17 reports every foreign-key failure as 23503
 *   (foreign_key_violation), and only the detail line tells them apart: "Key
 *   (…)=(…) is not present in table …" for a missing parent, "… is still
 *   referenced from table …" for a referenced row.
 * - PostgreSQL 18 reports a refusal by an `ON DELETE RESTRICT` or `ON UPDATE
 *   RESTRICT` key as 23001 (restrict_violation). A `NO ACTION` key, and every
 *   missing parent, still report 23503 as above.
 *
 * It says nothing about which constraint refused: callers still map the
 * constraint name strictly, and anything else is theirs to rethrow.
 */
export function isReferencedRowRefusal(failure: DatabaseErrorShape): boolean {
  if (failure.code === SqlState.restrictViolation) {
    return true;
  }
  return (
    failure.code === SqlState.foreignKeyViolation &&
    !/is not present in table/.test(failure.detail ?? "")
  );
}

/** Finds the PostgreSQL error behind a Drizzle query error. */
export function databaseErrorOf(
  error: unknown,
): DatabaseErrorShape | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 5; depth++) {
    if (typeof current !== "object" || current === null) {
      return undefined;
    }
    if ("code" in current && typeof current.code === "string") {
      const constraint =
        "constraint" in current && typeof current.constraint === "string"
          ? current.constraint
          : undefined;
      const detail =
        "detail" in current && typeof current.detail === "string"
          ? current.detail
          : undefined;
      return { code: current.code, constraint, detail };
    }
    current = "cause" in current ? current.cause : undefined;
  }
  return undefined;
}
