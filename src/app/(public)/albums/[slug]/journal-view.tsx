import Link from "next/link";

import type {
  PublicAlbumCard,
  PublicAlbumJournal,
  PublicJournalTrack,
} from "@/modules/publication/public";

import { renderDocument } from "@/app/(public)/_components/rich-text";
import { Cover, labelLine } from "@/app/v3/cover";
import { PenRing, Vinyl } from "@/app/v3/objects";
import { otherLocale, type InterfaceLocale } from "@/i18n/locales";
import { localizedHref } from "@/i18n/paths";
import { v3Decimal, v3StringsFor } from "@/i18n/v3";
import { pixelDate, v3TemplatesFor } from "@/i18n/v3/templates";

import { TrackRuntime } from "./track-runtime";

// The public album journal (docs/design-system.md, Part I, Pages: album
// journal), drawn from the approved reference: the sleeve and its record, the
// title, the rating circled in pen, the opening sentence; the margin note and
// the writing; the back of the sleeve, track by track; and the journals
// written before and after it.
//
// Everything comes from the Publication module's read of this one public
// language version (PublicAlbumJournal) and, for the crate, the public
// archive. A track whose reflection is not public in this language shows as
// "not written yet", the same as a track with none (INV-3): the page never
// tells the two apart. The favourite circle and the track rating come only
// with a public reflection. Annotations appear only when the author recorded
// them; an empty field is not rendered (ADR 0011 § 4.10).

const RATING_RING =
  "M14.3 17.5 Q19.7 10.7 25 7.7 Q30.4 4.7 39.1 5 Q47.9 5.3 55.5 4 Q63 2.8 68.8 6.4 Q74.6 10 82.7 9.5 Q90.9 9.1 97.2 11 Q103.6 12.9 107.8 15.9 Q112 18.9 113.9 22.2 Q115.7 25.6 117.8 29.2 Q119.9 32.7 116.4 36 Q112.9 39.3 107.7 41.8 Q102.4 44.3 99.7 47.9 Q96.9 51.6 89.3 52.7 Q81.6 53.8 74.1 54.1 Q66.6 54.4 59 55.2 Q51.4 56 43.8 55.3 Q36.1 54.5 28.7 52.9 Q21.4 51.3 17.1 48.2 Q12.8 45.1 9.3 41.9 Q5.7 38.8 3.7 35.4 Q1.6 31.9 1.6 28.3 Q1.7 24.7 6.1 21.7 Q10.5 18.7 11.3 14.4 Q12.1 10.2 21.4 9.6 Q30.6 8.9 37.1 7.1 Q43.6 5.4 51.1 5 L58.7 4.6";
const FAVOURITE_RING =
  "M14.9 12.2 Q30.5 9.6 37.4 8.1 Q44.4 6.6 53.2 5.3 Q62.1 3.9 73 4.1 Q84 4.3 94.4 4.7 Q104.7 5.1 112.1 6.6 Q119.5 8.2 127.9 9.3 Q136.2 10.3 144 11.8 Q151.8 13.2 155.5 15.3 Q159.3 17.3 154 19.3 Q148.7 21.4 150 23.4 Q151.3 25.5 150.1 27.9 Q149 30.3 138.6 31.3 Q128.2 32.4 119.4 33.6 Q110.6 34.8 100.3 35.7 Q90.1 36.5 79.9 35.2 Q69.6 33.9 59.2 34 Q48.7 34.1 39.3 33.1 Q29.9 32.2 22 30.7 Q14 29.3 7.8 27.4 Q1.5 25.6 0.2 23.4 Q-1.1 21.2 2.4 19.1 Q5.9 17 8.3 15 Q10.7 13 16.1 11.2 Q21.6 9.4 29.4 7.9 Q37.3 6.5 47 5.6 Q56.8 4.7 67.4 4 L78 3.3";

const pad = (n: number) => String(n).padStart(2, "0");

/** The track the sleeve's record shows first: the favourite, else the first written. */
function firstShown(tracks: readonly PublicJournalTrack[]): PublicJournalTrack | null {
  return (
    tracks.find((track) => track.reflection?.isFavourite) ??
    tracks.find((track) => track.reflection !== null) ??
    null
  );
}

export interface JournalNeighbours {
  before: PublicAlbumCard | null;
  after: PublicAlbumCard | null;
}

export function JournalView({
  journal,
  locale,
  neighbours,
  slug,
}: Readonly<{
  journal: PublicAlbumJournal;
  locale: InterfaceLocale;
  neighbours: JournalNeighbours;
  slug: string;
}>) {
  const t = v3StringsFor(locale).album;
  const tt = v3TemplatesFor(locale);
  const { album } = journal;
  const artists = journal.credits.map((credit) => credit.name);
  const artistLine = artists.join(", ");
  const year = album.firstReleaseYear;
  const shown = firstShown(journal.tracks);
  const rating =
    journal.ratingHalfSteps !== null ? v3Decimal(locale, journal.ratingHalfSteps / 2) : null;
  const body = renderDocument(journal.body, 2);
  const firstArtist = journal.credits.find((credit) => credit.artistAddress !== null);
  const titleLine = [album.title, year ? String(year) : null].filter(Boolean).join(", ");
  const written = journal.locale;
  return (
    <main id="main" tabIndex={-1}>
      <article lang={journal.locale}>
        <section className="gtop wrap" aria-labelledby="pp-h1">
          <div className="sl front" data-a="sleeve" data-d="0">
            <Vinyl top={t.nowT} bottom={shown ? pad(shown.number) : ""} />
            <div className="card">
              <p className="gt ser" lang={locale === journal.locale ? undefined : journal.locale}>
                {album.title}.
              </p>
              <Cover
                artwork={album.artwork}
                title={album.title}
                line={labelLine(artists, year)}
                loading="eager"
              />
              <span className="foot">
                <span className="ser">{year ?? ""}</span>
                <span className="hand">
                  {artistLine
                    .toLowerCase()
                    .split(" ")
                    .map((word, i) => (
                      <span key={i}>
                        {i > 0 ? <br /> : null}
                        {word}
                      </span>
                    ))}
                </span>
              </span>
            </div>
          </div>
          <div className="txt">
            <p className="k pix" data-a="fade" data-d="4" lang={locale}>
              {tt.albumKind(journal.tracks.length)}
            </p>
            <h1 id="pp-h1" className="ser" data-a="up" data-d="5">
              {album.title}
            </h1>
            {artistLine || year ? (
              <p className="by" data-a="up" data-d="7">
                {[artistLine, year].filter(Boolean).join(", ")}
              </p>
            ) : null}
            {rating ? (
              <p
                className="rt hand"
                role="img"
                aria-label={tt.ratingAria(rating)}
                data-a="pop"
                data-d="10"
              >
                [{rating}]
                <PenRing d={RATING_RING} viewBox="0 0 120 60" />
                <small aria-hidden="true">{t.myRating}</small>
              </p>
            ) : null}
            {journal.opening?.trim() ? (
              <p className="open ser" data-a="up" data-d="12">
                {journal.opening}
              </p>
            ) : null}
          </div>
        </section>
        <section className="review wrap" aria-labelledby="pp-h1">
          {journal.marginNote?.trim() ? (
            <p className="mg hand" data-a="write" data-d="2">
              {journal.marginNote}
            </p>
          ) : null}
          <div className="body" data-a="up" data-d="0">
            {body}
            <p className="fine2 pix" lang={locale}>
              {tt.written(pixelDate(locale, journal.publishedAt))} ·{" "}
              {journal.isOriginal
                ? tt.inLanguage(written)
                : tt.translatedFrom(otherLocale(written))}
              {journal.isOriginal ? null : (
                <>
                  {" · "}
                  <Link
                    className="orig pix"
                    href={localizedHref(otherLocale(locale), `/albums/${slug}`)}
                    hrefLang={otherLocale(locale)}
                  >
                    {tt.readOriginal}
                  </Link>
                </>
              )}
            </p>
          </div>
        </section>
        <section className="tk wrap" aria-labelledby="pp-tk" lang={locale}>
          <div className="shead" data-a="up" data-d="0">
            <h2 id="pp-tk">
              {t.trH}
              <span className="ser">{titleLine}</span>
            </h2>
            <p>{t.trHint}</p>
          </div>
          <div className="bw" data-a="sleeve" data-d="2" style={{ ["--vx" as string]: "-40%" }}>
            <Vinyl top={locale === "pt-BR" ? "lado a" : "side a"} bottom={year ? String(year) : ""} />
            <div className="back">
              <span className="mono ser" aria-hidden="true">
                {album.title.charAt(0)}
              </span>
              <div className="top pix">
                <span>{year ?? ""}</span>
                <span>{t.side}</span>
              </div>
              <ol aria-label={album.title}>
                {journal.tracks.map((track) => (
                  <TrackRow
                    key={track.number}
                    track={track}
                    locale={locale}
                    open={shown?.number === track.number}
                    journalLocale={journal.locale}
                  />
                ))}
              </ol>
            </div>
          </div>
          <div className="after">
            {firstArtist?.artistAddress ? (
              <Link
                className="pill"
                href={localizedHref(locale, `/artists/${firstArtist.artistAddress}`)}
              >
                {tt.moreAbout(firstArtist.name)}
              </Link>
            ) : null}
            <Link className="pill ghost" href={localizedHref(locale, "/albums")}>
              {t.all}
            </Link>
          </div>
        </section>
        <Crate locale={locale} neighbours={neighbours} />
      </article>
      <TrackRuntime />
    </main>
  );
}

function TrackRow({
  track,
  locale,
  open,
  journalLocale,
}: Readonly<{
  track: PublicJournalTrack;
  locale: InterfaceLocale;
  open: boolean;
  journalLocale: string;
}>) {
  const t = v3StringsFor(locale).album;
  const tt = v3TemplatesFor(locale);
  const reflection = track.reflection;
  const credit = track.credit ? `${t.by} ${track.credit}` : null;
  const text = reflection ? renderDocument(reflection.body, 3) : null;
  if (!reflection) {
    return (
      <li>
        <div className="trow off">
          <span className="no">{pad(track.number)}</span>
          <span className="nm">
            <span className="tt">{track.title}</span>
            {credit ? <span className="cr">{credit}</span> : null}
          </span>
          <span className="ny">{t.notYet}</span>
          <span aria-hidden="true" />
        </div>
      </li>
    );
  }
  const rating =
    reflection.ratingHalfSteps !== null ? v3Decimal(locale, reflection.ratingHalfSteps / 2) : null;
  return (
    <li>
      <details className="trw" open={open} data-n={pad(track.number)}>
        <summary className="trow">
          <span className="no">{pad(track.number)}</span>
          <span className="nm">
            <span className="tt">
              {track.title}
              {reflection.isFavourite ? <PenRing d={FAVOURITE_RING} viewBox="0 0 160 40" /> : null}
            </span>
            {reflection.isFavourite ? <span className="note hand">{t.fav}</span> : null}
            {reflection.isStillWriting ? <span className="note hand">{t.draft}</span> : null}
            {credit ? <span className="cr">{credit}</span> : null}
          </span>
          {rating ? (
            <span className="rv hand" role="img" aria-label={tt.ratingAria(rating)}>
              [{rating}]
            </span>
          ) : (
            <span />
          )}
          <span className="pl" aria-hidden="true" />
        </summary>
        {text ? (
          <div className="leaf2" lang={journalLocale}>
            {/* eslint-disable-next-line @next/next/no-img-element -- decorative tape */}
            <img className="tp" src="/v3/tape-a.png" alt="" aria-hidden="true" />
            <div className="hand leaf-text">{text}</div>
          </div>
        ) : null}
      </details>
    </li>
  );
}

function Crate({
  locale,
  neighbours,
}: Readonly<{ locale: InterfaceLocale; neighbours: JournalNeighbours }>) {
  const t = v3StringsFor(locale).album;
  const { before, after } = neighbours;
  if (!before && !after) return null;
  const sleeve = (card: PublicAlbumCard, label: string) => {
    const year = card.firstReleaseYear;
    return (
      <Link className="cr1" href={localizedHref(locale, `/albums/${card.slug}`)}>
        <span>
          <span className="pix">{label}</span>
          <span className="nm ser">{card.albumTitle}</span>
          <span className="ar">{[card.credits.join(", "), year].filter(Boolean).join(", ")}</span>
        </span>
        <span className="cv" aria-hidden="true">
          <Vinyl
            top={card.credits.join(", ").toLowerCase()}
            bottom={card.albumTitle.toUpperCase()}
          />
          <Cover
            artwork={card.artwork}
            title={card.albumTitle}
            line={labelLine(card.credits, year)}
            sizes="150px"
          />
        </span>
      </Link>
    );
  };
  return (
    <nav className="crate wrap" aria-label={t.crateA} data-a="up" data-d="0" lang={locale}>
      {before ? (
        sleeve(before, t.before)
      ) : (
        <span className="cr0">
          <span className="pix">{t.before}</span>
          <span className="hand">{t.firstOne}</span>
        </span>
      )}
      {after ? sleeve(after, t.after) : <span />}
    </nav>
  );
}
