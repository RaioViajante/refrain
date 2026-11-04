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
import { NoteIcon } from "@/app/(public)/_components/note-icon";
import { PersonIcon } from "@/app/(public)/_components/person-icon";
import { RecordIcon } from "@/app/(public)/_components/record-icon";
import { ratingText, Stars } from "@/app/(public)/_components/stars";

// The public Home (the approved V4.4 `Home` screen: M3.4, and M3.8b under
// ADR 0006 amendment A6). It renders only what the Publication read model
// returned, which is already limited to what a reader may see: album journals
// and memories whose page answers, and artists whose page answers, each at
// its current address. It has no author control and no private metadata.
//
// Everything here is a server component: the read model's objects never
// reach the client. The only values that do are the `href` strings of the
// links (A6, item 7), so a memory's excerpt is in the HTML once and its whole
// writing is never anywhere.
//
// What the approved screen shows and the Home does not, by the owner's
// decisions, is in docs/design-system.md § Public Home: the language
// selector, artist journals, artist photographs, and the kind of an artist.

/**
 * The introduction under the drawing. The approved screen leaves this to the
 * author ("[Your introduction, in your own words.]"); until the author writes
 * it, this is a neutral line, not in the first person and with nothing
 * biographical (the owner's decision, M3.4). It doubles as the description.
 */
export const HOME_INTRODUCTION =
  "A personal music journal about albums, songs, and the memories attached to them.";

/** The approved alternative text of the character (docs/design-system.md). */
export const CHARACTER_ALT =
  "Ink drawing of a person with curly hair and headphones, sitting cross-legged on the floor and writing in a notebook while looking up, next to a stack of records, a mug, a cassette and a few crumpled pages.";

const date = new Intl.DateTimeFormat("en", {
  dateStyle: "medium",
  timeZone: "UTC",
});

function Published({ at }: Readonly<{ at: Date }>) {
  return <time dateTime={at.toISOString()}>{date.format(at)}</time>;
}

const addressOf = (card: PublicJournalCard) => `/albums/${card.slug}`;
const memoryAddressOf = (memory: { slug: string }) =>
  `/memories/${memory.slug}`;
const creditOf = (card: PublicJournalCard) => card.credits.join(", ");

/** "Memory · Holocene — Bon Iver", or "Memory" for a memory with no music. */
const memoryKindOf = (memory: PublicHomeMemory) =>
  memory.firstSong ? `Memory · ${songText(memory.firstSong)}` : "Memory";

/**
 * The drawing and the introduction: the part of the Home that is the same for
 * every reader and every state of the journal.
 * The drawing is the original character, as its production copy (a WebP made
 * from the original with its transparency kept bit for bit,
 * docs/design-system.md § Assets), served as that file: no further copy.
 */
export function HomeOpening() {
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
        alt={CHARACTER_ALT}
      />
      <p className="ph-intro">{HOME_INTRODUCTION}</p>
    </div>
  );
}

/**
 * "Most recent:" and the newest entry, an album journal or a memory, or, when
 * nothing is published (or public reads are off, which answers the same),
 * one quiet line.
 */
function MostRecent({ home }: Readonly<{ home: PublicHome }>) {
  const newest = home.recent[0];
  if (!newest) {
    return <p className="ph-since ph-since-alone">Nothing published yet.</p>;
  }
  const isMemory = newest.kind === "memory";
  return (
    <p className="ph-since">
      <span className="ph-quiet">Most recent:</span>{" "}
      {isMemory ? (
        <Link
          className="ph-since-link"
          href={memoryAddressOf(newest)}
          lang={newest.locale}
        >
          {newest.title}
        </Link>
      ) : (
        <Link className="ph-since-link" href={addressOf(newest)}>
          {newest.albumTitle}
        </Link>
      )}{" "}
      <span className="ph-quiet">
        · {isMemory ? "Memory" : "Album journal"} ·{" "}
        <Published at={newest.publishedAt} />
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
function MemoryRow({ memory }: Readonly<{ memory: PublicHomeMemory }>) {
  return (
    <Link className="ph-row" href={memoryAddressOf(memory)}>
      <span className="ph-row-text">
        <span className="ph-row-title" lang={memory.locale}>
          {memory.title}
        </span>{" "}
        <span className="ph-row-kind">{memoryKindOf(memory)}</span>
      </span>{" "}
      <span className="ph-row-date">
        <Published at={memory.publishedAt} />
      </span>{" "}
      <span className="ph-row-mark" aria-hidden="true">
        <NoteIcon className="ph-row-mark-icon" size={22} />
      </span>
    </Link>
  );
}

function RecentlyWritten({
  entries,
}: Readonly<{ entries: readonly PublicHomeEntry[] }>) {
  return (
    <section className="ph-section ph-recent" aria-labelledby="ph-recent">
      <SectionMargin id="ph-recent" title="Recently written" />
      <ol className="ph-rows" role="list">
        {entries.map((card) => (
          <li key={`${card.kind}:${card.slug}`} className="ph-row-item">
            {card.kind === "memory" ? (
              <MemoryRow memory={card} />
            ) : (
              <Link className="ph-row" href={addressOf(card)}>
                <span className="ph-row-text">
                  <span className="ph-row-title">{card.albumTitle}</span>{" "}
                  <span className="ph-row-kind">
                    {creditOf(card)
                      ? `Album journal · ${creditOf(card)}`
                      : "Album journal"}
                  </span>
                </span>{" "}
                <span className="ph-row-date">
                  <Published at={card.publishedAt} />
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

function Albums({ cards }: Readonly<{ cards: readonly PublicJournalCard[] }>) {
  return (
    <section
      className="ph-section ph-albums-section"
      aria-labelledby="ph-albums"
    >
      <SectionMargin
        id="ph-albums"
        title="Albums"
        all={{ href: "/albums", label: "All album journals" }}
      />
      <ul className="ph-albums" role="list">
        {cards.map((card) => {
          const facts = [
            creditOf(card),
            card.firstReleaseYear ? String(card.firstReleaseYear) : "",
          ].filter(Boolean);
          const rating =
            card.ratingHalfSteps !== null
              ? ratingText(card.ratingHalfSteps)
              : null;
          return (
            <li key={card.slug}>
              <Link className="ph-album" href={addressOf(card)}>
                <Artwork
                  artwork={card.artwork}
                  className="ph-art ph-cover"
                  sizes="(max-width: 720px) 50vw, 290px"
                  fallback={
                    <>
                      <RecordIcon className="ph-art-icon" size={26} />
                      <span className="ph-art-words">no artwork yet</span>
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
}: Readonly<{ artists: readonly PublicArtistCard[] }>) {
  return (
    <section
      className="ph-section ph-artists-section"
      aria-labelledby="ph-artists"
    >
      <SectionMargin
        id="ph-artists"
        title="Artists"
        all={{ href: "/artists", label: "All artists" }}
      />
      <ul className="ph-artists" role="list">
        {artists.map((artist) => (
          <li key={artist.address}>
            <Link className="ph-artist" href={`/artists/${artist.address}`}>
              <span className="ph-portrait" aria-hidden="true">
                <PersonIcon className="ph-portrait-icon" size={24} />
              </span>
              <span className="ph-artist-text">
                <span className="ph-artist-name">{artist.name}</span>{" "}
                <span className="ph-artist-meta">
                  {artistCountLine(artist)}
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
}: Readonly<{ memories: readonly PublicMemoryCard[] }>) {
  return (
    <section
      className="ph-section ph-memories-section"
      aria-labelledby="ph-memories"
    >
      <SectionMargin
        id="ph-memories"
        title="Memories"
        all={{ href: "/memories", label: "All memories" }}
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
                  href={memoryAddressOf(memory)}
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
                    <span className="pj-visually-hidden">Music: </span>
                    {musicLine(memory.music)}
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
export function HomeListings({ home }: Readonly<{ home: PublicHome }>) {
  return (
    <div className="ph-lists">
      <MostRecent home={home} />
      {home.recent.length > 0 ? (
        <RecentlyWritten entries={home.recent} />
      ) : null}
      {home.albums.length > 0 ? <Albums cards={home.albums} /> : null}
      {home.artists.length > 0 ? <Artists artists={home.artists} /> : null}
      {home.memories.length > 0 ? <Memories memories={home.memories} /> : null}
    </div>
  );
}

/**
 * When public reads are on but the database could not answer: one fixed line
 * in the place of the lists, so the page still reads as a page. It says
 * nothing about why, and nothing about what exists.
 */
export function HomeUnavailable() {
  return (
    <div className="ph-lists">
      <p className="ph-since ph-since-alone">
        The latest writing could not be loaded just now.
      </p>
    </div>
  );
}
