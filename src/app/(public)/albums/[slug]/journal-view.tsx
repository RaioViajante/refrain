import type { PublicAlbumJournal } from "@/modules/publication/public";

import { PUBLIC_CONTENT_ID } from "@/app/(public)/_components/public-frame";
import { renderDocument } from "@/app/(public)/_components/rich-text";
import { ratingText, Stars } from "@/app/(public)/_components/stars";

// The public album journal (the approved V4.4 "Grace" screen). It renders only
// what the Publication read model returned, which is already limited to what a
// reader may see. It has no author control, no draft marker, and no private
// metadata, and the writing is shown in the language it was written in.

const LANGUAGE_NAMES: Record<string, string> = {
  en: "English",
  "pt-BR": "Brazilian Portuguese",
};

const date = new Intl.DateTimeFormat("en", {
  dateStyle: "long",
  timeZone: "UTC",
});

function RecordIcon() {
  return (
    <svg
      className="pj-icon"
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <rect x="3.5" y="3.5" width="17" height="17" rx="2.5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="12" cy="12" r="0.9" fill="currentColor" />
    </svg>
  );
}

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

/** The graceful stand-in until album artwork is fetched from a provider. */
function Artwork({ title }: Readonly<{ title: string }>) {
  return (
    <div
      className="pj-cover"
      role="img"
      aria-label={`Album artwork for ${title}: not available yet`}
    >
      <span className="pj-cover-hatch" aria-hidden="true" />
      <span className="pj-cover-text" aria-hidden="true">
        <RecordIcon />
        <b>Album artwork</b>
        <i>not available yet</i>
      </span>
    </div>
  );
}

export function JournalView({
  journal,
}: Readonly<{ journal: PublicAlbumJournal }>) {
  const { album, credits, tracks, locale } = journal;
  const artist = credits.map((credit) => credit.name).join(", ");
  const facts = [
    album.firstReleaseYear ? String(album.firstReleaseYear) : null,
    album.label,
    tracks.length > 0
      ? `${tracks.length} ${tracks.length === 1 ? "track" : "tracks"}`
      : null,
  ].filter((fact): fact is string => fact !== null);
  const body = renderDocument(journal.body, 2);
  const ratingValue =
    journal.ratingHalfSteps !== null ? ratingText(journal.ratingHalfSteps) : "";

  return (
    <main className="public-shell pj" id={PUBLIC_CONTENT_ID} tabIndex={-1}>
      <article className="pj-grid">
        <div className="pj-art">
          <Artwork title={album.title} />
        </div>
        <div className="pj-meta">
          <p>
            Published{" "}
            <time dateTime={journal.publishedAt.toISOString()}>
              {date.format(journal.publishedAt)}
            </time>
          </p>
          <p>{`Written in ${LANGUAGE_NAMES[locale] ?? locale}`}</p>
          {tracks.length > 0 ? (
            <a className="pj-button" href="#tracks">
              <span>Go to the tracks</span>
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
            Album journal
          </p>
          <h1 className="pj-title">{album.title}</h1>
          {artist ? <p className="pj-artist">{artist}</p> : null}
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
              <span aria-hidden="true">My rating</span>
              <Stars
                halfSteps={journal.ratingHalfSteps}
                label={`My rating: ${ratingValue} out of 5`}
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
            <h2 id="tracks-heading">Track by track</h2>
            <p>
              Open a track to read what I wrote. Not every track has a
              reflection.
            </p>
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
                      <span className="pj-visually-hidden">Favourite: </span>
                    ) : null}
                    {track.title}
                  </span>
                  {reflection?.isStillWriting ? (
                    <span className="pj-still-writing"> (still writing)</span>
                  ) : null}
                </>
              );
              const credit = track.credit ? (
                <span className="pj-track-credit">{`by ${track.credit}`}</span>
              ) : null;

              if (!reflection) {
                return (
                  <li key={track.number} className="pj-track">
                    <div className="pj-track-row pj-track-unwritten">
                      <span className="pj-visually-hidden">{`Track ${track.number}: `}</span>
                      <span className="pj-track-number" aria-hidden="true">
                        {number}
                      </span>
                      <span className="pj-track-name">
                        <span className="pj-track-title">{track.title}</span>
                        {credit}
                      </span>
                      <span className="pj-track-status">not written yet</span>
                    </div>
                  </li>
                );
              }

              const reflectionBody = renderDocument(reflection.body, 3);
              const rating =
                reflection.ratingHalfSteps !== null
                  ? ratingText(reflection.ratingHalfSteps)
                  : null;
              return (
                <li key={track.number} className="pj-track">
                  <details>
                    <summary className="pj-track-row">
                      <span className="pj-visually-hidden">{`Track ${track.number}: `}</span>
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
                            label={`My rating: ${rating} out of 5`}
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
    </main>
  );
}
