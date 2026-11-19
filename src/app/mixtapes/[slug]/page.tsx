import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { CSSProperties } from "react";

import { LineLink, PlayIcon } from "@/components/links";
import { Sparkle, type SparkleKind, Trees } from "@/components/marks";
import { Photo } from "@/components/photo";
import { SiteFooter } from "@/components/site/site-footer";
import { SiteHeader } from "@/components/site/site-header";
import { paragraphs } from "@/content/site-texts";
import { cx } from "@/lib/cx";
import type {
  ArtistCount,
  MixtapeSummary,
  PublicTrack,
} from "@/server/public-queries";
import { loadMixtapePage } from "@/server/site";

import { FullTape, type FullTapeRow } from "./full-tape";
import styles from "./mixtape.module.css";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const page = await loadMixtapePage((await params).slug);
  if (!page) return {};
  return {
    title: page.mixtape.title,
    description: page.mixtape.description || undefined,
  };
}

/** Side A holds tracks 1–10, side B 11–20, and the rest is "a fita inteira". */
const SIDE_LENGTH = 10;
const FULL_TAPE_FROM = SIDE_LENGTH * 2 + 1;
/**
 * "os que sempre voltam": artists credited on at least three tracks, or on at
 * least two when fewer than MIN_CLOUD artists reach three (core uses three,
 * somewhere, nowhere uses two, in the reference).
 */
const MIN_CLOUD = 6;
const THRESHOLD_WORDS = { 2: "duas", 3: "três" } as const;
/**
 * Beyond this many characters a title no longer fits one line of the
 * opening at 136 px (Inter, measured), so it is set on two lines.
 */
const ONE_LINE_TITLE = 22;

/** Each note's star, in turn (kinds and phases from the reference). */
const NOTE_MARKS: { kind: SparkleKind; delay: string }[] = [
  { kind: 3, delay: "-2.74s" },
  { kind: 4, delay: "-4.11s" },
  { kind: 2, delay: "-5.48s" },
  { kind: 1, delay: "-2.22s" },
];

function pad(n: number, width: number): string {
  return String(n).padStart(width, "0");
}

/**
 * The opening title's lines. A title with ", " breaks after the comma
 * ("somewhere, / nowhere"); a title too long for one line breaks at the
 * space nearest its middle. Either way the second line follows the
 * two-line title rule (refrain-design).
 */
function titleLines(title: string): string[] {
  const comma = title.indexOf(", ");
  if (comma > 0) return [title.slice(0, comma + 1), title.slice(comma + 2)];
  if (title.length <= ONE_LINE_TITLE) return [title];
  const middle = title.length / 2;
  let best = -1;
  for (let i = title.indexOf(" "); i >= 0; i = title.indexOf(" ", i + 1)) {
    if (best < 0 || Math.abs(i - middle) < Math.abs(best - middle)) best = i;
  }
  return best < 0 ? [title] : [title.slice(0, best), title.slice(best + 1)];
}

function listenUrl(track: { title: string; artist: string }): string {
  return `https://open.spotify.com/search/${encodeURIComponent(`${track.title} ${track.artist}`)}`;
}

function listenLabel(track: { title: string; artist: string }): string {
  return `Ouvir ${track.title}, de ${track.artist}, no Spotify (abre em nova aba)`;
}

/**
 * The returning artists as the reference sets them: a centred cloud where
 * size and weight follow the count (the most frequent at 72 px, bold), the
 * larger names (most frequent first) alternating with the smaller ones
 * (least frequent first).
 */
function artistCloud(artists: ArtistCount[]) {
  const RETURNING: 2 | 3 =
    artists.filter((a) => a.count >= 3).length >= MIN_CLOUD ? 3 : 2;
  const returning = artists.filter((a) => a.count >= RETURNING);
  const max = Math.max(RETURNING, ...returning.map((a) => a.count));
  const half = Math.ceil(returning.length / 2);
  const top = returning.slice(0, half);
  const bottom = returning.slice(half).reverse();
  const order = top.flatMap((a, i) => (bottom[i] ? [a, bottom[i]] : [a]));
  const cloud = order.map((a) => ({
    ...a,
    weight: max === RETURNING ? 0 : (a.count - RETURNING) / (max - RETURNING),
  }));
  return { cloud, threshold: THRESHOLD_WORDS[RETURNING] };
}

function sideRange(tracks: PublicTrack[]): string {
  const first = tracks[0]!.position;
  const last = tracks[tracks.length - 1]!.position;
  return `faixas ${pad(first, 2)} — ${pad(last, 2)}`;
}

// Reference: Mixtape.dc.html and MixtapeSomewhere.dc.html (1440), with
// MixtapeMobile.dc.html and MixtapeSomewhereMobile.dc.html (390): one
// template, its differences driven by the tape's data.
export default async function MixtapePage({ params }: Props) {
  const page = await loadMixtapePage((await params).slug);
  if (!page) notFound();
  const { mixtape, noteCount, artists, previous, next } = page;

  const tracks = [...mixtape.tracks].sort((a, b) => a.position - b.position);
  const trackCount = tracks.length;
  const sideA = tracks.filter((t) => t.position <= SIDE_LENGTH);
  const sideB = tracks.filter(
    (t) => t.position > SIDE_LENGTH && t.position < FULL_TAPE_FROM,
  );
  const rest = tracks.filter((t) => t.position >= FULL_TAPE_FROM);

  // Stars mark the notes on the two sides, one kind after another.
  let noted = 0;
  const marks = new Map<number, (typeof NOTE_MARKS)[number]>();
  for (const t of [...sideA, ...sideB]) {
    if (t.note) marks.set(t.position, NOTE_MARKS[noted++ % NOTE_MARKS.length]!);
  }

  const lines = titleLines(mixtape.title);
  const reflection = paragraphs(mixtape.reflection);
  const detailImage = mixtape.detailImage;
  const { cloud, threshold } = artistCloud(artists);
  const fullRows: FullTapeRow[] = rest.map((t) => ({
    n: t.position,
    title: t.title,
    artist: t.artist,
    note: t.note,
    url: listenUrl(t),
    label: listenLabel(t),
  }));
  const endLabel =
    sideB.length > 0
      ? "fim do lado B"
      : sideA.length > 0
        ? "fim do lado A"
        : null;

  return (
    <>
      <SiteHeader current="mixtapes" />
      <main id="conteudo" className={styles.page}>
        {/* abertura */}
        <section
          className={styles.opening}
          style={{ "--n": lines.length } as CSSProperties}
        >
          <p className={styles.label}>
            Nº {pad(mixtape.number, 2)} · {mixtape.theme}
          </p>
          <p className={styles.number} aria-hidden="true">
            {pad(mixtape.number, 3)}
          </p>
          <Sparkle
            kind={4}
            rotate={-12}
            delay="-1.37s"
            className={styles.openStar}
          />
          <Trees className={cx("rv", styles.trees)} sizes="240px" />
          {mixtape.cover ? (
            <Photo
              image={mixtape.cover}
              priority
              sizes="(max-width: 47.99rem) 280px, 39vw"
              className={cx("dev-in", styles.cover)}
            />
          ) : null}
          <h1 className={cx("t-in", styles.title)}>
            {lines.map((line, i) => (
              <span
                key={i}
                className={cx(styles.line, i > 0 && styles.nextLine)}
              >
                {i > 0 ? " " : null}
                {line}
              </span>
            ))}
          </h1>
          <div className={styles.body}>
            {mixtape.description ? (
              <p className={styles.lede}>{mixtape.description}</p>
            ) : null}
            <dl className={styles.facts}>
              <div>
                <dt>tema</dt>
                <dd>{mixtape.theme}</dd>
              </div>
              <div>
                <dt>faixas</dt>
                <dd>{trackCount}</dd>
              </div>
              {mixtape.year ? (
                <div>
                  <dt>
                    <span className={styles.wide}>guardada</span>
                    <span className={styles.narrow}>desde</span>
                  </dt>
                  <dd>
                    <span className={styles.wide}>desde </span>
                    {mixtape.year}
                  </dd>
                </div>
              ) : null}
              <div className={styles.factBreak}>
                <dt>artistas</dt>
                <dd>{artists.length}</dd>
              </div>
              <div>
                <dt>anotações</dt>
                <dd>{noteCount}</dd>
              </div>
            </dl>
            {mixtape.playlistUrl ? (
              <div className={styles.listenAll}>
                <a
                  className={cx("pl", styles.playAll)}
                  href={mixtape.playlistUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`Ouvir ${mixtape.title} inteira no Spotify (abre em nova aba)`}
                >
                  ouvir a fita <PlayIcon />
                </a>
                <span className={styles.playNote}>
                  no Spotify ↗ · {trackCount} faixas
                </span>
              </div>
            ) : null}
          </div>
        </section>

        {/* reflexão */}
        {detailImage || reflection.length > 0 ? (
          <section className={styles.detail}>
            {reflection.length > 0 ? (
              <div className={styles.reflection}>
                <h2 className={styles.reflectionLabel}>
                  a fita, nas minhas palavras
                </h2>
                <div className={styles.reflectionText}>
                  {reflection.map((p, i) => (
                    <p
                      key={i}
                      className={cx(
                        i > 0 &&
                          i === reflection.length - 1 &&
                          styles.closingLine,
                      )}
                    >
                      {p}
                    </p>
                  ))}
                </div>
              </div>
            ) : null}
            {detailImage ? (
              <figure className={styles.figure}>
                <Photo
                  image={detailImage}
                  sizes="(max-width: 47.99rem) 190px, 17vw"
                  className={cx("ph", styles.figureImage)}
                />
                {mixtape.detailCaption ? (
                  <figcaption className={styles.figureCaption}>
                    {mixtape.detailCaption}
                  </figcaption>
                ) : null}
              </figure>
            ) : null}
          </section>
        ) : null}

        {sideA.length > 0 ? (
          <Side
            id="lado-a"
            name="lado A"
            tracks={sideA}
            marks={marks}
            credit={sideB.length === 0}
          />
        ) : null}

        {mixtape.pullQuote ? (
          <figure className={styles.quote}>
            <span className={styles.quoteStar}>
              <Sparkle kind={1} rotate={20} delay="-0.85s" sizes="54px" />
            </span>
            <blockquote className={cx("q", styles.quoteText)}>
              <p>“{mixtape.pullQuote}”</p>
            </blockquote>
            {mixtape.pullQuoteCredit ? (
              <figcaption className={styles.quoteCredit}>
                {mixtape.pullQuoteCredit}
              </figcaption>
            ) : null}
          </figure>
        ) : null}

        {sideB.length > 0 ? (
          <Side
            id="lado-b"
            name="lado B"
            tracks={sideB}
            marks={marks}
            credit
            end
          />
        ) : null}

        {cloud.length > 0 ? (
          <section className={styles.block} aria-labelledby="sempre-voltam">
            <div className={styles.blockHead}>
              <h2 id="sempre-voltam" className={cx("rv", styles.blockTitle)}>
                os que sempre voltam
              </h2>
              <span className={styles.blockNote}>
                {artists.length} artistas em {trackCount} faixas · estes
                aparecem {threshold} vezes ou mais
              </span>
            </div>
            <ul className={styles.cloud}>
              {cloud.map((a) => (
                <li
                  key={a.artist}
                  className={cx(
                    styles.cloudItem,
                    a.weight >= 0.5 && styles.cloudBold,
                  )}
                  style={{ "--t": a.weight.toFixed(3) } as CSSProperties}
                >
                  {a.artist}
                  <span className={styles.cloudCount}>×{a.count}</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {fullRows.length > 0 ? (
          <section className={styles.block} aria-labelledby="fita-inteira">
            <div className={styles.blockHead}>
              <h2 id="fita-inteira" className={cx("rv", styles.blockTitle)}>
                a fita inteira
              </h2>
              <span className={cx(styles.blockNote, styles.blockNoteFull)}>
                {trackCount} faixas · da {FULL_TAPE_FROM} em diante
                <span className={styles.wide}>, como no verso de um disco</span>
              </span>
            </div>
            <FullTape rows={fullRows} trackCount={trackCount} />
          </section>
        ) : null}

        {/* fim da fita */}
        <section
          className={cx(styles.next, !previous && !next && styles.nextBare)}
          aria-labelledby="continue-ouvindo"
        >
          {endLabel ? <p className={styles.endLabel}>{endLabel}</p> : null}
          <h2 id="continue-ouvindo" className={cx("rv", styles.nextTitle)}>
            continue ouvindo
          </h2>
          {previous ? <NeighbourCard tape={previous} side="previous" /> : null}
          <LineLink href="/mixtapes" className={styles.all}>
            ver todas as fitas
          </LineLink>
          {next ? <NeighbourCard tape={next} side="next" /> : null}
        </section>
      </main>
      <SiteFooter />
    </>
  );
}

function Side({
  id,
  name,
  tracks,
  marks,
  credit = false,
  end = false,
}: {
  id: string;
  name: string;
  tracks: PublicTrack[];
  marks: Map<number, (typeof NOTE_MARKS)[number]>;
  credit?: boolean;
  end?: boolean;
}) {
  return (
    <section
      className={cx(styles.side, end && styles.sideEnd)}
      aria-labelledby={id}
    >
      <div className={styles.wrap}>
        <div className={styles.sideHead}>
          <h2 id={id} className={cx("rv", styles.sideTitle)}>
            {name}
          </h2>
          <span className={styles.sideRange}>{sideRange(tracks)}</span>
        </div>
        <ol className={styles.tracks}>
          {tracks.map((t) => (
            <TrackRow key={t.position} track={t} mark={marks.get(t.position)} />
          ))}
        </ol>
      </div>
      {credit ? (
        <p className={styles.sideCredit}>
          os links ↗ abrem cada música no Spotify
        </p>
      ) : null}
    </section>
  );
}

function TrackRow({
  track,
  mark,
}: {
  track: PublicTrack;
  mark?: (typeof NOTE_MARKS)[number];
}) {
  return (
    <li className={cx("trk rv", styles.track)}>
      <span className={styles.trackTitle}>
        <span className={styles.trackNumber}>{pad(track.position, 2)}</span>
        <b className={styles.trackName}>{track.title}</b>
      </span>
      <span aria-hidden="true" className={styles.trackDot}>
        ·
      </span>
      <span className={styles.trackArtist}>
        <span className={styles.artistName}>{track.artist}</span>
        <a
          className={styles.listen}
          href={listenUrl(track)}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={listenLabel(track)}
        >
          <span className={styles.wide}>ouvir </span>↗
        </a>
      </span>
      {track.note ? (
        <span
          className={cx(
            styles.note,
            track.noteSide === "left" ? styles.noteLeft : styles.noteRight,
          )}
        >
          <span aria-hidden="true" className={styles.noteLine} />
          <span className={styles.noteStar}>
            {mark ? (
              <Sparkle kind={mark.kind} delay={mark.delay} sizes="18px" />
            ) : null}
          </span>
          <i className={styles.noteText}>{track.note}</i>
        </span>
      ) : null}
    </li>
  );
}

function NeighbourCard({
  tape,
  side,
}: {
  tape: MixtapeSummary;
  side: "previous" | "next";
}) {
  const number = `Nº ${pad(tape.number, 2)}`;
  const previous = side === "previous";
  return (
    <Link
      href={`/mixtapes/${tape.slug}`}
      className={cx(
        "cv",
        styles.card,
        previous ? styles.cardPrev : styles.cardNext,
      )}
      aria-label={`${previous ? "Fita anterior" : "Próxima fita"}: ${number}, ${tape.title}`}
    >
      <span className={styles.cardCover}>
        {tape.cover ? (
          <Photo
            image={tape.cover}
            decorative
            sizes="(max-width: 47.99rem) 50vw, 300px"
            className={cx("ph", styles.cardImage)}
          />
        ) : null}
      </span>
      <span className={styles.cardMeta}>
        <span>{previous ? `← ${number}` : `${number} →`}</span>
        <span className={styles.wide}>{tape.theme}</span>
      </span>
      <span className={styles.cardTitle}>
        {tape.title}
        {previous ? null : <PlayIcon className={styles.cardPlay} />}
      </span>
    </Link>
  );
}
