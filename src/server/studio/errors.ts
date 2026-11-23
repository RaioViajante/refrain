/** An expected failure the owner can act on; its message is shown as is. */
export class StudioError extends Error {
  override name = "StudioError";
}

/** What every Studio Server Action returns to its form. */
export type ActionResult =
  | { ok: true; message: string; id?: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string> };

/**
 * A delete refused because a row still references it: 23503 up to
 * PostgreSQL 17, 23001 (restrict_violation) for ON DELETE RESTRICT from 18.
 */
export const STILL_REFERENCED = new Set(["23503", "23001"]);

/** The PostgreSQL error code behind a failed query, if any. */
export function pgCode(error: unknown): string | undefined {
  const cause = (error as { cause?: unknown })?.cause ?? error;
  return (cause as { code?: string })?.code;
}
