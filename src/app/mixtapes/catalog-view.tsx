"use client";

import Link from "next/link";
import { useState, type CSSProperties } from "react";

import { PlayIcon } from "@/components/links";
import { MARKS_CLEARED, Sparkle } from "@/components/marks";
import { Photo } from "@/components/photo";
import { cx } from "@/lib/cx";
import type { PublicImage } from "@/server/public-queries";

import styles from "./catalog.module.css";

/** A published tape, as the catalogue shows it (plain data). */
export type CatalogTape = {
  slug: string;
  /** Two digits: "01". */
  number: string;
  title: string;
  theme: string;
  feeling: string;
  description: string;
  year: number | null;
  trackCount: number;
  cover: PublicImage | null;
};

type View = "constelacao" | "indice";

// The reference's constellation: positions in % of a 1280 × 1250 field,
// repeated for every further seven tapes, and the lines between them.
const PX = [14, 52, 76, 40, 8, 62, 34];
const PY = [13, 7, 28, 39, 58, 63, 80];
const EDGES: readonly (readonly [number, number])[] = [
  [0, 1],
  [0, 3],
  [1, 2],
  [3, 2],
  [3, 4],
  [4, 6],
  [6, 5],
  [5, 2],
  [3, 5],
];
const FIELD_W = 1280;
const CYCLE_H = 1250;
/** Room under the lowest tape: its last position (1000) to the field's foot. */
const TAPE_ROOM = 250;

// The mobile constellation: one tape every 190 px, alternating sides.
const M_STEP = 190;
const M_TOP = 40;

function skyPoint(i: number) {
  const k = i % 7;
  const cycle = Math.floor(i / 7);
  return {
    x: (PX[k]! / 100) * FIELD_W,
    y: cycle * CYCLE_H + (PY[k]! / 100) * CYCLE_H,
  };
}

function skyLines(count: number) {
  const lines: [number, number][] = [];
  for (let c = 0; c * 7 < count; c++) {
    for (const [a, b] of EDGES) {
      if (c * 7 + a < count && c * 7 + b < count)
        lines.push([c * 7 + a, c * 7 + b]);
    }
    if ((c + 1) * 7 < count) lines.push([c * 7 + 6, (c + 1) * 7]);
  }
  return lines;
}

function fitas(n: number) {
  return `${n} ${n === 1 ? "fita" : "fitas"}`;
}

export function CatalogView({
  tapes,
  lede,
}: {
  tapes: CatalogTape[];
  lede: string | undefined;
}) {
  const [feel, setFeel] = useState<string | null>(null);
  const [view, setView] = useState<View>("constelacao");

  const feelings: string[] = [];
  for (const t of tapes) {
    if (t.feeling && !feelings.includes(t.feeling)) feelings.push(t.feeling);
  }
  const chips: { key: string | null; label: string }[] = [
    { key: null, label: "todas" },
    ...feelings.map((f) => ({ key: f, label: f })),
  ];

  const matches = (t: CatalogTape) => feel === null || t.feeling === feel;
  const shown = feel
    ? `${fitas(tapes.filter(matches).length)} sobre ${feel}`
    : fitas(tapes.length);

  const points = tapes.map((_, i) => skyPoint(i));
  const fieldH = Math.max(...points.map((p) => p.y)) + TAPE_ROOM;
  const lines = skyLines(tapes.length);
  const mobileH = tapes.length * M_STEP + 70;

  return (
    <>
      <div className={styles.row}>
        {lede ? <p className={styles.lede}>{lede}</p> : null}
        <p className={styles.count} aria-live="polite">
          {shown}
        </p>
      </div>

      <div className={styles.controls}>
        {feelings.length > 0 ? (
          <>
            <p className={styles.about}>fitas sobre</p>
            <div
              role="group"
              aria-label="Filtrar por sentimento"
              className={styles.chips}
            >
              {chips.map((c) => {
                const on = feel === c.key;
                return (
                  <span key={c.key ?? ""} className={styles.chip}>
                    {c.key !== null ? (
                      <span aria-hidden="true" className={styles.dot}>
                        ·
                      </span>
                    ) : null}
                    <button
                      type="button"
                      aria-pressed={on}
                      onClick={() => setFeel(c.key)}
                      className={cx(styles.button, on && styles.on)}
                    >
                      {on ? (
                        <Sparkle
                          kind={3}
                          delay="-2.74s"
                          className={styles.chipStar}
                          sizes="16px"
                        />
                      ) : null}
                      {c.label}
                    </button>
                  </span>
                );
              })}
            </div>
          </>
        ) : null}
        <div
          role="group"
          aria-label="Modo de visualização"
          className={styles.views}
        >
          <button
            type="button"
            aria-pressed={view === "constelacao"}
            onClick={() => setView("constelacao")}
            className={cx(
              styles.viewButton,
              !MARKS_CLEARED && view === "constelacao" && styles.current,
            )}
          >
            {view === "constelacao" ? (
              <Sparkle
                kind={3}
                delay="-4.11s"
                className={styles.viewStar}
                sizes="10px"
              />
            ) : null}
            constelação
          </button>
          <span aria-hidden="true" className={styles.slash}>
            /
          </span>
          <button
            type="button"
            aria-pressed={view === "indice"}
            onClick={() => setView("indice")}
            className={cx(
              styles.viewButton,
              !MARKS_CLEARED && view === "indice" && styles.current,
            )}
          >
            {view === "indice" ? (
              <Sparkle
                kind={3}
                delay="-5.48s"
                className={styles.viewStar}
                sizes="10px"
              />
            ) : null}
            índice
          </button>
        </div>
      </div>

      {view === "constelacao" ? (
        <section aria-label="constelação" className={styles.sky}>
          <div
            className={styles.field}
            style={
              {
                "--field-h": fieldH,
                "--mobile-h": `${mobileH}px`,
              } as CSSProperties
            }
          >
            <svg
              aria-hidden="true"
              viewBox={`0 0 ${FIELD_W} ${fieldH}`}
              preserveAspectRatio="none"
              className={cx("march", styles.lines, styles.desktopOnly)}
            >
              <g
                stroke="#141414"
                strokeWidth="0.8"
                strokeDasharray="2 6"
                fill="none"
              >
                {lines.map(([a, b]) => (
                  <line
                    key={`${a}-${b}`}
                    x1={Math.round(points[a]!.x)}
                    y1={Math.round(points[a]!.y)}
                    x2={Math.round(points[b]!.x)}
                    y2={Math.round(points[b]!.y)}
                  />
                ))}
              </g>
            </svg>
            <svg
              aria-hidden="true"
              viewBox={`0 0 390 ${mobileH}`}
              preserveAspectRatio="none"
              className={cx("march", styles.lines, styles.mobileOnly)}
            >
              <g
                stroke="#141414"
                strokeWidth="0.8"
                strokeDasharray="2 6"
                fill="none"
              >
                {tapes.slice(1).map((_, i) => (
                  <line
                    key={i}
                    x1={i % 2 ? 344 : 46}
                    y1={70 + i * M_STEP}
                    x2={i % 2 ? 46 : 344}
                    y2={70 + (i + 1) * M_STEP}
                  />
                ))}
              </g>
            </svg>
            <ul className={styles.list}>
              {tapes.map((t, i) => {
                const p = points[i]!;
                return (
                  <li
                    key={t.slug}
                    className={cx(styles.tape, i % 2 === 1 && styles.flip)}
                    style={
                      {
                        "--x": `${(p.x / FIELD_W) * 100}%`,
                        "--y": `${(p.y / fieldH) * 100}%`,
                        "--my": `${M_TOP + i * M_STEP}px`,
                        opacity: matches(t) ? 1 : 0.22,
                      } as CSSProperties
                    }
                  >
                    <span aria-hidden="true" className={styles.mark}>
                      <Sparkle kind={1} delay="-0.85s" sizes="44px" />
                    </span>
                    <Link
                      href={`/mixtapes/${t.slug}`}
                      aria-label={`Abrir ${t.title}`}
                      className={cx("tape cv", styles.skyLink)}
                    >
                      <span className={styles.cover}>
                        {t.cover ? (
                          <Photo
                            image={t.cover}
                            decorative
                            sizes="(max-width: 47.99rem) 96px, 150px"
                            className="rv"
                          />
                        ) : null}
                      </span>
                      <span className={styles.text}>
                        <span className={styles.label}>
                          Nº {t.number}
                          {t.theme ? ` · ${t.theme}` : ""}
                        </span>
                        <span className={styles.name}>
                          {t.title}
                          <span className={styles.go}>
                            <PlayIcon />
                          </span>
                        </span>
                        {t.description ? (
                          <span
                            className={cx(
                              styles.line,
                              t.trackCount === 0 && styles.faded,
                            )}
                          >
                            {t.description}
                          </span>
                        ) : null}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        </section>
      ) : (
        <section aria-label="índice" className={styles.index}>
          <div aria-hidden="true" className={cx(styles.grid, styles.head)}>
            <span>nº</span>
            <span />
            <span>fita</span>
            <span>sentimento</span>
            <span>faixas</span>
            <span>desde</span>
            <span />
          </div>
          <ol className={styles.rows}>
            {tapes.map((t) => (
              <li
                key={t.slug}
                className={styles.entry}
                style={{ opacity: matches(t) ? 1 : 0.22 }}
              >
                <Link
                  href={`/mixtapes/${t.slug}`}
                  aria-label={`Abrir ${t.title}`}
                  className={cx("tape cv", styles.grid, styles.entryLink)}
                >
                  <span className={styles.num}>{t.number}</span>
                  <span className={styles.thumb}>
                    {t.cover ? (
                      <Photo
                        image={t.cover}
                        decorative
                        sizes="(max-width: 47.99rem) 56px, 64px"
                        className="rv"
                      />
                    ) : null}
                  </span>
                  <span className={styles.cell}>
                    <span className={styles.entryLabel}>
                      Nº {t.number}
                      {t.theme ? ` · ${t.theme}` : ""}
                    </span>
                    <b className={styles.entryTitle}>{t.title}</b>
                    {t.description ? (
                      <i
                        className={cx(
                          styles.entryLine,
                          t.trackCount === 0 && styles.faded,
                        )}
                      >
                        {t.description}
                      </i>
                    ) : null}
                  </span>
                  <i className={styles.theme}>{t.theme || "—"}</i>
                  <span className={styles.figure}>
                    {t.trackCount > 0 ? t.trackCount : "—"}
                  </span>
                  <span className={styles.figure}>{t.year ?? "—"}</span>
                  <span className={styles.open}>
                    <span className={styles.openWord}>abrir</span>
                    <PlayIcon />
                  </span>
                </Link>
              </li>
            ))}
          </ol>
        </section>
      )}
    </>
  );
}
