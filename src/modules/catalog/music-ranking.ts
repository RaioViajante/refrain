// The order of Add music's album results. MusicBrainz ranks by textual
// similarity across the words typed, so "grace jeff buckley" puts a release
// titled "Jeff Buckley Live" above Jeff Buckley's Grace. One rule corrects
// that, from the provider's own title, credit, and type, and names no album or
// artist: a result is a complete match when the words typed are exactly its
// title, plus words of its credited artists. Complete matches come first, a
// studio album before an EP, an EP before a single, and anything with a
// secondary type (a live album, a compilation) after those. Everything else
// keeps the provider's order, and nothing is hidden or relabelled. The cases
// it was measured against are in music-ranking.test.ts.

export interface RankableAlbum {
  title: string;
  credit: string;
  primaryType: string | null;
  secondaryTypes: readonly string[];
}

/** The words of a text: case, accents, and punctuation do not count. */
function wordsOf(text: string): string[] {
  return (
    text
      .replace(/&/g, " and ")
      .normalize("NFKD")
      .replace(/\p{M}/gu, "")
      .toLowerCase()
      .match(/[\p{L}\p{N}]+/gu) ?? []
  );
}

function isCompleteMatch(album: RankableAlbum, typed: Set<string>): boolean {
  const title = new Set(wordsOf(album.title));
  if (title.size === 0 || ![...title].every((word) => typed.has(word))) {
    return false;
  }
  const credit = new Set(wordsOf(album.credit));
  return [...typed].every((word) => title.has(word) || credit.has(word));
}

function typeRank(album: RankableAlbum): number {
  if (album.secondaryTypes.length > 0) {
    return 3;
  }
  return { Album: 0, EP: 1, Single: 2 }[album.primaryType ?? ""] ?? 3;
}

/** A new list in the order above. The provider's order breaks every tie. */
export function rankAlbumResults<Album extends RankableAlbum>(
  query: string,
  albums: readonly Album[],
): Album[] {
  const typed = new Set(wordsOf(query));
  return albums
    .map((album, index) => ({
      album,
      index,
      rank: isCompleteMatch(album, typed) ? typeRank(album) : 4,
    }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map(({ album }) => album);
}
