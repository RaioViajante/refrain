import type {
  PublicArtistCard,
  PublicMemorySong,
} from "@/modules/publication/public";

// The archives' quiet lines (M3.8a), as plain functions of what the
// Publication read models returned, so each says exactly what the data says.

const plural = (count: number, one: string, many: string) =>
  `${count} ${count === 1 ? one : many}`;

/**
 * The Artists archive's count: "1 album", or "1 album · 2 journals" when
 * there are more journals than albums, so it never reads as a discography.
 */
export function artistCountLine(artist: PublicArtistCard): string {
  const albums = plural(artist.albumCount, "album", "albums");
  return artist.journalCount > artist.albumCount
    ? `${albums} · ${plural(artist.journalCount, "journal", "journals")}`
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
export function musicLine(music: readonly PublicMemorySong[]): string {
  const named = music.slice(0, MUSIC_LINE_SONGS).map(songText);
  const rest = music.length - named.length;
  return rest > 0
    ? `${named.join(" · ")} · and ${rest} more`
    : named.join(" · ");
}
