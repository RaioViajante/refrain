// The about page as a pure view of its data: the public page and the Studio's
// preview render the same markup.
import type { ReactNode } from "react";

import { Sparkle, Trees } from "@/components/marks";
import { Photo } from "@/components/photo";
import { SiteFooter } from "@/components/site/site-footer";
import { SiteHeader } from "@/components/site/site-header";
import {
  lines,
  paragraphs,
  SITE_TEXTS,
  type SiteTextKey,
} from "@/content/site-texts";
import { cx } from "@/lib/cx";
import type { PublicImage } from "@/server/public-queries";

import styles from "./about.module.css";

export const ABOUT_TEXT_KEYS = (
  Object.keys(SITE_TEXTS) as SiteTextKey[]
).filter((key) => key.startsWith("about."));
export const ABOUT_IMAGE_SLOTS = [
  "about.band",
  "about.fence",
  "about.house",
  "about.word_1",
  "about.word_2",
  "about.word_3",
] as const;

const WORD_SLOTS = [1, 2, 3] as const;
const PLACE_SLOTS = [1, 2] as const;

// Each word keeps its own place in the composition (reference: li#solidao,
// li#melancolia, li#pertencer).
const WORD_LAYOUT = {
  1: styles.word1,
  2: styles.word2,
  3: styles.word3,
} as const;

type Word = {
  n: (typeof WORD_SLOTS)[number];
  id: string;
  term: string;
  syllables?: string;
  kind?: string;
  definition?: string;
  caption?: string;
  image?: PublicImage;
};

type Place = {
  n: (typeof PLACE_SLOTS)[number];
  name: string;
  url: string;
  host: string;
  description?: string;
};

/** The anchor for a word: its term without accents ("solidão" → "solidao"). */
function wordId(term: string, n: number, taken: Set<string>): string {
  const base =
    term
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || `palavra-${n}`;
  const id = taken.has(base) ? `${base}-${n}` : base;
  taken.add(id);
  return id;
}

/** The host of an https address, or null for anything else. */
function httpsHost(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" ? parsed.host : null;
  } catch {
    return null;
  }
}

const pad = (n: number) => String(n).padStart(2, "0");

export type AboutData = {
  texts: Partial<Record<SiteTextKey, string>>;
  images: Partial<Record<(typeof ABOUT_IMAGE_SLOTS)[number], PublicImage>>;
};

// Reference: About.dc.html (1440) and AboutMobile.dc.html (390).
export function AboutView({ texts, images }: AboutData) {
  const band = images["about.band"];
  const fence = images["about.fence"];
  const house = images["about.house"];
  const lede = texts["about.lede"];
  const aside = texts["about.aside"];
  const letter = paragraphs(texts["about.letter"]);
  const signature = lines(texts["about.signature"]);
  const fig1 = texts["about.fig_1"];
  const fig2 = texts["about.fig_2"];
  const wordsIntro = texts["about.words_intro"];
  const quote = texts["about.quote"];
  // A section without any of its own content is left out entirely, so the
  // page never shows a heading over nothing.
  const hasLetter =
    letter.length > 0 ||
    signature.length > 0 ||
    Boolean(aside || fence || house);
  const placesIntro = texts["about.places_intro"];

  const taken = new Set<string>();
  const words: Word[] = WORD_SLOTS.flatMap((n) => {
    const term = texts[`about.word_${n}.term`];
    if (!term) return [];
    return [
      {
        n,
        id: wordId(term, n, taken),
        term,
        syllables: texts[`about.word_${n}.syllables`],
        kind: texts[`about.word_${n}.class`],
        definition: texts[`about.word_${n}.definition`],
        caption: texts[`about.word_${n}.caption`],
        image: images[`about.word_${n}`],
      },
    ];
  });

  const places: Place[] = PLACE_SLOTS.flatMap((n) => {
    const url = texts[`about.place_${n}.url`];
    const host = httpsHost(url);
    if (!url || !host) return [];
    return [
      {
        n,
        url,
        host,
        name: texts[`about.place_${n}.name`] ?? host,
        description: texts[`about.place_${n}.description`],
      },
    ];
  });

  // On a phone the first figure sits inside the letter, after its second
  // paragraph (AboutMobile.dc.html).
  const fenceAfter = Math.min(1, letter.length - 1);
  const fenceFigure = (className: string | undefined) =>
    fence ? (
      <figure className={className}>
        <Photo
          image={fence}
          sizes="(max-width: 47.99rem) 200px, 16vw"
          className={cx("ph", styles.portrait)}
        />
        {fig1 ? (
          <figcaption className={styles.captionRight}>{fig1}</figcaption>
        ) : null}
      </figure>
    ) : null;
  const houseFigure = (className: string | undefined) =>
    house ? (
      <figure className={className}>
        <Photo
          image={house}
          sizes="(max-width: 47.99rem) 190px, 16vw"
          className={cx("ph", styles.portrait)}
        />
        {fig2 ? (
          <figcaption className={styles.caption}>{fig2}</figcaption>
        ) : null}
      </figure>
    ) : null;

  return (
    <>
      <SiteHeader current="sobre" />
      <main id="conteudo" className={styles.main}>
        {/* abertura */}
        <section className={styles.opening}>
          <p className={styles.label}>sobre o refrain</p>
          <p className={styles.number} aria-hidden="true">
            000
          </p>
          <Sparkle
            kind={4}
            rotate={-14}
            delay="-1.37s"
            className={styles.openingStar}
          />
          <Trees className={cx("rv", styles.trees)} />
          {band ? (
            <Photo
              image={band}
              sizes="(max-width: 47.99rem) 100vw, 57vw"
              priority
              className={cx("dev-in", styles.band)}
            />
          ) : null}
          <h1 className={cx("t-in", styles.title)}>
            um lugar <span className={styles.second}>para ficar</span>
          </h1>
          {lede ? <p className={styles.lede}>{lede}</p> : null}
          <Sparkle kind={3} delay="-2.74s" className={styles.ledeStar} />
        </section>

        {/* a carta */}
        {hasLetter ? (
          <section className={styles.letterSection}>
            <div className={styles.leftColumn}>
              {/* Keeps the aside where it sits beside the figure. */}
              <div className={styles.fenceSlot}>
                {fenceFigure(styles.sideFigure)}
              </div>
              {aside ? (
                <p className={styles.aside}>
                  <i>{aside}</i>
                  <Sparkle
                    kind={2}
                    delay="-4.11s"
                    className={styles.asideStar}
                  />
                  <span aria-hidden="true" className={styles.asideRule} />
                </p>
              ) : null}
            </div>
            <div className={styles.letterColumn}>
              <h2 className={styles.letterLabel}>
                uma carta, no lugar de uma apresentação
              </h2>
              {letter.length > 0 ? (
                <div className={styles.letter}>
                  {letter.map((paragraph, i) => (
                    <Paragraph
                      key={i}
                      text={paragraph}
                      closing={letter.length > 1 && i === letter.length - 1}
                      figure={
                        i === fenceAfter
                          ? fenceFigure(styles.inlineFigure)
                          : null
                      }
                    />
                  ))}
                </div>
              ) : null}
              {signature.length > 0 ? (
                <p className={styles.signature}>
                  {signature.map((line, i) =>
                    i < signature.length - 1 ? (
                      <span key={i}>
                        <i>{line}</i>
                        <br />
                      </span>
                    ) : (
                      <b key={i} className={styles.name}>
                        {line}
                      </b>
                    ),
                  )}
                </p>
              ) : null}
              {houseFigure(styles.mobileHouse)}
            </div>
            <div className={styles.rightColumn}>
              {houseFigure(styles.sideFigure)}
            </div>
          </section>
        ) : null}

        {/* três palavras */}
        {words.length > 0 ? (
          <section className={styles.words} aria-labelledby="tres-palavras">
            <div className={styles.wordsHead}>
              <Sparkle
                kind={2}
                rotate={14}
                delay="-5.48s"
                className={styles.wordsStar}
              />
              <h2 id="tres-palavras" className={cx("rv", styles.wordsTitle)}>
                três palavras
              </h2>
              {wordsIntro ? (
                <p className={styles.wordsIntro}>{wordsIntro}</p>
              ) : null}
            </div>
            {words.length > 0 ? (
              <ol className={styles.wordList}>
                {words.map((word) => (
                  <li
                    key={word.n}
                    id={word.id}
                    className={cx(styles.word, WORD_LAYOUT[word.n])}
                  >
                    <div className={styles.wordMedia}>
                      {word.image ? (
                        <figure className={styles.wordFigure}>
                          <Photo
                            image={word.image}
                            sizes="(max-width: 47.99rem) 350px, 57vw"
                            className={cx("ph", styles.wordPhoto)}
                          />
                          {word.caption ? (
                            <figcaption className={styles.wordCaption}>
                              {word.caption}
                            </figcaption>
                          ) : null}
                        </figure>
                      ) : null}
                    </div>
                    <h3 className={cx("rv", styles.term)}>{word.term}</h3>
                    <div className={cx("rv", styles.entry)}>
                      <span className={styles.entryNumber}>{pad(word.n)}</span>
                      {word.syllables || word.kind ? (
                        <p className={styles.grammar}>
                          {word.syllables ? (
                            <span className={styles.syllables}>
                              {word.syllables}
                            </span>
                          ) : null}
                          {word.syllables && word.kind
                            ? " \u00a0·\u00a0 "
                            : null}
                          {word.kind ? <i>{word.kind}</i> : null}
                        </p>
                      ) : null}
                      {word.definition ? (
                        <p className={styles.definition}>{word.definition}</p>
                      ) : null}
                      {word.image && word.caption ? (
                        <p className={styles.entryCaption}>{word.caption}</p>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ol>
            ) : null}
          </section>
        ) : null}

        {/* pausa */}
        {quote ? (
          <figure className={styles.pause}>
            <Sparkle
              kind={1}
              rotate={20}
              delay="-0.85s"
              className={styles.pauseStar}
            />
            <blockquote
              className={cx("q", styles.quote)}
            >{`“${quote}”`}</blockquote>
          </figure>
        ) : null}

        {/* outros lugares */}
        {places.length > 0 ? (
          <section className={styles.places} aria-labelledby="outros-lugares">
            <div className={styles.placesHead}>
              <h2 id="outros-lugares" className={cx("rv", styles.placesTitle)}>
                outros lugares meus
              </h2>
              {placesIntro ? (
                <span className={styles.placesIntro}>{placesIntro}</span>
              ) : null}
            </div>
            {places.length > 0 ? (
              <div className={styles.placeGrid}>
                {places.map((place) => (
                  <a
                    key={place.n}
                    href={place.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`${place.name}, ${place.host} (abre em nova aba)`}
                    aria-describedby={
                      place.description ? `lugar-${place.n}` : undefined
                    }
                    className={styles.place}
                  >
                    <span className={styles.placeLabel}>
                      {pad(place.n)} · {place.host}
                    </span>
                    <span className={styles.placeName}>
                      <span className={styles.placeNameText}>{place.name}</span>
                      <span aria-hidden="true" className={styles.arrow}>
                        ↗
                      </span>
                    </span>
                    {place.description ? (
                      <span
                        id={`lugar-${place.n}`}
                        className={styles.placeDescription}
                      >
                        {place.description}
                      </span>
                    ) : null}
                  </a>
                ))}
              </div>
            ) : null}
          </section>
        ) : null}
      </main>
      <div className={styles.footerGap}>
        <SiteFooter />
      </div>
    </>
  );
}

function Paragraph({
  text,
  closing,
  figure,
}: {
  text: string;
  closing: boolean;
  figure: ReactNode;
}) {
  return (
    <>
      <p className={closing ? styles.closing : undefined}>{text}</p>
      {figure}
    </>
  );
}
