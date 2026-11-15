// Small, pure helpers for the v3 memory pages. A memory's "when" is the
// author's own free text today ("a date, a season, a year"); v3 groups the
// board by year, so a year is read from that text only when it plainly holds
// one. Nothing is guessed: a memory whose text names no year is "undated".
// (The structured year, month, or undated of ADR 0011 § 4.2 is proposed, and
// replaces this when its migration lands.)

/** The year a "when" names, if it names exactly one four-digit year. */
export function yearOf(rememberedWhen: string | null): number | null {
  if (!rememberedWhen) return null;
  const years = rememberedWhen.match(/\b(1[89]\d{2}|20\d{2}|21\d{2})\b/g);
  if (!years) return null;
  const unique = [...new Set(years)];
  return unique.length === 1 ? Number(unique[0]) : null;
}

export interface YearGroup<T> {
  /** The years, newest first; empty for the undated group. */
  years: number[];
  items: T[];
}

/**
 * The board's sections, newest year first, then the undated memories. A year
 * with fewer than `sparse` memories shares its section with the next one, as
 * the reference shows "2023 & 2022".
 */
export function groupByYear<T>(
  items: readonly T[],
  yearOfItem: (item: T) => number | null,
  sparse = 3,
): YearGroup<T>[] {
  const byYear = new Map<number, T[]>();
  const undated: T[] = [];
  for (const item of items) {
    const year = yearOfItem(item);
    if (year === null) undated.push(item);
    else byYear.set(year, [...(byYear.get(year) ?? []), item]);
  }
  const groups: YearGroup<T>[] = [];
  for (const year of [...byYear.keys()].sort((a, b) => b - a)) {
    const list = byYear.get(year)!;
    const last = groups[groups.length - 1];
    if (last && last.years.length === 1 && last.items.length < sparse) {
      last.years.push(year);
      last.items.push(...list);
    } else {
      groups.push({ years: [year], items: [...list] });
    }
  }
  if (undated.length > 0) groups.push({ years: [], items: undated });
  return groups;
}

/** A title split as the reference sets it: the first half bold, the rest in serif. */
export function splitTitle(title: string): [string, string] {
  const words = title.trim().split(/\s+/);
  if (words.length < 2) return [title.trim(), ""];
  const half = Math.ceil(words.length / 2);
  return [words.slice(0, half).join(" "), words.slice(half).join(" ")];
}
