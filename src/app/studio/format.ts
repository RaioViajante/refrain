// Small presentation helpers for the studio. Pure functions. Dates, ratings,
// and counts are the interface's (src/i18n/format.ts, src/i18n/studio).

/** `222000` becomes `3:42`. */
export function formatDuration(lengthMs: number | null): string {
  if (lengthMs === null) {
    return "";
  }
  const totalSeconds = Math.round(lengthMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${seconds}`
    : `${minutes}:${seconds}`;
}

/**
 * `3:42` or `1:02:03` becomes milliseconds. Blank is `null` (no length). A
 * bare number is seconds. Returns `undefined` when the text is not a length,
 * so a form can say so instead of sending something the server will refuse.
 */
export function parseDuration(text: string): number | null | undefined {
  const trimmed = text.trim();
  if (trimmed === "") {
    return null;
  }
  const match = /^(?:(\d{1,2}):)?(\d{1,3}):([0-5]\d)$|^(\d{1,6})$/.exec(
    trimmed,
  );
  if (!match) {
    return undefined;
  }
  const seconds =
    match[4] !== undefined
      ? Number(match[4])
      : Number(match[1] ?? 0) * 3600 + Number(match[2]) * 60 + Number(match[3]);
  return seconds > 0 ? seconds * 1000 : undefined;
}
