import Link from "next/link";

import type { PublicMemoryCard } from "@/modules/publication/public";

import { V3_CONTENT_ID, V3Frame } from "@/app/v3/frame";
import { groupByYear, yearOf } from "@/app/v3/memory-shape";
import { dictionaryFor } from "@/i18n/dictionaries";
import type { InterfaceLocale } from "@/i18n/locales";
import { localizedHref } from "@/i18n/paths";
import { v3StringsFor } from "@/i18n/v3";

// The public Memories archive (docs/design-system.md, Part I, Pages:
// Memories): kept by year, each memory a picture with its title in hand and
// the song that brings it back. Only served memories appear, newest first, as
// the public archive reads them.
//
// A memory has no photograph yet (media is proposed, ADR 0012 § 4), so each
// one shows the reference's empty state, lined paper with the title written
// large. Years come from the author's own "when" (memory-shape.ts).

/** Grid places from the reference, for a section whose year sits left or right. */
const PLACES = {
  left: [
    ["5 / span 4", 1, 20],
    ["9 / span 4", 1, 80],
    ["1 / span 3", 2, 0],
    ["4 / span 3", 2, 70],
    ["7 / span 3", 2, 20],
    ["10 / span 3", 2, 60],
  ],
  right: [
    ["1 / span 4", 1, 60],
    ["5 / span 4", 1, 0],
    ["1 / span 3", 2, 0],
    ["4 / span 3", 2, 70],
    ["7 / span 3", 2, 20],
    ["10 / span 3", 2, 60],
  ],
} as const;

function place(side: "left" | "right", index: number) {
  const table = PLACES[side];
  if (index < table.length) {
    const [column, row, top] = table[index]!;
    return { gridColumn: column, gridRow: row, marginTop: `${top}px` };
  }
  const extra = index - table.length;
  const columns = ["1 / span 3", "4 / span 3", "7 / span 3", "10 / span 3"];
  return {
    gridColumn: columns[extra % 4],
    gridRow: 3 + Math.floor(extra / 4),
    marginTop: `${[10, 60, 20, 70][extra % 4]}px`,
  };
}

export function songLine(card: PublicMemoryCard): string | null {
  const song = card.music[0];
  if (!song) return null;
  return `♪ ${[song.title, song.artists.join(", ")].filter(Boolean).join(", ")}`.toUpperCase();
}

export function MemoriesArchive({
  memories,
  locale,
}: Readonly<{
  memories: readonly PublicMemoryCard[] | null;
  locale: InterfaceLocale;
}>) {
  const t = v3StringsFor(locale).memories;
  const list = memories ?? [];
  const numbered = list.map((card, i) => ({ card, n: i + 1 }));
  const groups = groupByYear(numbered, ({ card }) =>
    yearOf(card.rememberedWhen),
  );
  const undated = v3StringsFor(locale).home.undated;
  return (
    <V3Frame
      locale={locale}
      path="/memories"
      page="memories"
      current="memories"
    >
      <main id={V3_CONTENT_ID} tabIndex={-1}>
        <section className="ptop wrap" aria-labelledby="pp-h1">
          <div className="shead">
            <h1 id="pp-h1" data-a="up" data-d="0">
              {t.h1}
              <span className="ser">{t.h1b}</span>
            </h1>
          </div>
          <p className="say" data-a="up" data-d="2">
            {t.say}
          </p>
          {memories === null ? (
            <p className="say" role="status">
              {dictionaryFor(locale).archives.unavailable}
            </p>
          ) : null}
          {memories !== null && list.length === 0 ? (
            <div className="board0 lone" data-a="up" data-d="2">
              <span className="pin" aria-hidden="true" />
              <span className="kr hand">{v3StringsFor(locale).empty.x1}</span>
              <Link className="lk" href={localizedHref(locale, "/albums")}>
                {v3StringsFor(locale).empty.x2}
              </Link>
            </div>
          ) : null}
          {groups.map((group, g) => {
            const side = g % 2 === 0 ? "left" : "right";
            const label =
              group.years.length === 0 ? undated : group.years.join(" · ");
            return (
              <section key={label} className="yb" aria-label={label}>
                <h2
                  className="yh"
                  style={{
                    ["--yc" as string]:
                      side === "left" ? "1 / span 4" : "9 / span 4",
                  }}
                  data-a={side}
                  data-d="0"
                >
                  <b>{group.years[0] ?? undated}</b>
                  <span className="ser">
                    {group.years.length > 1
                      ? `& ${group.years.slice(1).join(" & ")}`
                      : g === 0 &&
                          group.years[0] === new Date().getUTCFullYear()
                        ? t.soFar
                        : ""}
                  </span>
                </h2>
                {group.items.map(({ card, n }, i) => {
                  const song = songLine(card);
                  return (
                    <Link
                      key={card.slug}
                      className="mi"
                      href={localizedHref(locale, `/memories/${card.slug}`)}
                      data-a="place"
                      data-d={String(i % 6)}
                      style={place(side, i)}
                    >
                      <span className="n pix">({n})</span>
                      <span
                        className="pg hand"
                        lang={card.locale}
                        aria-hidden="true"
                      >
                        {card.title}
                      </span>
                      <span className="t hand" lang={card.locale}>
                        {card.title}
                      </span>
                      {song ? <span className="s pix">{song}</span> : null}
                    </Link>
                  );
                })}
              </section>
            );
          })}
        </section>
      </main>
    </V3Frame>
  );
}
