import Link from "next/link";

import type { PublicAlbumCard } from "@/modules/publication/public";

import { Cover, labelLine } from "@/app/v3/cover";
import { V3_CONTENT_ID, V3Frame } from "@/app/v3/frame";
import { seeded, Vinyl } from "@/app/v3/objects";
import { ORBIT_GROOVES } from "@/app/v3/rings";
import { artistSortKey } from "@/app/v3/sort";
import { dictionaryFor } from "@/i18n/dictionaries";
import { formatDate } from "@/i18n/format";
import type { InterfaceLocale } from "@/i18n/locales";
import { localizedHref } from "@/i18n/paths";
import { v3Decimal, v3StringsFor } from "@/i18n/v3";
import { v3TemplatesFor } from "@/i18n/v3/templates";

import { AlbumList, type AlbumListRow, type AlbumSort } from "./album-list";

// The public Albums archive (docs/design-system.md, Part I, Pages: Albums):
// the album journals as covers turning around a record, the first ones in the
// middle and each new one on the outside, like the rings of a tree; then the
// whole list, which the reader can sort by the order written, the year, the
// artist, or the rating. Only served journals appear (each album once, as the
// public archive reads it); a catalog album with no public journal never does.
//
// The orbit is decoration: its covers are aria-hidden and out of the tab
// order, and the list below is the accessible way in.

/** The rings, from the reference: covers, radius, start angle, period, size. */
const RINGS = [
  {
    count: 8,
    radius: 19,
    start: 0,
    period: 700,
    direction: "normal",
    size: 10.4,
  },
  {
    count: 12,
    radius: 31,
    start: 15,
    period: 1000,
    direction: "reverse",
    size: 8.8,
  },
  {
    count: 16,
    radius: 43,
    start: 6,
    period: 1400,
    direction: "normal",
    size: 7.4,
  },
  // Past the reference's 36 places (8, 12, 16), a further ring by the same
  // rule, four covers more (ADR 0011, D20, proposed). The reference's radius
  // step (12%) would set it outside the orbit's square, so it closes in.
  {
    count: 20,
    radius: 52,
    start: 4,
    period: 1800,
    direction: "reverse",
    size: 6.2,
  },
] as const;

/** The archive's albums in writing order (first publication, oldest first). */
export function inWritingOrder(
  albums: readonly PublicAlbumCard[],
): PublicAlbumCard[] {
  return [...albums].sort(
    (a, b) => a.publishedAt.getTime() - b.publishedAt.getTime(),
  );
}

function Orbit({
  albums,
  locale,
}: Readonly<{ albums: readonly PublicAlbumCard[]; locale: InterfaceLocale }>) {
  const t = v3StringsFor(locale).albums;
  const starts = RINGS.map((_, r) =>
    RINGS.slice(0, r).reduce((sum, ring) => sum + ring.count, 0),
  );
  const layers = RINGS.map((ring, r) => {
    const index = starts[r]!;
    const items = albums.slice(index, index + ring.count).map((album, i) => {
      const n = index + i + 1;
      const angle = ((ring.start + (360 / ring.count) * i) * Math.PI) / 180;
      const left = 50 + ring.radius * Math.sin(angle);
      const top = 50 - ring.radius * Math.cos(angle);
      const random = seeded(album.slug);
      return {
        album,
        n,
        left,
        top,
        rotate: (random() * 10 - 5).toFixed(1),
        gd: 700 + 45 * (n - 1),
      };
    });
    return { ring, items };
  }).filter((layer) => layer.items.length > 0);
  return (
    <div className="orb2" data-io="">
      <svg className="grooves" viewBox="0 0 1000 1000" aria-hidden="true">
        {ORBIT_GROOVES.map((d) => (
          <path key={d.slice(0, 24)} d={d} />
        ))}
      </svg>
      {layers.map(({ ring, items }) => (
        <div
          key={ring.radius}
          className="layer"
          style={{
            ["--d" as string]: `${ring.period}s`,
            ["--dir" as string]: ring.direction,
            ["--s" as string]: `${ring.size}%`,
          }}
        >
          {items.map(({ album, n, left, top, rotate, gd }) => (
            <Link
              key={album.slug}
              className="ri"
              href={localizedHref(locale, `/albums/${album.slug}`)}
              tabIndex={-1}
              aria-hidden="true"
              style={{ left: `${left.toFixed(2)}%`, top: `${top.toFixed(2)}%` }}
            >
              <span
                className="ric"
                style={{
                  rotate: `${rotate}deg`,
                  ["--gd" as string]: `${gd}ms`,
                }}
              >
                <Cover
                  artwork={album.artwork}
                  title={album.albumTitle}
                  line={labelLine(album.credits, album.firstReleaseYear)}
                  sizes="120px"
                />
              </span>
              <span className="cap">
                {`${n}. ${album.albumTitle}`}
                <br />
                {album.credits.join(", ")}
              </span>
            </Link>
          ))}
        </div>
      ))}
      <Vinyl top="refrain" bottom={t.side} />
      {albums.length > 0 ? (
        <>
          <span
            className="lbl2 hand"
            aria-hidden="true"
            style={{ left: "50%", top: "39.8%" }}
          >
            {t.first}
          </span>
          {albums.length > 1 ? (
            <span
              className="lbl2 hand"
              aria-hidden="true"
              style={{
                left: "50%",
                top: `${50 + (RINGS[layers.length - 1]?.radius ?? 43) + 8}%`,
              }}
            >
              {t.latest}
            </span>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

export function AlbumsArchive({
  albums,
  sort,
  locale,
}: Readonly<{
  albums: PublicAlbumCard[] | null;
  sort: AlbumSort;
  locale: InterfaceLocale;
}>) {
  const t = v3StringsFor(locale).albums;
  const tt = v3TemplatesFor(locale);
  const lists = dictionaryFor(locale).archives;
  const ordered = albums ? inWritingOrder(albums) : [];
  const rows: AlbumListRow[] = ordered.map((album, i) => ({
    n: i + 1,
    href: localizedHref(locale, `/albums/${album.slug}`),
    title: album.albumTitle,
    artist: album.credits.join(", "),
    year: album.firstReleaseYear,
    key: artistSortKey(album.credits[0] ?? album.albumTitle),
    rating: album.ratingHalfSteps !== null ? album.ratingHalfSteps / 2 : null,
    others: album.otherJournals.map((other) => ({
      href: localizedHref(locale, `/albums/${other.slug}`),
      label: `${lists.anotherJournal} ${formatDate(locale, other.publishedAt)}`,
      about: lists.aboutAlbum(album.albumTitle),
    })),
    ratingText:
      album.ratingHalfSteps !== null
        ? `[${v3Decimal(locale, album.ratingHalfSteps / 2)}]`
        : null,
  }));
  return (
    <V3Frame locale={locale} path="/albums" page="albums" current="albums">
      <main id={V3_CONTENT_ID} tabIndex={-1}>
        <section className="ptop wrap" aria-labelledby="pp-h1">
          <div className="shead">
            <h1 id="pp-h1" data-a="up" data-d="0">
              {t.h1}{" "}
              <span className="ser">{tt.albumsCount(ordered.length)}</span>
            </h1>
          </div>
          <p className="say" data-a="up" data-d="2">
            {t.say}
          </p>
          <Orbit albums={ordered} locale={locale} />
          {albums === null ? (
            <p className="say" role="status">
              {locale === "pt-BR"
                ? "Não foi possível ler os diários agora. Tente de novo daqui a pouco."
                : "The journals could not be read just now. Try again in a moment."}
            </p>
          ) : (
            <AlbumList
              rows={rows}
              sort={sort}
              base={localizedHref(locale, "/albums")}
              strings={{
                listS: String(ordered.length),
                sortBy: t.sortBy,
                jump: t.jump,
                h1: t.h1,
                titles: {
                  written: t.lt_written,
                  year: t.lt_year,
                  artist: t.lt_artist,
                  rating: t.lt_rating,
                },
                sorts: {
                  written: t.s_written,
                  year: t.s_year,
                  artist: t.s_artist,
                  rating: t.s_rating,
                },
              }}
            />
          )}
        </section>
      </main>
    </V3Frame>
  );
}
