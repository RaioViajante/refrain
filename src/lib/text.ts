/**
 * A Studio text as the server stores it: line breaks as "\n", without
 * surrounding white space (the same transform as the text fields in
 * src/server/studio/schemas.ts). Forms compare what was typed through this,
 * so a trailing space or line break is not an unsaved change.
 */
export function normalizeText(value: string): string {
  return value.replace(/\r\n?/g, "\n").trim();
}
