import Link from "next/link";
import { Fragment } from "react";

import type {
  PublicAlbumJournal,
  PublicArtwork,
} from "@/modules/publication/public";

import { ClosingLinks } from "@/app/(public)/_components/closing-links";
import { PUBLIC_CONTENT_ID } from "@/app/(public)/_components/public-frame";
import { RecordIcon } from "@/app/(public)/_components/record-icon";
import { renderDocument } from "@/app/(public)/_components/rich-text";
import { Stars } from "@/app/(public)/_components/stars";
import { dictionaryFor } from "@/i18n/dictionaries";
import { formatDate, ratingText } from "@/i18n/format";
import type { InterfaceLocale } from "@/i18n/locales";
import { localizedHref } from "@/i18n/paths";

// The public album journal (the approved V4.4 "Grace" screen). It renders only
// what the Publication read model returned, which is already limited to what a
// reader may see. It has no author control, no draft marker, and no private
// metadata, and the writing is shown in the language it was written in.

function Chevron({ className }: Readonly<{ className?: string }>) {
  return (
    <svg
      className={className}
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}

/**
 * The album artwork in its fixed 1:1 frame (docs/design-system.md §
 * Components). The fallback is always there; a chosen Cover Art Archive cover
 * covers it once loaded, so nothing moves, and if the image never arrives the
 * fallback is what remains. The image is decorative inside the frame, which
 * carries the accessible name. It is requested without a referrer, and only
 * from the archive (the Content-Security-Policy allows nothing else).
 */
function Artwork({
  title,
  artwork,
  locale,
}: Readonly<{
  title: string;
  artwork: PublicArtwork | null;
  locale: InterfaceLocale;
}>) {
  const t = dictionaryFor(locale).albumJournal;
  return (
    <>
      <div
        className="pj-cover"
        role="img"
        aria-label={artwork ? t.artworkFor(title) : t.artworkMissingFor(title)}
      >
        <span className="pj-cover-hatch" aria-hidden="true" />
        <span className="pj-cover-text" aria-hidden="true">
          <RecordIcon />
          <b>{t.artwork}</b>
          <i>{artwork ? t.artworkFromArchive : t.artworkNotYet}</i>
        </span>
        {artwork ? (
          // eslint-disable-next-line @next/next/no-img-element -- a remote cover, deliberately not routed through an image optimizer (docs/evidence/m3-2.md)
          <img
            className="pj-cover-image"
            src={artwork.src}
            srcSet={artwork.srcSet}
            sizes="(max-width: 720px) 100vw, 514px"
            width={500}
            height={500}
            alt=""
            decoding="async"
            fetchPriority="high"
            referrerPolicy="no-referrer"
          />
        ) : null}
      </div>
      {artwork ? <p className="pj-cover-caption">{t.artworkCaption}</p> : null}
    </>
  );
}

export function JournalView({
  journal,
  locale: interfaceLocale,
}: Readonly<{ journal: PublicAlbumJournal; locale: InterfaceLocale }>) {
  // `locale` is the writing's language (the version shown); the interface
  // language only chooses the words around it.
  const { album, credits, tracks, locale } = journal;
  const dictionary = dictionaryFor(interfaceLocale);
  const t = dictionary.albumJournal;
  const facts = [
    album.firstReleaseYear ? String(album.firstReleaseYear) : null,
    album.label,
    tracks.length > 0 ? t.tracks(tracks.length) : null,
  ].filter((fact): fact is string => fact !== null);
  const body = renderDocument(journal.body, 2);
  const ratingValue =
    journal.ratingHalfSteps !== null
      ? ratingText(interfaceLocale, journal.ratingHalfSteps)
      : "";

  return (
    <main className="public-shell pj" id={PUBLIC_CONTENT_ID} tabIndex={-1}>
      <article className="pj-grid">
        <div className="pj-art">
          <Artwork
            title={album.title}
            artwork={album.artwork}
            locale={interfaceLocale}
          />
        </div>
        <div className="pj-meta">
          <p>
            {t.published}{" "}
            <time dateTime={journal.publishedAt.toISOString()}>
              {formatDate(interfaceLocale, journal.publishedAt, "long")}
            </time>
          </p>
          <p>{dictionary.writtenIn(dictionary.writingLanguages[locale])}</p>
          {tracks.length > 0 ? (
            <a className="pj-button" href="#tracks">
              <span>{t.goToTracks}</span>
              <Chevron className="pj-chevron-down" />
            </a>
          ) : null}
          {journal.marginNote?.trim() ? (
            <aside className="pj-margin-note" lang={locale}>
              <p>{journal.marginNote}</p>
            </aside>
          ) : null}
        </div>

        <header className="pj-head">
          <p className="pj-kind">
            <RecordIcon />
            {t.kind}
          </p>
          <h1 className="pj-title">{album.title}</h1>
          {credits.length > 0 ? (
            <p className="pj-artist">
              {credits.map((credit, index) => (
                <Fragment key={index}>
                  {index > 0 ? ", " : null}
                  {credit.artistAddress ? (
                    // Each credited artist's page (M3.5). An archived artist
                    // has none, and its name stays plain text.
                    <Link
                      className="pj-artist-link"
                      href={localizedHref(
                        interfaceLocale,
                        `/artists/${credit.artistAddress}`,
                      )}
                    >
                      {credit.name}
                    </Link>
                  ) : (
                    credit.name
                  )}
                </Fragment>
              ))}
            </p>
          ) : null}
          {facts.length > 0 ? (
            <p className="pj-facts">{facts.join(" · ")}</p>
          ) : null}
          {journal.opening?.trim() ? (
            <p className="pj-opening" lang={locale}>
              {journal.opening}
            </p>
          ) : null}
          {journal.ratingHalfSteps !== null ? (
            <p className="pj-rating">
              <span aria-hidden="true">{dictionary.rating.label}</span>
              <Stars
                halfSteps={journal.ratingHalfSteps}
                label={dictionary.rating.accessible(ratingValue)}
                size={22}
              />
              <span className="pj-rating-value" aria-hidden="true">
                {`[${ratingValue}] / 5`}
              </span>
            </p>
          ) : null}
        </header>

        {body ? (
          <div className="pj-body" lang={locale}>
            {body}
          </div>
        ) : null}
      </article>

      {tracks.length > 0 ? (
        <section
          className="pj-grid pj-tracks-section"
          id="tracks"
          aria-labelledby="tracks-heading"
        >
          <div className="pj-tracks-intro">
            <h2 id="tracks-heading">{t.trackByTrack}</h2>
            <p>{t.trackByTrackHint}</p>
          </div>
          <ol className="pj-tracks" role="list">
            {tracks.map((track) => {
              const number = String(track.number).padStart(2, "0");
              const reflection = track.reflection;
              const name = (
                <>
                  <span
                    className={reflection?.isFavourite ? "pj-fav" : undefined}
                  >
                    {reflection?.isFavourite ? (
                      <span className="pj-visually-hidden">{t.favourite}</span>
                    ) : null}
                    {track.title}
                  </span>
                  {reflection?.isStillWriting ? (
                    <span className="pj-still-writing">{t.stillWriting}</span>
                  ) : null}
                </>
              );
              const credit = track.credit ? (
                <span className="pj-track-credit">{t.by(track.credit)}</span>
              ) : null;

              if (!reflection) {
                return (
                  <li key={track.number} className="pj-track">
                    <div className="pj-track-row pj-track-unwritten">
                      <span className="pj-visually-hidden">
                        {t.track(track.number)}
                      </span>
                      <span className="pj-track-number" aria-hidden="true">
                        {number}
                      </span>
                      <span className="pj-track-name">
                        <span className="pj-track-title">{track.title}</span>
                        {credit}
                      </span>
                      <span className="pj-track-status">{t.notWrittenYet}</span>
                    </div>
                  </li>
                );
              }

              const reflectionBody = renderDocument(reflection.body, 3);
              const rating =
                reflection.ratingHalfSteps !== null
                  ? ratingText(interfaceLocale, reflection.ratingHalfSteps)
                  : null;
              return (
                <li key={track.number} className="pj-track">
                  <details>
                    <summary className="pj-track-row">
                      <span className="pj-visually-hidden">
                        {t.track(track.number)}
                      </span>
                      <span className="pj-track-number" aria-hidden="true">
                        {number}
                      </span>
                      <span className="pj-track-name">
                        <span className="pj-track-title">{name}</span>
                        {credit}
                      </span>
                      {rating !== null ? (
                        <span className="pj-track-rating">
                          <Stars
                            halfSteps={reflection.ratingHalfSteps ?? 0}
                            label={dictionary.rating.accessible(rating)}
                            size={15}
                          />
                          <span className="pj-rating-value" aria-hidden="true">
                            {`[${rating}]`}
                          </span>
                        </span>
                      ) : (
                        <span />
                      )}
                      <Chevron className="pj-chevron" />
                    </summary>
                    <div className="pj-reflection" lang={locale}>
                      {reflectionBody}
                    </div>
                  </details>
                </li>
              );
            })}
          </ol>
        </section>
      ) : null}
      <ClosingLinks
        locale={interfaceLocale}
        archive="/albums"
        label={t.allAlbums}
        artists={credits.flatMap((credit) =>
          credit.artistAddress
            ? [{ name: credit.name, address: credit.artistAddress }]
            : [],
        )}
      />
    </main>
  );
}
