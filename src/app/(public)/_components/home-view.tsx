import Image from "next/image";
import Link from "next/link";

import type {
  PublicArtistCard,
  PublicArtwork,
  PublicHome,
  PublicHomeEntry,
  PublicHomeMemory,
  PublicJournalCard,
  PublicMemoryCard,
} from "@/modules/publication/public";

import {
  artistCountLine,
  musicLine,
  songText,
} from "@/app/(archives)/_components/archive-lines";
import { ArrowIcon } from "@/app/(public)/_components/arrow-icon";
import { AuthoredText } from "@/app/(public)/_components/authored-text";
import { NoteIcon } from "@/app/(public)/_components/note-icon";
import { PersonIcon } from "@/app/(public)/_components/person-icon";
import { RecordIcon } from "@/app/(public)/_components/record-icon";
import { Stars } from "@/app/(public)/_components/stars";
import { dictionaryFor } from "@/i18n/dictionaries";
import { formatDate, ratingText } from "@/i18n/format";
import type { InterfaceLocale } from "@/i18n/locales";
import { localizedHref } from "@/i18n/paths";

// The public Home (the approved V4.4 `Home` screen: M3.4, and M3.8b under
// ADR 0006 amendment A6). It renders only what the Publication read model
// returned, which is already limited to what a reader may see: album journals
// and memories whose page answers, and artists whose page answers, each at
// its current address. It has no author control and no private metadata.
//
// Everything here is a server component: the read model's objects never
// reach the client. The only values that do are the `href` strings of the
// links (A6, item 7): what is rendered is in the HTML and in the page's Flight
// data, and a memory's whole writing is in neither.
//
// What the approved screen shows and the Home does not, by the owner's
// decisions, is in docs/design-system.md § Public Home: the language
// artist journals, artist photographs, and the kind of an artist.

// The introduction under the drawing and the character's alternative text
// are in the dictionaries (src/i18n): the introduction is the owner's interim
// line (M3.4), an authored sentence that keeps its English until a Portuguese
// one is approved (ADR 0008 § 4), and it doubles as the description.

function Published({
  at,
  locale,
}: Readonly<{ at: Date; locale: InterfaceLocale }>) {
  return <time dateTime={at.toISOString()}>{formatDate(locale, at)}</time>;
}

const addressOf = (locale: InterfaceLocale, card: PublicJournalCard) =>
  localizedHref(locale, `/albums/${card.slug}`);
const memoryAddressOf = (locale: InterfaceLocale, memory: { slug: string }) =>
  localizedHref(locale, `/memories/${memory.slug}`);
const creditOf = (card: PublicJournalCard) => card.credits.join(", ");

/** "Memory · Holocene — Bon Iver", or "Memory" for a memory with no music. */
const memoryKindOf = (locale: InterfaceLocale, memory: PublicHomeMemory) => {
  const t = dictionaryFor(locale);
  return memory.firstSong
    ? t.home.memoryWith(songText(memory.firstSong))
    : t.home.memory;
};

/**
 * The drawing and the introduction: the part of the Home that is the same for
 * every reader and every state of the journal.
 * The drawing is the original character, as its production copy (a WebP made
 * from the original with its transparency kept bit for bit,
 * docs/design-system.md § Assets), served as that file: no further copy.
 */
export function HomeOpening({ locale }: Readonly<{ locale: InterfaceLocale }>) {
  const t = dictionaryFor(locale);
  return (
    <div className="ph-opening">
      <h1 id="ph-title" className="pj-visually-hidden">
        refrain
      </h1>
      <Image
        className="ph-character"
        src="/artwork/refrain-home-character.webp"
        width={1536}
        height={1024}
        unoptimized
        loading="eager"
        fetchPriority="high"
        alt={t.home.characterAlt}
      />
      <AuthoredText
        as="p"
        className="ph-intro"
        copy={t.home.introduction}
        locale={locale}
      />
    </div>
  );
}

/**
 * "Most recent:" and the newest entry, an album journal or a memory, or, when
 * nothing is published (or public reads are off, which answers the same),
 * one quiet line.
 */
function MostRecent({
  home,
  locale,
}: Readonly<{ home: PublicHome; locale: InterfaceLocale }>) {
  const t = dictionaryFor(locale);
  const newest = home.recent[0];
  if (!newest) {
    return <p className="ph-since ph-since-alone">{t.home.nothingPublished}</p>;
  }
  const isMemory = newest.kind === "memory";
  return (
    <p className="ph-since">
      <span className="ph-quiet">{t.home.mostRecent}</span>{" "}
      {isMemory ? (
        <Link
          className="ph-since-link"
          href={memoryAddressOf(locale, newest)}
          lang={newest.locale}
        >
          {newest.title}
        </Link>
      ) : (
        <Link className="ph-since-link" href={addressOf(locale, newest)}>
          {newest.albumTitle}
        </Link>
      )}{" "}
      <span className="ph-quiet">
        · {isMemory ? t.home.memory : t.home.albumJournal} ·{" "}
        <Published at={newest.publishedAt} locale={locale} />
      </span>
    </p>
  );
}

/**
 * A section's title in the margin, and under it, when the section links to
 * its archive, the "All …" link with the drawn arrow (shown only when the
 * section has something in it: an empty section is not rendered at all).
 */
function SectionMargin({
  id,
  title,
  all,
}: Readonly<{
  id: string;
  title: string;
  all?: { href: string; label: string };
}>) {
  return (
    <div className="ph-margin">
      <h2 id={id}>{title}</h2>
      {all ? (
        <p className="ph-all">
          <Link className="ph-all-link" href={all.href}>
            {all.label}
            <ArrowIcon className="ph-all-icon" size={16} />
          </Link>
        </p>
      ) : null}
    </div>
  );
}

/**
 * An artwork frame: the fallback, and the chosen cover over it once loaded.
 * Also used by the artist page's album rows (M3.5).
 */
export function Artwork({
  artwork,
  className,
  sizes,
  fallback,
}: Readonly<{
  artwork: PublicArtwork | null;
  className: string;
  sizes: string;
  fallback: React.ReactNode;
}>) {
  return (
    // Decorative: the link it sits in is named by the album's title.
    <span className={className} aria-hidden="true">
      <span className="ph-art-fallback">{fallback}</span>
      {artwork ? (
        // eslint-disable-next-line @next/next/no-img-element -- a remote cover, deliberately not routed through an image optimizer (docs/evidence/m3-2.md)
        <img
          className="ph-art-image"
          src={artwork.src}
          srcSet={artwork.srcSet}
          sizes={sizes}
          width={500}
          height={500}
          alt=""
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
        />
      ) : null}
    </span>
  );
}

/** A memory's row in "Recently written": the note mark in place of a frame. */
function MemoryRow({
  memory,
  locale,
}: Readonly<{ memory: PublicHomeMemory; locale: InterfaceLocale }>) {
  return (
    <Link className="ph-row" href={memoryAddressOf(locale, memory)}>
      <span className="ph-row-text">
        <span className="ph-row-title" lang={memory.locale}>
          {memory.title}
        </span>{" "}
        <span className="ph-row-kind">{memoryKindOf(locale, memory)}</span>
      </span>{" "}
      <span className="ph-row-date">
        <Published at={memory.publishedAt} locale={locale} />
      </span>{" "}
      <span className="ph-row-mark" aria-hidden="true">
        <NoteIcon className="ph-row-mark-icon" size={22} />
      </span>
    </Link>
  );
}

function RecentlyWritten({
  entries,
  locale,
}: Readonly<{
  entries: readonly PublicHomeEntry[];
  locale: InterfaceLocale;
}>) {
  const t = dictionaryFor(locale);
  return (
    <section className="ph-section ph-recent" aria-labelledby="ph-recent">
      <SectionMargin id="ph-recent" title={t.home.recentlyWritten} />
      <ol className="ph-rows" role="list">
        {entries.map((card) => (
          <li key={`${card.kind}:${card.slug}`} className="ph-row-item">
            {card.kind === "memory" ? (
              <MemoryRow memory={card} locale={locale} />
            ) : (
              <Link className="ph-row" href={addressOf(locale, card)}>
                <span className="ph-row-text">
                  <span className="ph-row-title">{card.albumTitle}</span>{" "}
                  <span className="ph-row-kind">
                    {creditOf(card)
                      ? t.home.albumJournalBy(creditOf(card))
                      : t.home.albumJournal}
                  </span>
                </span>{" "}
                <span className="ph-row-date">
                  <Published at={card.publishedAt} locale={locale} />
                </span>{" "}
                <Artwork
                  artwork={card.artwork}
                  className="ph-art ph-thumb"
                  sizes="48px"
                  fallback={<RecordIcon className="ph-art-icon" size={18} />}
                />
              </Link>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}

function Albums({
  cards,
  locale,
}: Readonly<{ cards: readonly PublicJournalCard[]; locale: InterfaceLocale }>) {
  const t = dictionaryFor(locale);
  return (
    <section
      className="ph-section ph-albums-section"
      aria-labelledby="ph-albums"
    >
      <SectionMargin
        id="ph-albums"
        title={t.home.albums}
        all={{
          href: localizedHref(locale, "/albums"),
          label: t.home.allAlbumJournals,
        }}
      />
      <ul className="ph-albums" role="list">
        {cards.map((card) => {
          const facts = [
            creditOf(card),
            card.firstReleaseYear ? String(card.firstReleaseYear) : "",
          ].filter(Boolean);
          const rating =
            card.ratingHalfSteps !== null
              ? ratingText(locale, card.ratingHalfSteps)
              : null;
          return (
            <li key={card.slug}>
              <Link className="ph-album" href={addressOf(locale, card)}>
                <Artwork
                  artwork={card.artwork}
                  className="ph-art ph-cover"
                  sizes="(max-width: 720px) 50vw, 290px"
                  fallback={
                    <>
                      <RecordIcon className="ph-art-icon" size={26} />
                      <span className="ph-art-words">{t.home.noArtwork}</span>
                    </>
                  }
                />
                <span className="ph-album-text">
                  <span className="ph-album-title">{card.albumTitle}</span>{" "}
                  {facts.length > 0 ? (
                    <span className="ph-album-facts">{facts.join(" · ")}</span>
                  ) : null}{" "}
                  {rating !== null ? (
                    <span className="ph-album-rating">
                      <Stars
                        halfSteps={card.ratingHalfSteps!}
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
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/**
 * Artists: three to a row on a wide screen, each the 4:5 frame with the person
 * mark (never a photograph: those stay on the artist's page, with their
 * credit), the name, and the Artists archive's count.
 */
function Artists({
  artists,
  locale,
}: Readonly<{
  artists: readonly PublicArtistCard[];
  locale: InterfaceLocale;
}>) {
  const t = dictionaryFor(locale);
  return (
    <section
      className="ph-section ph-artists-section"
      aria-labelledby="ph-artists"
    >
      <SectionMargin
        id="ph-artists"
        title={t.home.artists}
        all={{
          href: localizedHref(locale, "/artists"),
          label: t.home.allArtists,
        }}
      />
      <ul className="ph-artists" role="list">
        {artists.map((artist) => (
          <li key={artist.address}>
            <Link
              className="ph-artist"
              href={localizedHref(locale, `/artists/${artist.address}`)}
            >
              <span className="ph-portrait" aria-hidden="true">
                <PersonIcon className="ph-portrait-icon" size={24} />
              </span>
              <span className="ph-artist-text">
                <span className="ph-artist-name">{artist.name}</span>{" "}
                <span className="ph-artist-meta">
                  {artistCountLine(locale, artist)}
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Memories: the Memories archive's first three, as its editorial list shows
 * them (its "when", the title as the only link, the excerpt already cut on
 * the server, the music), without the publication date.
 */
function Memories({
  memories,
  locale,
}: Readonly<{
  memories: readonly PublicMemoryCard[];
  locale: InterfaceLocale;
}>) {
  const t = dictionaryFor(locale);
  return (
    <section
      className="ph-section ph-memories-section"
      aria-labelledby="ph-memories"
    >
      <SectionMargin
        id="ph-memories"
        title={t.home.memories}
        all={{
          href: localizedHref(locale, "/memories"),
          label: t.home.allMemories,
        }}
      />
      <ol className="px-memories ph-memories" role="list">
        {memories.map((memory) => (
          <li key={memory.slug} className="px-memory">
            <article aria-labelledby={`ph-memory-${memory.slug}`}>
              {memory.rememberedWhen ? (
                <p className="px-when" lang={memory.locale}>
                  {memory.rememberedWhen}
                </p>
              ) : null}
              <h3 className="px-memory-title" id={`ph-memory-${memory.slug}`}>
                <Link
                  className="px-memory-link"
                  href={memoryAddressOf(locale, memory)}
                  lang={memory.locale}
                >
                  {memory.title}
                </Link>
              </h3>
              {memory.excerpt ? (
                <p className="px-excerpt" lang={memory.locale}>
                  {memory.excerpt}
                </p>
              ) : null}
              {memory.music.length > 0 ? (
                <p className="px-music">
                  <NoteIcon className="px-music-icon" size={16} />
                  <span>
                    <span className="pj-visually-hidden">{t.lists.music}</span>
                    {musicLine(locale, memory.music)}
                  </span>
                </p>
              ) : null}
            </article>
          </li>
        ))}
      </ol>
    </section>
  );
}

/**
 * Everything the Home reads: the line under the introduction, then the
 * notebook sections in the approved order, each only when it has something
 * in it (none when nothing is published). It is rendered on the server with
 * the rest of the page, so it is in the HTML without JavaScript.
 */
export function HomeListings({
  home,
  locale,
}: Readonly<{ home: PublicHome; locale: InterfaceLocale }>) {
  return (
    <div className="ph-lists">
      <MostRecent home={home} locale={locale} />
      {home.recent.length > 0 ? (
        <RecentlyWritten entries={home.recent} locale={locale} />
      ) : null}
      {home.albums.length > 0 ? (
        <Albums cards={home.albums} locale={locale} />
      ) : null}
      {home.artists.length > 0 ? (
        <Artists artists={home.artists} locale={locale} />
      ) : null}
      {home.memories.length > 0 ? (
        <Memories memories={home.memories} locale={locale} />
      ) : null}
    </div>
  );
}

/**
 * When public reads are on but the database could not answer: one fixed line
 * in the place of the lists, so the page still reads as a page. It says
 * nothing about why, and nothing about what exists.
 */
export function HomeUnavailable({
  locale,
}: Readonly<{ locale: InterfaceLocale }>) {
  return (
    <div className="ph-lists">
      <p className="ph-since ph-since-alone">
        {dictionaryFor(locale).home.unavailable}
      </p>
    </div>
  );
}
