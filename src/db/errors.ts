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
  notNullViolation: "23502",
  foreignKeyViolation: "23503",
  uniqueViolation: "23505",
  checkViolation: "23514",
} as const;

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
