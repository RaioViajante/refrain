import type { z } from "zod";

// Validation helpers shared by the modules' commands. Zod validates every
// input at the server boundary (AGENTS.md § 7); PostgreSQL constraints remain
// the authority behind it (docs/data-model.md).

/**
 * Fixed codes for what is wrong with one field. The interface turns them into
 * words; they never carry the submitted value or a library message.
 */
export type FieldErrorCode = "required" | "too_long" | "invalid";

export type FieldErrors = Record<string, FieldErrorCode>;

/**
 * Reduces a Zod error to a field path and a fixed code per field. The first
 * issue of each field wins.
 */
export function fieldErrorsOf(error: z.ZodError): FieldErrors {
  const fields: FieldErrors = {};
  for (const issue of error.issues) {
    const path = issue.path.map(String).join(".") || "_";
    if (path in fields) {
      continue;
    }
    fields[path] =
      issue.code === "too_small"
        ? "required"
        : issue.code === "too_big"
          ? "too_long"
          : "invalid";
  }
  return fields;
}

/**
 * Text in the form the database can store: well-formed Unicode, and no
 * control characters other than tab and line feed. PostgreSQL rejects NUL in
 * `text` and lone surrogates in `jsonb`, so both would otherwise surface as
 * database errors. Line endings are normalized to line feeds.
 */
export function cleanText(text: string): string {
  return text
    .toWellFormed()
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
}
