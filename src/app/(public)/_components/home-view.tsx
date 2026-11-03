import Image from "next/image";
import Link from "next/link";

import type {
  PublicArtwork,
  PublicHome,
  PublicJournalCard,
} from "@/modules/publication/public";

import { RecordIcon } from "@/app/(public)/_components/record-icon";
import { ratingText, Stars } from "@/app/(public)/_components/stars";

// The public Home (the approved V4.4 `Home` screen, M3.4). It renders only
// what the Publication read model returned, which is already limited to what
// a reader may see: album journals whose page answers, at their current
// address. It has no author control and no private metadata.
//
// The approved screen also shows an Artists and a Memories section, an "All
// …" link under each heading, and the language selector. Those pages do not
// exist, so the Home shows less, never a link that leads nowhere
// (docs/design-system.md § Public Home).

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
const creditOf = (card: PublicJournalCard) => card.credits.join(", ");

/**
 * The drawing and the introduction: the part of the Home that is the same for
 * every reader and every state of the journal, and so its prerendered shell.
 * The drawing is the original character, as its production copy (a WebP made
 * from the original with its transparency kept bit for bit,
 * docs/design-system.md § Assets), served as that file: no further copy.
 */
export function HomeOpening() {
  return (
    <section className="ph-opening" aria-labelledby="ph-title">
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
    </section>
  );
}

/**
 * "Most recent:" and the newest journal, or, when nothing is published (or
 * public reads are off, which answers the same), one quiet line.
 */
function MostRecent({ home }: Readonly<{ home: PublicHome }>) {
  const newest = home.recent[0];
  if (!newest) {
    return <p className="ph-since">Nothing published yet.</p>;
  }
  return (
    <p className="ph-since">
      <span className="ph-quiet">Most recent:</span>{" "}
      <Link className="ph-since-link" href={addressOf(newest)}>
        {newest.albumTitle}
      </Link>{" "}
      <span className="ph-quiet">
        · Album journal · <Published at={newest.publishedAt} />
      </span>
    </p>
  );
}

/** An artwork frame: the fallback, and the chosen cover over it once loaded. */
function Artwork({
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

function RecentlyWritten({
  cards,
}: Readonly<{ cards: readonly PublicJournalCard[] }>) {
  return (
    <section className="ph-section ph-recent" aria-labelledby="ph-recent">
      <div className="ph-margin">
        <h2 id="ph-recent">Recently written</h2>
      </div>
      <ol className="ph-rows" role="list">
        {cards.map((card) => (
          <li key={card.slug} className="ph-row-item">
            <Link className="ph-row" href={addressOf(card)}>
              <span className="ph-row-date">
                <Published at={card.publishedAt} />
              </span>{" "}
              <span className="ph-row-text">
                <span className="ph-row-title">{card.albumTitle}</span>{" "}
                <span className="ph-row-kind">
                  {creditOf(card)
                    ? `Album journal · ${creditOf(card)}`
                    : "Album journal"}
                </span>
              </span>
              <Artwork
                artwork={card.artwork}
                className="ph-art ph-thumb"
                sizes="48px"
                fallback={<RecordIcon className="ph-art-icon" size={18} />}
              />
            </Link>
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
      <div className="ph-margin">
        <h2 id="ph-albums">Albums</h2>
      </div>
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
 * Everything the Home reads, as one streamed part: the line under the
 * introduction, then the notebook sections (none when nothing is published).
 * One part, appended below the shell, so nothing already on the screen is
 * pushed when it arrives; the footer waits for it (public.css, `.ph-lists`).
 */
export function HomeListings({ home }: Readonly<{ home: PublicHome }>) {
  return (
    <div className="ph-lists">
      <MostRecent home={home} />
      {home.recent.length > 0 ? <RecentlyWritten cards={home.recent} /> : null}
      {home.albums.length > 0 ? <Albums cards={home.albums} /> : null}
    </div>
  );
}
