import type { Metadata } from "next";
import Link from "next/link";
import type { CSSProperties } from "react";

import { PlayIcon, PlayLink } from "@/components/links";
import { Sparkle, type SparkleKind } from "@/components/marks";
import { Photo } from "@/components/photo";
import { SiteFooter } from "@/components/site/site-footer";
import { SiteHeader } from "@/components/site/site-header";
import { lines, paragraphs } from "@/content/site-texts";
import { cx } from "@/lib/cx";
import type {
  MixtapeSummary,
  PublicMixtape,
  PublicTrack,
} from "@/server/public-queries";
import {
  loadFeatured,
  loadPublishedMixtapes,
  loadSiteImages,
  loadSiteTexts,
} from "@/server/site";

import styles from "./home.module.css";

export const metadata: Metadata = {
  title: { absolute: "refrain · músicas que voltam" },
};

const TEXT_KEYS = [
  "home.intro",
  "home.lede",
  "home.featured_intro",
  "home.zine",
  "home.archive_note",
  "home.quote",
  "home.letter",
] as const;

const IMAGE_SLOTS = [
  "home.birds",
  "home.house",
  "home.horses",
  "home.featured",
  "home.window",
] as const;

/** 1 → "01"; 117 stays "117". */
function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function vars(values: Record<string, string | number>): CSSProperties {
  return values as CSSProperties;
}

// Reference: Main.dc.html (1440) and HomeMobile.dc.html (390).
export default async function HomePage() {
  const [texts, photos, { featured, first }, published] = await Promise.all([
    loadSiteTexts(TEXT_KEYS),
    loadSiteImages(IMAGE_SLOTS),
    loadFeatured(),
    loadPublishedMixtapes(),
  ]);
  const intro = lines(texts["home.intro"]);
  const letter = paragraphs(texts["home.letter"]);

  return (
    <>
      <SiteHeader home />
      <main id="conteudo" className={styles.main}>
        <Opening
          intro={intro}
          lede={texts["home.lede"]}
          featured={featured}
          photos={photos}
        />

        {published.length === 0 ? (
          <section className={styles.empty} aria-label="mixtapes">
            <p>nenhuma fita publicada ainda.</p>
          </section>
        ) : (
          <>
            {featured.length > 0 ? (
              <Featured
                featured={featured.slice(0, 3)}
                intro={texts["home.featured_intro"]}
                zine={texts["home.zine"]}
              />
            ) : null}
            {first ? (
              <SideA tape={first} photo={photos["home.featured"]} />
            ) : null}
            <Archive
              tapes={published.slice(0, NODES.length)}
              note={texts["home.archive_note"]}
            />
          </>
        )}

        {texts["home.quote"] || photos["home.window"] ? (
          <section className={styles.s005} aria-label="citação">
            <p className={styles.num} aria-hidden="true">
              005
            </p>
            <div className={styles.windowSlot}>
              {photos["home.window"] ? (
                <Photo
                  image={photos["home.window"]}
                  sizes="(max-width: 767px) 170px, 17vw"
                  className={cx("ph", styles.fill)}
                />
              ) : null}
            </div>
            <Sparkle
              kind={2}
              rotate={20}
              delay="-1.18s"
              className={styles.windowStar}
            />
            {texts["home.quote"] ? (
              <blockquote className={cx("q", styles.quote)}>
                <p>“{texts["home.quote"]}”</p>
              </blockquote>
            ) : null}
          </section>
        ) : null}

        {letter.length > 0 ? (
          <section className={styles.s006} aria-label="carta">
            <p className={styles.num} aria-hidden="true">
              006
            </p>
            <Sparkle
              kind={4}
              rotate={-16}
              delay="-2.55s"
              className={styles.letterStar}
            />
            <div className={styles.letter}>
              {letter.map((p, i) => (
                <p
                  key={i}
                  className={
                    i > 0 && i === letter.length - 1 ? styles.last : undefined
                  }
                >
                  {p}
                </p>
              ))}
            </div>
          </section>
        ) : null}
      </main>
      <SiteFooter />
    </>
  );
}

type HomePhotos = Awaited<
  ReturnType<typeof loadSiteImages<(typeof IMAGE_SLOTS)[number]>>
>;

/* 001 — the opening. */
function Opening({
  intro,
  lede,
  featured,
  photos,
}: {
  intro: string[];
  lede: string | undefined;
  featured: MixtapeSummary[];
  photos: HomePhotos;
}) {
  const [firstLine, ...rest] = intro;
  return (
    <section className={styles.s001} aria-labelledby="home-title">
      {photos["home.birds"] ? (
        <Photo
          image={photos["home.birds"]}
          sizes="(max-width: 767px) 150px, 17vw"
          priority
          className={cx("dev-in", styles.birds)}
          style={vars({ "--d": "0s" })}
        />
      ) : null}
      <Sparkle
        kind={4}
        delay="-1.37s"
        className={cx(styles.openStar, styles.desktopOnly)}
      />
      <Sparkle
        kind={1}
        delay="-1.37s"
        className={cx(styles.openStar, styles.mobileOnly)}
      />
      {photos["home.house"] ? (
        <Photo
          image={photos["home.house"]}
          sizes="(max-width: 767px) 140px, 21vw"
          priority
          className={cx("dev-in", styles.house)}
          style={vars({ "--d": "0.15s" })}
        />
      ) : null}
      {firstLine ? (
        <p className={styles.intro}>
          <strong>{firstLine}</strong>
          {rest.map((line, i) => (
            <span key={i}>
              <br />
              {line}
            </span>
          ))}
        </p>
      ) : null}
      {photos["home.horses"] ? (
        <Photo
          image={photos["home.horses"]}
          sizes="(max-width: 767px) 282px, 54vw"
          priority
          className={cx("dev-in", styles.horses)}
          style={vars({ "--d": "0.3s" })}
        />
      ) : null}
      {/* Two lines: the second starts 0.375 × the size before the first ends. */}
      <h1 id="home-title" className={styles.title}>
        <span className="t-in">músicas</span>{" "}
        <span className={cx("t-in2", styles.second)}>que voltam</span>
      </h1>
      <p className={styles.name}>~ refrain ~</p>
      {lede ? <p className={styles.lede}>{lede}</p> : null}
      {featured.length > 0 ? (
        <nav aria-label="Comece por" className={styles.start}>
          {featured.map((tape) => (
            <Link key={tape.slug} href={`/mixtapes/${tape.slug}`}>
              {tape.title}
            </Link>
          ))}
        </nav>
      ) : null}
      <p className={styles.num} aria-hidden="true">
        001
      </p>
    </section>
  );
}

/* 002 — the featured tapes, at the reference's three positions. */
function Featured({
  featured,
  intro,
  zine,
}: {
  featured: MixtapeSummary[];
  intro: string | undefined;
  zine: string | undefined;
}) {
  return (
    <section className={styles.s002} aria-labelledby="home-featured">
      <p className={styles.num} aria-hidden="true">
        002
      </p>
      <Sparkle
        kind={4}
        rotate={14}
        delay="-2.74s"
        className={styles.featuredStar}
      />
      <div className={styles.head}>
        <h2 id="home-featured" className={cx("rv", styles.h2)}>
          {pad(featured.length)} mixtapes
        </h2>
        {intro ? <p className={styles.headSub}>{intro}</p> : null}
      </div>
      <div className={styles.cards}>
        {featured.map((tape, i) => (
          <Link
            key={tape.slug}
            href={`/mixtapes/${tape.slug}`}
            className={cx("cv", styles.card, styles[`card${i}`])}
          >
            <span className={styles.cover}>
              {tape.cover ? (
                <Photo
                  image={tape.cover}
                  sizes="(max-width: 767px) 270px, 23vw"
                  decorative
                  className={cx("ph", styles.fill)}
                />
              ) : null}
            </span>
            <span className={styles.cardMeta}>
              <span>Nº {pad(tape.number)}</span>
              <span>{tape.theme}</span>
            </span>
            <span className={styles.cardTitle}>
              {tape.title}
              <PlayIcon />
            </span>
          </Link>
        ))}
      </div>
      {zine ? <p className={styles.zine}>{zine}</p> : null}
    </section>
  );
}

/** Tracks shown on the home page: 01–08, then the last one. */
function shownTracks(tracks: PublicTrack[]): {
  head: PublicTrack[];
  last: PublicTrack | null;
} {
  if (tracks.length <= 9) return { head: tracks, last: null };
  return { head: tracks.slice(0, 8), last: tracks[tracks.length - 1] ?? null };
}

const NOTE_STARS: { kind: SparkleKind; delay: string }[] = [
  { kind: 3, delay: "-5.48s" },
  { kind: 2, delay: "-0.85s" },
  { kind: 1, delay: "-2.22s" },
];

/* 003 — side A: the first featured tape. */
function SideA({
  tape,
  photo,
}: {
  tape: PublicMixtape;
  photo: HomePhotos["home.featured"];
}) {
  const { head, last } = shownTracks(tape.tracks);
  const shown = last ? [...head, last] : head;
  // At most three notes, from the tracks on display.
  const noted = new Set(
    shown
      .filter((t) => t.note.trim() !== "")
      .slice(0, 3)
      .map((t) => t.position),
  );
  let starIndex = 0;
  const row = (track: PublicTrack) => {
    const side = noted.has(track.position) ? track.noteSide : null;
    const star = side ? NOTE_STARS[starIndex++ % NOTE_STARS.length] : null;
    return (
      <li
        key={track.position}
        className={cx(
          styles.track,
          side === "left" && styles.left,
          side === "right" && styles.right,
        )}
      >
        <span className={styles.trackTitle}>
          {side === "left" ? (
            <span className={styles.noteLine} aria-hidden="true" />
          ) : null}
          <span className={styles.trackText}>
            <span className={styles.trackNo}>{pad(track.position)}</span>
            {track.title}
          </span>
        </span>
        <span className={styles.dot} aria-hidden="true">
          ·
        </span>
        <span className={styles.trackArtist}>
          <span className={styles.trackText}>{track.artist}</span>
          {side === "right" ? (
            <span className={styles.noteLine} aria-hidden="true" />
          ) : null}
        </span>
        {side && star ? (
          <span className={styles.note}>
            <span className={styles.noteStar}>
              <Sparkle kind={star.kind} delay={star.delay} sizes="22px" />
            </span>
            <span className={styles.noteText}>{track.note}</span>
          </span>
        ) : null}
      </li>
    );
  };

  const subline = [tape.theme, tape.description].filter(Boolean).join(" — ");

  return (
    <section className={styles.s003} aria-labelledby="home-side-a">
      <p className={styles.num} aria-hidden="true">
        003
      </p>
      <p className={styles.label}>lado A — em destaque</p>
      <Sparkle kind={4} rotate={-10} delay="-4.11s" className={styles.aStar} />
      <div className={styles.band}>
        {photo ? (
          <Photo
            image={photo}
            sizes="(max-width: 767px) 330px, 60vw"
            className={cx("ph", styles.bandPhoto)}
          />
        ) : null}
        <h2 id="home-side-a" className={cx("rv", styles.aTitle)}>
          {tape.title}
        </h2>
      </div>
      {subline ? <p className={styles.aSub}>{subline}</p> : null}
      {shown.length > 0 ? (
        <ol className={styles.tracks}>
          {head.map(row)}
          {last ? (
            <>
              <li className={styles.gap} aria-hidden="true">
                ⋮
              </li>
              {row(last)}
            </>
          ) : null}
        </ol>
      ) : null}
      {tape.tracks.length > shown.length ? (
        <p className={styles.more}>+ mais faixas na fita</p>
      ) : null}
      <div className={styles.open}>
        <PlayLink href={`/mixtapes/${tape.slug}`} className={styles.openLink}>
          abrir {tape.title}
        </PlayLink>
      </div>
    </section>
  );
}

/*
 * 004 — the constellation. Desktop: the reference's seven node positions
 * (% of a 1440 × 1260 board); each star's centre is a line endpoint.
 */
const NODES: {
  star: [number, number];
  cover: [number, number];
  title: [number, number];
  kind: SparkleKind;
  rotate: number;
  delay: string;
}[] = [
  {
    star: [18.264, 34.365],
    cover: [23.333, 25.397],
    title: [23.194, 35.556],
    kind: 1,
    rotate: 0,
    delay: "-3.59s",
  },
  {
    star: [52.292, 29.603],
    cover: [57.361, 20.635],
    title: [57.222, 30.794],
    kind: 2,
    rotate: 37,
    delay: "-4.96s",
  },
  {
    star: [67.569, 47.857],
    cover: [72.639, 38.889],
    title: [72.5, 49.048],
    kind: 4,
    rotate: 74,
    delay: "-0.33s",
  },
  {
    star: [36.319, 55],
    cover: [41.389, 46.032],
    title: [41.25, 56.19],
    kind: 3,
    rotate: 111,
    delay: "-1.70s",
  },
  {
    // The reference's lighter node: drawn here in the bold style, its star
    // centred on the same line endpoint (1060, 900).
    star: [71.042, 68.492],
    cover: [76.111, 59.841],
    title: [75.972, 70],
    kind: 1,
    rotate: 148,
    delay: "-3.07s",
  },
  {
    star: [13.403, 70.079],
    cover: [18.472, 61.111],
    title: [18.333, 71.27],
    kind: 2,
    rotate: 185,
    delay: "-4.44s",
  },
  {
    star: [41.875, 82.778],
    cover: [46.944, 73.81],
    title: [46.806, 83.968],
    kind: 3,
    rotate: 222,
    delay: "-5.81s",
  },
];

/** Star centres on the 1440 × 1260 board, and the reference's lines. */
const POINTS: [number, number][] = [
  [300, 470],
  [790, 410],
  [1010, 640],
  [560, 730],
  [1060, 900],
  [230, 920],
  [640, 1080],
];
const LINES: [number, number][] = [
  [0, 1],
  [1, 2],
  [0, 3],
  [3, 1],
  [2, 4],
  [3, 4],
  [3, 5],
  [5, 6],
  [6, 4],
];

/* Mobile: a zigzag of slots 138 px apart, left then right (390 board). */
const MOBILE_FIRST_Y = 210;
const MOBILE_STEP = 138;

function Archive({
  tapes,
  note,
}: {
  tapes: MixtapeSummary[];
  note: string | undefined;
}) {
  const n = tapes.length;
  const missing = NODES.length - n;
  const mobileHeight = 1240 - missing * MOBILE_STEP;
  const mobileY = (i: number) => MOBILE_FIRST_Y + i * MOBILE_STEP;
  const mobileX = (i: number) => (i % 2 === 0 ? 34 : 356);

  return (
    <section
      className={styles.s004}
      aria-labelledby="home-archive"
      style={vars({ "--mh": mobileHeight })}
    >
      <p className={styles.num} aria-hidden="true">
        004
      </p>
      <div className={styles.archHead}>
        <h2 id="home-archive" className={cx("rv", styles.h2)}>
          o arquivo
        </h2>
        <p className={styles.headSub}>uma constelação de sentimentos</p>
      </div>
      <svg
        aria-hidden="true"
        viewBox="0 0 1440 1260"
        preserveAspectRatio="none"
        className={cx(styles.lines, styles.desktopOnly)}
      >
        <g className="march">
          {LINES.filter(([a, b]) => a < n && b < n).map(([a, b]) => {
            const [x1, y1] = POINTS[a]!;
            const [x2, y2] = POINTS[b]!;
            return <line key={`${a}-${b}`} x1={x1} y1={y1} x2={x2} y2={y2} />;
          })}
        </g>
      </svg>
      <svg
        aria-hidden="true"
        viewBox={`0 0 390 ${mobileHeight}`}
        preserveAspectRatio="none"
        className={cx(styles.lines, styles.mobileOnly)}
      >
        <g className="march">
          {tapes.slice(1).map((tape, i) => (
            <line
              key={tape.slug}
              x1={mobileX(i)}
              y1={mobileY(i)}
              x2={mobileX(i + 1)}
              y2={mobileY(i + 1)}
            />
          ))}
        </g>
      </svg>
      <ul className={styles.nodes}>
        {tapes.map((tape, i) => {
          const node = NODES[i]!;
          return (
            <li
              key={tape.slug}
              className={cx(
                styles.node,
                i % 2 === 0 ? styles.nodeLeft : styles.nodeRight,
              )}
              style={vars({
                "--sl": `${node.star[0]}%`,
                "--st": `${node.star[1]}%`,
                "--cl": `${node.cover[0]}%`,
                "--ct": `${node.cover[1]}%`,
                "--tl": `${node.title[0]}%`,
                "--tt": `${node.title[1]}%`,
                "--my": mobileY(i),
              })}
            >
              <Sparkle
                kind={node.kind}
                rotate={node.rotate}
                delay={node.delay}
                className={styles.nodeStar}
              />
              {tape.cover ? (
                <Photo
                  image={tape.cover}
                  sizes="110px"
                  decorative
                  className={cx("rv", styles.nodeCover)}
                />
              ) : null}
              <Link href={`/mixtapes/${tape.slug}`} className={styles.nodeLink}>
                <span className={styles.nodeTitle}>{tape.title}</span>
                <span className={styles.nodeTheme}>{tape.theme}</span>
              </Link>
            </li>
          );
        })}
      </ul>
      {note ? <p className={styles.archNote}>{note}</p> : null}
    </section>
  );
}
