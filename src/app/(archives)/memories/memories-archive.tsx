import Link from "next/link";

import type { PublicMemoryCard } from "@/modules/publication/public";

import { V3_CONTENT_ID, V3Frame } from "@/app/v3/frame";
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
  return `♪ ${[song.title, song.artists.join(", ")].filter(Boolean).join(", ")}`;
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
  // "When" is the author's free text and is never read as a date (owner
  // decision, Design System Part II; M3.8a): the memories are not grouped by
  // year, and the year's margin stays empty. They keep the archive's order,
  // the newest publication first. The reference's year sections wait for a
  // structured year (ADR 0011 § 4.2, R6, proposed).
  const lead = dictionaryFor(locale).archives.memories.lead;
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
              {t.h1} <span className="ser">{t.h1b}</span>
            </h1>
          </div>
          {/* The owner's lead: the reference's "Kept by year…" would describe a
              grouping this page does not make. */}
          <p className="say" data-a="up" data-d="2" lang={lead.lang}>
            {lead.text}
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
          {numbered.length > 0 ? (
            <section className="yb" aria-labelledby="pp-h1">
              {numbered.map(({ card, n }, i) => {
                const song = songLine(card);
                return (
                  <Link
                    key={card.slug}
                    className="mi"
                    href={localizedHref(locale, `/memories/${card.slug}`)}
                    data-a="place"
                    data-d={String(i % 6)}
                    style={place("left", i)}
                  >
                    <span className="n pix">{`(${n})`}</span>
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
                    {card.rememberedWhen ? (
                      <span className="w pix" lang={card.locale}>
                        {card.rememberedWhen}
                      </span>
                    ) : null}
                    {song ? <span className="s pix">{song}</span> : null}
                  </Link>
                );
              })}
            </section>
          ) : null}
        </section>
      </main>
    </V3Frame>
  );
}
