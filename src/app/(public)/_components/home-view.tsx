import Link from "next/link";

import type {
  PublicArtistCard,
  PublicHome,
  PublicHomeEntry,
  PublicJournalCard,
  PublicMemoryCard,
} from "@/modules/publication/public";

import { Cover, labelLine } from "@/app/v3/cover";
import { HOME_LAYOUT as layout } from "@/app/v3/home-layout";
import { Attachment, Vinyl } from "@/app/v3/objects";
import { dictionaryFor } from "@/i18n/dictionaries";
import type { InterfaceLocale } from "@/i18n/locales";
import { localizedHref } from "@/i18n/paths";
import { v3Decimal, v3StringsFor } from "@/i18n/v3";
import { v3TemplatesFor } from "@/i18n/v3/templates";

// The public Home (docs/design-system.md, Part I, Pages: Home): the record
// coming out of the top of the page between "re" and "frain"; recently
// written; the newest album journal as a sleeve, front and back, with a shelf
// of others; the memories pinned to a navy board; a memory's first lines on a
// page torn from the notebook; and the voices.
//
// Every list is read through the Publication module's reading entry point, so
// the Home shows only what is served: while public reads are off, or with
// nothing published, it is the page of an empty journal (ADR 0006 A4). The
// Home's own lists keep their limits (A6), and every value shown is one of
// A4 and A6's closed lists, read in the Home's one snapshot: the sleeve is the
// newest album's card (title, credits, year, rating, cover), so its back shows
// no tracklist; the reference's tracklist and fuller board wait for an
// amendment of A6 (ADR 0011, proposed). A memory's "when" is shown as written
// and never read as a date, so the board has no year groups. Memories have no
// photographs yet, so each shows lined paper with its title (Empty states).

export interface HomeExtras {
  /** The newest served memories, for the board. */
  memories: PublicMemoryCard[];
  /** Every public artist, for the voices. */
  artists: PublicArtistCard[];
}

const STAR =
  "M50 2 L61 38 L98 38 L68 60 L79 97 L50 75 L21 97 L32 60 L2 38 L39 38 Z";

const pad = (n: number) => String(n).padStart(2, "0");

export function HomeView({
  home,
  extras,
  locale,
  unavailable = false,
}: Readonly<{
  /** True when the database could not answer: one fixed line, no detail. */
  unavailable?: boolean;
  home: PublicHome;
  extras: HomeExtras;
  locale: InterfaceLocale;
}>) {
  const t = v3StringsFor(locale).home;
  const latestSlug = home.albums[0]?.slug ?? null;
  return (
    <main id="main" tabIndex={-1}>
      <section className="hero" aria-labelledby="pp-h1">
        <h1 id="pp-h1" className="sr">
          refrain
        </h1>
        <div className="row" aria-hidden="true">
          <p className="w" data-a="left" data-d="3">
            re
          </p>
          <span className="vinyl" aria-hidden="true" data-a="rec" data-d="0">
            <span className="sheen" />
            <span className="lbl">
              <span className="t1 hand">refrain</span>
              <span className="t2 pix">{t.side} · 33 RPM</span>
              <svg className="rtxt" viewBox="0 0 200 200" aria-hidden="true">
                <defs>
                  <path id="pp-rt" d="M100 100 m0 86 a86 86 0 1 0 0.1 0" />
                </defs>
                <text>
                  <textPath href="#pp-rt">
                    SOME SONGS TAKE YOU BACK · KEPT BY HAND · SIDE A · 33 RPM
                    ·{" "}
                  </textPath>
                </text>
              </svg>
            </span>
          </span>
          <p className="w r" data-a="right" data-d="3">
            frain
          </p>
        </div>
        <p className="note hand" aria-hidden="true" data-a="fade" data-d="12">
          {t.note}
        </p>
        <div className="sub wrap">
          <p className="kept ser" data-a="up" data-d="7">
            <i>{t.kept}</i>
          </p>
          {latestSlug ? (
            <Link
              className="pill"
              href={localizedHref(locale, `/albums/${latestSlug}`)}
              data-a="up"
              data-d="9"
            >
              {t.readLatest}
            </Link>
          ) : null}
        </div>
      </section>
      {unavailable ? (
        <p className="say wrap home-unavailable" role="status">
          {dictionaryFor(locale).home.unavailable}
        </p>
      ) : null}
      <Recent entries={home.recent} locale={locale} />
      <Albums home={home} locale={locale} />
      <Board memories={extras.memories} locale={locale} />
      <FromTheJournal
        memory={extras.memories.find((m) => m.excerpt) ?? null}
        locale={locale}
      />
      <Voices artists={extras.artists} locale={locale} />
    </main>
  );
}

function entryHref(locale: InterfaceLocale, entry: PublicHomeEntry): string {
  return localizedHref(
    locale,
    entry.kind === "memory"
      ? `/memories/${entry.slug}`
      : `/albums/${entry.slug}`,
  );
}

function Recent({
  entries,
  locale,
}: Readonly<{ entries: PublicHomeEntry[]; locale: InterfaceLocale }>) {
  const t = v3StringsFor(locale).home;
  const words = [t.w1, t.w2, t.w3, t.w4, t.w5];
  const places = layout.recent;
  const items = entries.slice(0, places.length);
  if (items.length === 0) return null;
  return (
    <section
      id="ph-recent"
      className="recent wrap"
      aria-labelledby="pp-rec"
      style={{ maxWidth: 1280 }}
    >
      <svg
        className="star"
        data-a="pop"
        data-d="0"
        viewBox="0 0 100 100"
        aria-hidden="true"
      >
        <path d={STAR} />
      </svg>
      <h2 className="ttl" id="pp-rec">
        <span className="a ser" data-a="up" data-d="0">
          {t.r1}
        </span>
        <span className="b pix" data-a="write" data-d="4">
          {t.r2}
        </span>
        <span className="c" data-a="fade" data-d="10">
          {t.r3}
        </span>
      </h2>
      {items.map((entry, i) => {
        const place = places[i]!;
        const style = { left: place.left, top: place.top, width: place.width };
        return (
          <Link
            key={`${entry.kind}-${entry.slug}`}
            className={`it${i === 4 ? " wide" : ""}`}
            href={entryHref(locale, entry)}
            style={style}
            data-a="place"
            data-d={i % 2 === 0 ? "0" : "2"}
          >
            <span className={`no ser ${place.side}`}>{`[${pad(i + 1)}]`}</span>
            {entry.kind === "album_journal" ? (
              <>
                <Cover
                  artwork={entry.artwork}
                  title={entry.albumTitle}
                  line={labelLine(entry.credits, entry.firstReleaseYear)}
                  sizes="300px"
                />
                <span className="cap">
                  {entry.albumTitle}{" "}
                  {entry.credits.length > 0 ? (
                    <span className="by">
                      {t.by} {entry.credits.join(", ")}
                    </span>
                  ) : null}
                </span>
                <span className="k hand">{t.kAlb}</span>
              </>
            ) : (
              <>
                <span
                  className="pg hand"
                  aria-hidden="true"
                  lang={entry.locale}
                  style={{ aspectRatio: place.aspect }}
                >
                  {entry.title}
                </span>
                <span className="cap" lang={entry.locale}>
                  {entry.title}
                  {entry.firstSong ? (
                    <>
                      <br />
                      {entry.firstSong.title}
                    </>
                  ) : null}
                </span>
                <span className="k hand">{t.kMem}</span>
              </>
            )}
          </Link>
        );
      })}
      {layout.words.map((place, i) => (
        <p
          key={i}
          className="wd"
          aria-hidden="true"
          style={{ left: place.left, top: place.top }}
          data-a="word"
          data-d="5"
        >
          {words[i]}
        </p>
      ))}
    </section>
  );
}

function Albums({
  home,
  locale,
}: Readonly<{
  home: PublicHome;
  locale: InterfaceLocale;
}>) {
  const t = v3StringsFor(locale).home;
  const latest = home.albums[0] ?? null;
  const shelf = home.albums.slice(1, 4);
  if (!latest && shelf.length === 0) return null;
  return (
    <section id="ph-albums" className="albums wrap" aria-labelledby="pp-alb">
      <div className="shead">
        <h2 id="pp-alb" data-a="up" data-d="0">
          {t.albH} <span className="ser">{t.track}</span>
        </h2>
      </div>
      <div className="sleeves">
        {latest ? <Sleeves card={latest} locale={locale} /> : null}
        <div className="shelf">
          {shelf.map((card, i) => (
            <MiniSleeve
              key={card.slug}
              card={card}
              locale={locale}
              d={2 + i * 2}
            />
          ))}
        </div>
        <Link
          className="pill ghost more"
          href={localizedHref(locale, "/albums")}
        >
          {t.allA}
        </Link>
      </div>
    </section>
  );
}

function Sleeves({
  card,
  locale,
}: Readonly<{ card: PublicJournalCard; locale: InterfaceLocale }>) {
  const t = v3StringsFor(locale).home;
  const tt = v3TemplatesFor(locale);
  const artists = card.credits;
  const year = card.firstReleaseYear;
  const href = localizedHref(locale, `/albums/${card.slug}`);
  const rating =
    card.ratingHalfSteps !== null
      ? v3Decimal(locale, card.ratingHalfSteps / 2)
      : null;
  return (
    <>
      <div className="sl front" data-a="sleeve" data-d="0">
        <Vinyl
          top={artists.join(", ").toLowerCase()}
          bottom={card.albumTitle}
        />
        <Link className="card" href={href}>
          <h3 className="ser">{`${card.albumTitle}.`}</h3>
          <Cover
            artwork={card.artwork}
            title={card.albumTitle}
            line={labelLine(artists, year)}
            sizes="400px"
          />
          <span className="foot">
            <span className="ser">{year ?? ""}</span>
            <span className="hand">
              {artists
                .join(" ")
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
        </Link>
      </div>
      {/* The back of the sleeve carries only the card's own fields (A4): the
          title and credits where the reference prints the tracklist, which
          is the album page's, not the Home's. */}
      <div className="sl back" data-a="sleeve" data-d="2" aria-hidden="true">
        <Vinyl top={year ? String(year) : ""} bottom={t.side} />
        <div className="card">
          <span className="mono ser">{card.albumTitle.charAt(0)}</span>
          <div className="top pix">
            <span>{year ?? ""}</span>
            <span>{t.side}</span>
          </div>
          <p className="pix credit">
            <span>{card.albumTitle}</span>
            <span>{artists.join(", ")}</span>
          </p>
          <div className="foot pix">
            {rating ? (
              <span>
                {t.rating}{" "}
                <span
                  className="hand"
                  role="img"
                  aria-label={tt.ratingAria(rating)}
                >
                  {`[${rating}]`}
                </span>
              </span>
            ) : (
              <span />
            )}
            <span>{t.written}</span>
          </div>
        </div>
      </div>
    </>
  );
}

function MiniSleeve({
  card,
  locale,
  d,
}: Readonly<{ card: PublicJournalCard; locale: InterfaceLocale; d: number }>) {
  return (
    <Link
      className="mini"
      href={localizedHref(locale, `/albums/${card.slug}`)}
      data-a="up"
      data-d={String(d)}
    >
      <span className="s">
        <span className="vinyl" aria-hidden="true">
          <span className="sheen" />
          <span className="lbl" />
        </span>
        <Cover
          artwork={card.artwork}
          title={card.albumTitle}
          line={labelLine(card.credits, card.firstReleaseYear)}
          sizes="120px"
        />
      </span>
      <span className="tx">
        {card.albumTitle}
        <br />
        {[card.credits.join(", "), card.firstReleaseYear]
          .filter(Boolean)
          .join(", ")}
      </span>
    </Link>
  );
}

function Board({
  memories,
  locale,
}: Readonly<{ memories: PublicMemoryCard[]; locale: InterfaceLocale }>) {
  const t = v3StringsFor(locale).home;
  const empty = v3StringsFor(locale).empty;
  const places = layout.pols;
  // The Memories archive's order, cut to the board's places. Each kraft label
  // is a memory's "when" exactly as the author wrote it, never read as a date
  // (A6, item 2), so nothing is grouped by year.
  const ordered = memories.slice(0, places.length);
  const yearLabels = ordered
    .filter((card) => card.rememberedWhen)
    .map((card) => ({ label: card.rememberedWhen!, lang: card.locale }));
  return (
    <section
      id={ordered.length > 0 ? "ph-memories" : undefined}
      className="mem"
      aria-labelledby="pp-mem"
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- decorative edge */}
      <img
        className="edge t"
        src="/v3/torn-top.png"
        alt=""
        aria-hidden="true"
        loading="lazy"
      />
      <div className="sheet">
        <div className="wrap">
          <div className="head">
            <h2 id="pp-mem" data-a="up" data-d="0">
              {t.memH}
            </h2>
            <p className="ser" data-a="up" data-d="2">
              {t.memSay}
            </p>
          </div>
          {ordered.length === 0 ? (
            <div className="board0 home" data-a="up" data-d="2">
              <span className="pin" aria-hidden="true" />
              <span className="kr hand">{empty.x1}</span>
              <Link className="lk" href={localizedHref(locale, "/albums")}>
                {empty.x2}
              </Link>
            </div>
          ) : (
            <div className="board" data-io="">
              <svg
                className="path lg"
                viewBox={layout.lg.viewBox}
                preserveAspectRatio="none"
                aria-hidden="true"
              >
                <defs>
                  <mask
                    id="pp-mk"
                    maskUnits="userSpaceOnUse"
                    x="-50"
                    y="-50"
                    width="1300"
                    height="1110"
                  >
                    <path pathLength={1} d={layout.lg.d[0]} />
                  </mask>
                </defs>
                <path d={layout.lg.d[1]} mask="url(#pp-mk)" />
              </svg>
              <svg
                className="path sm"
                viewBox={layout.sm.viewBox}
                preserveAspectRatio="none"
                aria-hidden="true"
              >
                <defs>
                  <mask
                    id="pp-mk2"
                    maskUnits="userSpaceOnUse"
                    x="-50"
                    y="-50"
                    width="450"
                    height="1820"
                  >
                    <path pathLength={1} d={layout.sm.d[0]} />
                  </mask>
                </defs>
                <path d={layout.sm.d[1]} mask="url(#pp-mk2)" />
              </svg>
              {yearLabels.slice(0, layout.years.length).map((year, i) => {
                const place = layout.years[i]!;
                return (
                  <span
                    key={`${year.label}-${i}`}
                    lang={year.lang}
                    className="kr hand yr"
                    data-a="pop"
                    data-d="2"
                    style={{
                      left: place.left,
                      top: place.top,
                      rotate: place.rotate,
                      clipPath: place.clip,
                      ["--mx" as string]: place.mx,
                      ["--my" as string]: place.my,
                    }}
                  >
                    {year.label}
                  </span>
                );
              })}
              {ordered.map((card, i) => {
                const place = places[i]!;
                const song = card.music[0];
                return (
                  <Link
                    key={card.slug}
                    className="pol"
                    href={localizedHref(locale, `/memories/${card.slug}`)}
                    data-a="drop"
                    data-d={String(i % 3)}
                    style={{
                      left: place.left,
                      top: place.top,
                      width: place.width,
                      rotate: place.rotate,
                      ["--mx" as string]: place.mx,
                      ["--my" as string]: place.my,
                      ["--mw" as string]: place.mw,
                    }}
                  >
                    <Attachment
                      kind={place.att === "pin" ? "pin" : "tape"}
                      seed={card.slug}
                    />
                    <span
                      className="pg hand"
                      aria-hidden="true"
                      lang={card.locale}
                      style={{ aspectRatio: place.aspect }}
                    >
                      {card.title}
                    </span>
                    <span className="t hand" lang={card.locale}>
                      {card.title}
                    </span>
                    {song ? (
                      <span className="song pix">♪ {song.title}</span>
                    ) : null}
                  </Link>
                );
              })}
              <Link
                className="kr lnk"
                href={localizedHref(locale, "/memories")}
                data-a="pop"
                data-d="4"
                style={{
                  left: "960px",
                  top: "930px",
                  rotate: "-2deg",
                  clipPath: /clip-path: (polygon\([^)]*\))/.exec(
                    layout.more,
                  )?.[1],
                  ["--mx" as string]: "186px",
                  ["--my" as string]: "1650px",
                }}
              >
                {t.allM}
              </Link>
            </div>
          )}
        </div>
      </div>
      {/* eslint-disable-next-line @next/next/no-img-element -- decorative edge */}
      <img
        className="edge b"
        src="/v3/torn-bottom.png"
        alt=""
        aria-hidden="true"
        loading="lazy"
      />
    </section>
  );
}

function FromTheJournal({
  memory,
  locale,
}: Readonly<{ memory: PublicMemoryCard | null; locale: InterfaceLocale }>) {
  if (!memory?.excerpt) return null;
  const t = v3StringsFor(locale).home;
  const song = memory.music[0];
  const href = localizedHref(locale, `/memories/${memory.slug}`);
  return (
    <section className="jr wrap" aria-labelledby="pp-jr">
      <div className="shead">
        <h2 id="pp-jr" data-a="up" data-d="0">
          {t.j1} <span className="ser">{t.j2}</span>
        </h2>
      </div>
      <div className="board2">
        <figure
          className="print"
          style={{ margin: 0 }}
          data-a="drop"
          data-d="1"
        >
          <span className="pg hand" aria-hidden="true" lang={memory.locale}>
            {memory.title}
          </span>
          <figcaption className="fig pix">{t.fig}</figcaption>
          {/* eslint-disable-next-line @next/next/no-img-element -- decorative tape */}
          <img
            className="tp"
            src="/v3/tape-a.png"
            alt=""
            aria-hidden="true"
            loading="lazy"
            style={{ left: "50%", top: -30, marginLeft: -65, rotate: "-3deg" }}
          />
        </figure>
        <div className="sheet" data-a="place" data-d="3">
          {/* eslint-disable-next-line @next/next/no-img-element -- decorative tape */}
          <img
            className="tp"
            src="/v3/tape-b.png"
            alt=""
            aria-hidden="true"
            loading="lazy"
            style={{ left: -40, top: -26, rotate: "-32deg" }}
          />
          {/* eslint-disable-next-line @next/next/no-img-element -- decorative tape */}
          <img
            className="tp"
            src="/v3/tape-a.png"
            alt=""
            aria-hidden="true"
            loading="lazy"
            style={{ right: -40, top: -22, rotate: "28deg" }}
          />
          <p
            className="words hand"
            data-a="write"
            data-d="9"
            lang={memory.locale}
          >
            {memory.excerpt}
          </p>
        </div>
        <dl data-a="up" data-d="6">
          <dt className="pix">{t.lMemory}</dt>
          <dd>
            <span className="kr hand" lang={memory.locale}>
              {memory.title}
            </span>
          </dd>
          {memory.rememberedWhen ? (
            <>
              <dt className="pix">{t.lWhen}</dt>
              <dd>
                <span className="kr hand" lang={memory.locale}>
                  {memory.rememberedWhen}
                </span>
              </dd>
            </>
          ) : null}
          {song ? (
            <>
              <dt className="pix">{t.lSong}</dt>
              <dd>
                <span className="kr hand">
                  {[song.title, song.artists.join(", ")]
                    .filter(Boolean)
                    .join(", ")}
                </span>
              </dd>
            </>
          ) : null}
        </dl>
        <Link className="pill go" href={href} data-a="up" data-d="8">
          {t.readM}
        </Link>
      </div>
    </section>
  );
}

function Voices({
  artists,
  locale,
}: Readonly<{ artists: PublicArtistCard[]; locale: InterfaceLocale }>) {
  if (artists.length === 0) return null;
  const t = v3StringsFor(locale).home;
  const places = layout.names;
  return (
    <section
      id="ph-artists"
      className="voices wrap"
      aria-labelledby="pp-vo"
      style={{ maxWidth: 1280 }}
    >
      <h2 className="ph" id="pp-vo">
        <span className="a" data-a="up" data-d="0">
          {t.v1}
        </span>
        <span className="b ser" data-a="up" data-d="2">
          {t.v2}
        </span>
        <span className="c" data-a="up" data-d="4">
          {t.v3}
        </span>
      </h2>
      {artists.slice(0, places.length).map((artist, i) => (
        <Link
          key={artist.address}
          className="n"
          href={localizedHref(locale, `/artists/${artist.address}`)}
          style={{ left: places[i]!.left, top: places[i]!.top }}
          data-a="word"
          data-d={String(i % 9)}
        >
          {artist.name}
        </Link>
      ))}
      {layout.asts.map((place, i) => (
        <span
          key={i}
          className="ast"
          aria-hidden="true"
          style={{ left: place.left, top: place.top }}
        >
          *
        </span>
      ))}
      <Link
        className="pill ghost more"
        href={localizedHref(locale, "/artists")}
      >
        {t.allR}
      </Link>
    </section>
  );
}
