import Link from "next/link";
import type { ReactNode } from "react";

import type { PublicMemory } from "@/modules/publication/public";

import { renderDocument } from "@/app/(public)/_components/rich-text";
import { splitTitle } from "@/app/v3/memory-shape";
import { Kraft, Vinyl } from "@/app/v3/objects";
import type { InterfaceLocale } from "@/i18n/locales";
import { localizedHref } from "@/i18n/paths";
import { v3StringsFor } from "@/i18n/v3";
import { v3TemplatesFor } from "@/i18n/v3/templates";

// A public memory (docs/design-system.md, Part I, Pages: memory): a print
// taped to the page, the writing in the author's hand on lined paper, the song
// on a turning record with its links, and the way to the memories before and
// after it.
//
// Everything comes from the Publication module's read of this one public
// version. A link goes to an album journal or an artist only when that page is
// itself public. The memory has no photograph yet, so the print holds the
// reference's empty state, lined paper with the title. No signature is shown:
// the author's initials are a setting that does not exist yet.

export interface MemoryNeighbours {
  previous: string | null;
  next: string | null;
}

const WRITE_DELAYS = [10, 16, 21, 23, 24];

export function MemoryView({
  memory,
  locale,
  neighbours,
}: Readonly<{
  memory: PublicMemory;
  locale: InterfaceLocale;
  neighbours: MemoryNeighbours;
}>) {
  const t = v3StringsFor(locale).memory;
  const tt = v3TemplatesFor(locale);
  const [titleA, titleB] = splitTitle(memory.title);
  // "When" is never read as a date (owner decision; M3.7): the reference's
  // "MEMORY · 2026" and "FIG. 01 · 2026" keep their words without a year,
  // and the "when" itself is shown as written, in the labels below.
  const kind = t.kind.split(" · ")[0];
  const figure = "FIG. 01";
  const song = memory.music[0] ?? null;
  const blocks = renderDocument(memory.body, 2);
  const paragraphs: ReactNode[] = Array.isArray(blocks)
    ? blocks
    : blocks
      ? [blocks]
      : [];
  return (
    <main id="main" tabIndex={-1}>
      <article lang={memory.locale}>
        <header className="mtop wrap">
          <p className="k pix" data-a="fade" data-d="0" lang={locale}>
            {kind}
          </p>
          <h1 id="pp-h1" data-a="up" data-d="1">
            {titleA}
            {titleB ? " " : null}
            {titleB ? <span className="ser">{titleB}</span> : null}
          </h1>
        </header>
        <div className="mbd wrap">
          <figure
            className="print"
            style={{ margin: 0 }}
            data-a="drop"
            data-d="3"
          >
            <span className="pg hand" aria-hidden="true">
              {memory.title}
            </span>
            <figcaption className="fig pix">{figure}</figcaption>
            {/* eslint-disable-next-line @next/next/no-img-element -- decorative tape */}
            <img
              className="tp"
              src="/v3/tape-b.png"
              alt=""
              aria-hidden="true"
              loading="lazy"
              style={{ left: "50%", top: -30, marginLeft: -60, rotate: "4deg" }}
            />
          </figure>
          <div className="sheet" data-a="place" data-d="5">
            {/* eslint-disable-next-line @next/next/no-img-element -- decorative tape */}
            <img
              className="tp"
              src="/v3/tape-a.png"
              alt=""
              aria-hidden="true"
              loading="lazy"
              style={{ left: -40, top: -24, rotate: "-30deg" }}
            />
            {/* eslint-disable-next-line @next/next/no-img-element -- decorative tape */}
            <img
              className="tp"
              src="/v3/tape-b.png"
              alt=""
              aria-hidden="true"
              loading="lazy"
              style={{ right: -40, top: -22, rotate: "26deg" }}
            />
            {paragraphs.map((paragraph, i) => (
              <div
                key={i}
                className="hand para"
                data-a="write"
                data-d={String(
                  WRITE_DELAYS[Math.min(i, WRITE_DELAYS.length - 1)],
                )}
              >
                {paragraph}
              </div>
            ))}
          </div>
          {song ? (
            <div className="np" data-a="up" data-d="4" lang={locale}>
              <Vinyl
                top={song.artists
                  .map((a) => a.name)
                  .join(", ")
                  .toLowerCase()}
                bottom={song.album?.title ?? ""}
              />
              <span className="tx">
                <span className="pix">{t.np}</span>
                <span className="s ser" lang={memory.locale}>
                  {song.title}
                </span>
                <span className="a">
                  {song.artists.map((a) => a.name).join(", ")}
                </span>
                {song.album ? (
                  <span className="on pix">
                    {song.album.journalSlug ? (
                      <Link
                        href={localizedHref(
                          locale,
                          `/albums/${song.album.journalSlug}`,
                        )}
                      >
                        {tt.memoryOn(song.album.title, null)}
                      </Link>
                    ) : (
                      <>
                        {tt.memoryOn(song.album.title, null)} ·{" "}
                        {tt.noAlbumJournal}
                      </>
                    )}
                  </span>
                ) : null}
                {memory.music.slice(1).map((other) => (
                  <span key={other.number} className="on pix more-song">
                    ♪ {other.title}
                    {other.artists.length > 0
                      ? `, ${other.artists.map((a) => a.name).join(", ")}`
                      : ""}
                  </span>
                ))}
                {song.artists
                  .filter((artist) => artist.address !== null)
                  .slice(0, 1)
                  .map((artist) => (
                    <Kraft
                      key={artist.address}
                      seed={`more-${artist.address}`}
                      link
                      href={localizedHref(locale, `/artists/${artist.address}`)}
                      rotate="-2deg"
                    >
                      {tt.artistInArtists(artist.name)}
                    </Kraft>
                  ))}
              </span>
            </div>
          ) : null}
          <dl data-a="up" data-d="6" lang={locale}>
            <dt className="pix">{t.lMemory}</dt>
            <dd>
              <Kraft seed={`m-${memory.slug}`} lang={memory.locale}>
                {memory.title}
              </Kraft>
            </dd>
            {memory.rememberedWhen ? (
              <>
                <dt className="pix">{t.lWhen}</dt>
                <dd>
                  <Kraft seed={`w-${memory.slug}`} lang={memory.locale}>
                    {memory.rememberedWhen}
                  </Kraft>
                </dd>
              </>
            ) : null}
            {song ? (
              <>
                <dt className="pix">{t.lSong}</dt>
                <dd>
                  <Kraft seed={`s-${memory.slug}`}>{song.title}</Kraft>
                </dd>
              </>
            ) : null}
          </dl>
        </div>
        <nav className="mnav2 wrap" aria-label={t.all} lang={locale}>
          {neighbours.previous ? (
            <Kraft
              seed="prev"
              link
              rotate="-2deg"
              href={localizedHref(locale, `/memories/${neighbours.previous}`)}
            >
              {t.prev}
            </Kraft>
          ) : (
            <span />
          )}
          <Kraft
            seed="all"
            link
            rotate="1deg"
            href={localizedHref(locale, "/memories")}
          >
            {t.all}
          </Kraft>
          {neighbours.next ? (
            <Kraft
              seed="next"
              link
              rotate="-1deg"
              href={localizedHref(locale, `/memories/${neighbours.next}`)}
            >
              {t.next}
            </Kraft>
          ) : (
            <span />
          )}
        </nav>
      </article>
    </main>
  );
}
