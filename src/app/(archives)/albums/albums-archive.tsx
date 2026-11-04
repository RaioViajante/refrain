import Link from "next/link";

import type { PublicAlbumCard } from "@/modules/publication/public";

import {
  ArchiveEmpty,
  ArchiveFrame,
  ArchiveUnavailable,
  Published,
} from "@/app/(archives)/_components/archive-frame";
import { Artwork } from "@/app/(public)/_components/home-view";
import { RecordIcon } from "@/app/(public)/_components/record-icon";
import { ratingText, Stars } from "@/app/(public)/_components/stars";

// The Albums archive (the approved V4.4 `Albums` screen, M3.8a): three albums
// to a row beside the notebook margin, each the album's square artwork frame,
// its title, "<artist> · <year>", "<n> of <N> tracks written", and the rating
// when one is set, as the Home's album cards show them. It renders only what
// the Publication read model returned.
//
// Every served album journal is reachable from here: each album appears once,
// as a card that opens the journal presented for it, and every other served
// journal about the album is a quiet link under the card. The screen's order
// control (Recently written, Artist, Year) is not built in M3.8a; the albums
// are in the screen's default order, the most recently published first.

/** The screen's lead, the approved interface copy. Also the description. */
export const ALBUMS_LEAD =
  "Whole records, written about slowly. Some have every track, some only a few.";

const addressOf = (slug: string) => `/albums/${slug}`;

function AlbumCard({ album }: Readonly<{ album: PublicAlbumCard }>) {
  const credit = album.credits.join(", ");
  const facts = [
    credit,
    album.firstReleaseYear ? String(album.firstReleaseYear) : "",
  ].filter(Boolean);
  const rating =
    album.ratingHalfSteps !== null ? ratingText(album.ratingHalfSteps) : null;
  return (
    <li className="px-album-item">
      <Link className="ph-album" href={addressOf(album.slug)}>
        <Artwork
          artwork={album.artwork}
          className="ph-art ph-cover"
          sizes="(max-width: 720px) 50vw, 330px"
          fallback={
            <>
              <RecordIcon className="ph-art-icon" size={26} />
              <span className="ph-art-words">no artwork yet</span>
            </>
          }
        />
        <span className="ph-album-text">
          <span className="ph-album-title">{album.albumTitle}</span>{" "}
          {facts.length > 0 ? (
            <span className="ph-album-facts">{facts.join(" · ")}</span>
          ) : null}{" "}
          {album.trackCount > 0 ? (
            <span className="px-progress">
              {`${album.writtenTrackCount} of ${album.trackCount} tracks written`}
            </span>
          ) : null}{" "}
          {rating !== null ? (
            <span className="ph-album-rating">
              <Stars
                halfSteps={album.ratingHalfSteps!}
                label={`My rating: ${rating} out of 5`}
                size={15}
              />
              <span className="ph-rating-value" aria-hidden="true">
                {`[${rating}]`}
              </span>
            </span>
          ) : null}
        </span>
      </Link>
      {album.otherJournals.length > 0 ? (
        <ul className="px-more" role="list">
          {album.otherJournals.map((journal) => (
            <li key={journal.slug}>
              <Link className="px-more-link" href={addressOf(journal.slug)}>
                <span>
                  Another journal, published{" "}
                  <Published at={journal.publishedAt} />
                  <span className="pj-visually-hidden">
                    {` (about ${album.albumTitle})`}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}

export function AlbumsArchive({
  albums,
}: Readonly<{ albums: readonly PublicAlbumCard[] | null }>) {
  return (
    <ArchiveFrame section="albums" title="Albums" lead={ALBUMS_LEAD}>
      {albums === null ? (
        <ArchiveUnavailable />
      ) : albums.length === 0 ? (
        <ArchiveEmpty />
      ) : (
        <ul className="px-albums" role="list">
          {albums.map((album) => (
            <AlbumCard key={album.slug} album={album} />
          ))}
        </ul>
      )}
    </ArchiveFrame>
  );
}
