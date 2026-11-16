// Small, pure helpers for the v3 memory pages. A memory's "when" is the
// author's own free text ("a date, a season, a year") and is never read as a
// date (owner decision; ADR 0006 A6): nothing here parses it. The reference's
// year sections wait for the structured year of ADR 0011 § 4.2 (proposed).

/** A title split as the reference sets it: the first half bold, the rest in serif. */
export function splitTitle(title: string): [string, string] {
  const words = title.trim().split(/\s+/);
  if (words.length < 2) return [title.trim(), ""];
  const half = Math.ceil(words.length / 2);
  return [words.slice(0, half).join(" "), words.slice(half).join(" ")];
}
