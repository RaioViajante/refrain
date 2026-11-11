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
import { Stars } from "@/app/(public)/_components/stars";
import { dictionaryFor } from "@/i18n/dictionaries";
import { ratingText } from "@/i18n/format";
import type { InterfaceLocale } from "@/i18n/locales";
import { localizedHref } from "@/i18n/paths";

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
//
// The lead is in the dictionaries (src/i18n), and doubles as the description.

function AlbumCard({
  album,
  locale,
}: Readonly<{ album: PublicAlbumCard; locale: InterfaceLocale }>) {
  const t = dictionaryFor(locale);
  const addressOf = (slug: string) => localizedHref(locale, `/albums/${slug}`);
  const credit = album.credits.join(", ");
  const facts = [
    credit,
    album.firstReleaseYear ? String(album.firstReleaseYear) : "",
  ].filter(Boolean);
  const rating =
    album.ratingHalfSteps !== null
      ? ratingText(locale, album.ratingHalfSteps)
      : null;
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
              <span className="ph-art-words">{t.home.noArtwork}</span>
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
              {t.archives.tracksWritten(
                album.writtenTrackCount,
                album.trackCount,
              )}
            </span>
          ) : null}{" "}
          {rating !== null ? (
            <span className="ph-album-rating">
              <Stars
                halfSteps={album.ratingHalfSteps!}
                label={t.rating.accessible(rating)}
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
                  {t.archives.anotherJournal}{" "}
                  <Published at={journal.publishedAt} locale={locale} />
                  <span className="pj-visually-hidden">
                    {t.archives.aboutAlbum(album.albumTitle)}
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
  locale,
}: Readonly<{
  albums: readonly PublicAlbumCard[] | null;
  locale: InterfaceLocale;
}>) {
  const t = dictionaryFor(locale);
  return (
    <ArchiveFrame
      locale={locale}
      section="albums"
      title={t.archives.albums.title}
      lead={t.archives.albums.lead}
    >
      {albums === null ? (
        <ArchiveUnavailable locale={locale} />
      ) : albums.length === 0 ? (
        <ArchiveEmpty locale={locale} />
      ) : (
        <ul className="px-albums" role="list">
          {albums.map((album) => (
            <AlbumCard key={album.slug} album={album} locale={locale} />
          ))}
        </ul>
      )}
    </ArchiveFrame>
  );
}
