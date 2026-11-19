/** An expected failure the owner can act on; its message is shown as is. */
export class StudioError extends Error {
  override name = "StudioError";
}

/** What every Studio Server Action returns to its form. */
export type ActionResult =
  | { ok: true; message: string; id?: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string> };

/** The PostgreSQL error code behind a failed query, if any. */
export function pgCode(error: unknown): string | undefined {
  const cause = (error as { cause?: unknown })?.cause ?? error;
  return (cause as { code?: string })?.code;
}
