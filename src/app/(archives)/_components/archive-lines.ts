import type {
  PublicArtistCard,
  PublicMemorySong,
} from "@/modules/publication/public";

import { dictionaryFor } from "@/i18n/dictionaries";
import type { InterfaceLocale } from "@/i18n/locales";

// The archives' quiet lines (M3.8a), as plain functions of what the
// Publication read models returned, so each says exactly what the data says.

/**
 * The Artists archive's count: "1 album", or "1 album · 2 journals" when
 * there are more journals than albums, so it never reads as a discography.
 */
export function artistCountLine(
  locale: InterfaceLocale,
  artist: PublicArtistCard,
): string {
  const t = dictionaryFor(locale);
  const albums = t.lists.albums(artist.albumCount);
  return artist.journalCount > artist.albumCount
    ? `${albums} · ${t.lists.journals(artist.journalCount)}`
    : albums;
}

/** How many songs the music line names before it says how many more there are. */
export const MUSIC_LINE_SONGS = 3;

/** One song as the music lines write it: "Holocene — Bon Iver". */
export const songText = (song: PublicMemorySong) =>
  song.artists.length > 0
    ? `${song.title} — ${song.artists.join(", ")}`
    : song.title;

/**
 * A memory's music on the Memories archive, as the screen writes it
 * ("Holocene — Bon Iver · Sailor Song — Gigi Perez"); after three songs,
 * "and <n> more".
 */
export function musicLine(
  locale: InterfaceLocale,
  music: readonly PublicMemorySong[],
): string {
  const named = music.slice(0, MUSIC_LINE_SONGS).map(songText);
  const rest = music.length - named.length;
  return rest > 0
    ? `${named.join(" · ")} · ${dictionaryFor(locale).lists.andMore(rest)}`
    : named.join(" · ");
}
