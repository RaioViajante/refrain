import Link from "next/link";

import type { PublicArtistCard } from "@/modules/publication/public";

import {
  ArchiveEmpty,
  ArchiveFrame,
  ArchiveUnavailable,
} from "@/app/(archives)/_components/archive-frame";
import { artistCountLine } from "@/app/(archives)/_components/archive-lines";

// The Artists archive (the approved V4.4 `Artists` screen, M3.8a): the
// screen's ruled list, one row per artist, the name in Kalam and a quiet count
// of the albums written about on the right. Only the artists whose page is
// served appear (ADR 0006 A5); each row opens that page.
//
// What the screen shows and this page does not, by the owner's decisions:
// the "With a journal" section (artist journals have no public reading
// contract), "Solo artist" and "Band" (the catalog's artist kind is not public),
// counts of memories (a memory never makes an artist public), and
// photographs (they stay on the artist's own page, with their credit).

/**
 * The page's lead, by the owner's decision (M3.8a). The screen's own lead says
 * that a memory brings an artist here, which is not true: only an album
 * journal does.
 */
export const ARTISTS_LEAD = "The artists behind the albums I've written about.";

export function ArtistsArchive({
  artists,
}: Readonly<{ artists: readonly PublicArtistCard[] | null }>) {
  return (
    <ArchiveFrame section="artists" title="Artists" lead={ARTISTS_LEAD}>
      {artists === null ? (
        <ArchiveUnavailable />
      ) : artists.length === 0 ? (
        <ArchiveEmpty />
      ) : (
        <ul className="px-rows" role="list">
          {artists.map((artist) => (
            <li key={artist.address} className="px-row-item">
              <Link className="px-row" href={`/artists/${artist.address}`}>
                <span className="px-row-name">{artist.name}</span>{" "}
                <span className="px-row-meta">{artistCountLine(artist)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </ArchiveFrame>
  );
}
