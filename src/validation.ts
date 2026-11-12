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

/**
 * Unicode white space only, and the zero-width characters that render as
 * nothing, is blank (ADR 0006 § 4, step 6): a text row always means text.
 */
export const INVISIBLE_ONLY = /^[\p{White_Space}\u200B-\u200D\u2060\uFEFF]*$/u;

/**
 * Whether the server stores no text for `text`: once cleaned (control
 * characters removed), it is blank. The body and reflection normalization
 * removes only white space beyond `cleanText`, so this is exactly the
 * server's test. Pure, so the Studio's editor asks the same question before a
 * save (issue #54).
 */
export function isBlankText(text: string): boolean {
  return INVISIBLE_ONLY.test(cleanText(text));
}
