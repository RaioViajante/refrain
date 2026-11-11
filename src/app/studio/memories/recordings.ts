import { formatDuration } from "@/app/studio/format";
import type { StudioDictionary } from "@/i18n/studio";

// Pure helpers for a memory's recording list (M3.6). Presentation only: the
// facts come from the catalog as they are, and nothing is inferred.

/** A recording as the memory editor shows it. */
export interface Recording {
  trackId: string;
  title: string;
  /** Credited artists, in credit order. */
  artists: { id: string; name: string }[];
  /** Titles of the albums the recording is on. */
  albums: string[];
  lengthMs: number | null;
  archived: boolean;
}

/**
 * The line under a recording's title: its kind, credited artists, albums, and
 * length, each only when the catalog has it. Two recordings with one title are
 * told apart by these facts, never by an invented one.
 */
export function recordingFacts(
  t: StudioDictionary,
  recording: Recording,
): string {
  const w = t.recording;
  const facts = [w.song];
  if (recording.artists.length > 0) {
    facts.push(recording.artists.map((artist) => artist.name).join(", "));
  }
  if (recording.albums.length > 0) {
    facts.push(w.on(recording.albums.join(", ")));
  }
  if (recording.lengthMs !== null) {
    facts.push(formatDuration(recording.lengthMs));
  }
  if (recording.archived) {
    facts.push(w.archived);
  }
  return facts.join(" · ");
}

/**
 * The memory's artists, derived from its music (Product § Memory): each
 * credited artist once, in the order the recordings and their credits list
 * them.
 */
export function derivedArtists(recordings: readonly Recording[]): string[] {
  const seen = new Map<string, string>();
  for (const recording of recordings) {
    for (const artist of recording.artists) {
      if (!seen.has(artist.id)) {
        seen.set(artist.id, artist.name);
      }
    }
  }
  return [...seen.values()];
}

// Case and accents do not matter when searching: "sigur" finds "Sigur Rós".
function fold(text: string): string {
  return text.normalize("NFKD").replace(/\p{M}/gu, "").toLocaleLowerCase("en");
}

export const MAX_MATCHES = 8;

/**
 * The catalog recordings that match what the author typed, by title, artist,
 * or album, leaving out those already in the memory. Titles that start with
 * the words come first. Nothing is searched outside the catalog.
 */
export function matchRecordings(
  choices: readonly Recording[],
  query: string,
  linked: ReadonlySet<string>,
): Recording[] {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return [];
  }
  const phrase = words.join(" ");
  const matches = choices.filter((choice) => {
    if (linked.has(choice.trackId)) {
      return false;
    }
    const haystack = fold(
      [
        choice.title,
        ...choice.artists.map((artist) => artist.name),
        ...choice.albums,
      ].join(" "),
    );
    return words.every((word) => haystack.includes(word));
  });
  const starts = (choice: Recording) =>
    fold(choice.title).startsWith(phrase) ? 0 : 1;
  return matches
    .map((choice, index) => ({ choice, index }))
    .sort((a, b) => starts(a.choice) - starts(b.choice) || a.index - b.index)
    .slice(0, MAX_MATCHES)
    .map(({ choice }) => choice);
}

/** The list with the item at `index` moved one place up or down. */
export function moveRecording<Item>(
  list: readonly Item[],
  index: number,
  direction: "up" | "down",
): Item[] {
  const target = direction === "up" ? index - 1 : index + 1;
  if (
    index < 0 ||
    index >= list.length ||
    target < 0 ||
    target >= list.length
  ) {
    return [...list];
  }
  const next = [...list];
  [next[index], next[target]] = [next[target]!, next[index]!];
  return next;
}
