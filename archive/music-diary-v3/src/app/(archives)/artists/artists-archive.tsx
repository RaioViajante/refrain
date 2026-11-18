import Link from "next/link";

import type { PublicArtistCard } from "@/modules/publication/public";

import { V3_CONTENT_ID, V3Frame } from "@/app/v3/frame";
import { LETTER_TABS, TEAR_STRIPS } from "@/app/v3/rings";
import { artistSortKey } from "@/app/v3/sort";
import { dictionaryFor } from "@/i18n/dictionaries";
import type { InterfaceLocale } from "@/i18n/locales";
import { localizedHref } from "@/i18n/paths";
import { v3StringsFor } from "@/i18n/v3";
import { v3TemplatesFor } from "@/i18n/v3/templates";

import { ArtistViews, type ArtistView } from "./artist-views";

// The public Artists archive (docs/design-system.md, Part I, Pages: Artists):
// three artists on torn strips, then everyone, either as a cloud of names
// sized by how often they come up, or A to Z behind kraft dividers.
//
// Exactly the artists with a public page appear (ADR 0006 A5). By the owner's
// earlier decisions, which v3 does not change: photographs stay on each
// artist's own page with their credit, so the strips here are the kraft
// "no photo" state with the name in hand; and a count is how many public album
// journals the artist has (a memory never makes an artist public). Artist
// journals are not public yet, so the strips name no journal and quote none.

const STAR =
  "M50 2 L61 38 L98 38 L68 60 L79 97 L50 75 L21 97 L32 60 L2 38 L39 38 Z";

/** A name's weight in the cloud: 1, 2, or 3 and more. */
function weight(count: number): "c1" | "c2" | "c3" {
  return count >= 3 ? "c3" : count === 2 ? "c2" : "c1";
}

function splitName(name: string): [string, string] {
  const words = name.trim().split(/\s+/);
  if (words.length < 2) return [name, ""];
  return [words.slice(0, -1).join(" "), words[words.length - 1]!];
}

export function ArtistsArchive({
  artists,
  view,
  locale,
}: Readonly<{
  artists: readonly PublicArtistCard[] | null;
  view: ArtistView;
  locale: InterfaceLocale;
}>) {
  const t = v3StringsFor(locale).artists;
  const tt = v3TemplatesFor(locale);
  const lead = dictionaryFor(locale).archives.artists.lead;
  const href = (address: string) =>
    localizedHref(locale, `/artists/${address}`);
  const list = artists ?? [];
  const featured = list.slice(0, 3);
  const groups = new Map<string, PublicArtistCard[]>();
  for (const artist of [...list].sort((a, b) =>
    artistSortKey(a.name).localeCompare(artistSortKey(b.name)),
  )) {
    const letter = (artistSortKey(artist.name).charAt(0) || "#").toUpperCase();
    groups.set(letter, [...(groups.get(letter) ?? []), artist]);
  }
  return (
    <V3Frame locale={locale} path="/artists" page="artists" current="artists">
      <main id={V3_CONTENT_ID} tabIndex={-1}>
        <section className="ptop wrap" aria-labelledby="pp-h1">
          <div className="shead">
            <h1 id="pp-h1" data-a="up" data-d="0">
              {t.h1} <span className="ser">{t.h1b}</span>
            </h1>
          </div>
          <p className="say" data-a="up" data-d="2" lang={lead.lang}>
            {lead.text}
          </p>
          {artists === null ? (
            <p className="say" role="status">
              {locale === "pt-BR"
                ? "Não foi possível ler os artistas agora. Tente de novo daqui a pouco."
                : "The artists could not be read just now. Try again in a moment."}
            </p>
          ) : null}
          {featured.length > 0 ? (
            <div className="feat">
              {featured.map((artist, i) => {
                const [first, rest] = splitName(artist.name);
                return (
                  <Link
                    key={artist.address}
                    href={href(artist.address)}
                    data-a="up"
                    data-d={2 + i * 2}
                  >
                    <span
                      className="tear kp"
                      aria-hidden="true"
                      style={{ clipPath: TEAR_STRIPS[i % TEAR_STRIPS.length] }}
                    >
                      <span className="knm hand">
                        {artist.name.toLowerCase()}
                      </span>
                    </span>
                    <span className="nm">
                      {first}
                      {rest ? " " : null}
                      {rest ? <span className="ser">{rest}</span> : null}
                    </span>
                    <span className="m pix">
                      {tt.artistCounts(artist.albumCount, 0).split(" · ")[0]}
                    </span>
                  </Link>
                );
              })}
            </div>
          ) : null}
          {list.length > 0 ? (
            <ArtistViews
              view={view}
              base={localizedHref(locale, "/artists")}
              labels={{ show: t.show, often: t.v_often, az: t.v_az }}
              often={
                <>
                  <div className="wall2h" data-a="up" data-d="0">
                    <h2 className="ser">{t.allH}</h2>
                    <p>{t.allS}</p>
                  </div>
                  <ul className="wall2">
                    {list.map((artist, i) => (
                      <li
                        key={artist.address}
                        className={weight(artist.albumCount)}
                        data-a="word"
                        data-d={i % 9}
                      >
                        <Link href={href(artist.address)}>
                          {artist.name}
                          <sup aria-hidden="true">{`[${artist.albumCount}]`}</sup>
                          <span className="sr">
                            {tt.entries(artist.albumCount)}
                          </span>
                        </Link>
                        {i < list.length - 1 ? (
                          <svg
                            className="star"
                            viewBox="0 0 100 100"
                            aria-hidden="true"
                          >
                            <path d={STAR} />
                          </svg>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </>
              }
              az={
                <>
                  <div className="wall2h">
                    <h2 className="ser">{t.azH}</h2>
                    <p>{t.azS.split(". ")[0]}.</p>
                  </div>
                  <div className="az">
                    {[...groups.entries()].map(([letter, names], i) => (
                      <div key={letter} className="azg">
                        <span
                          className="tab"
                          style={{
                            clipPath: LETTER_TABS[i % LETTER_TABS.length],
                          }}
                        >
                          {letter}
                        </span>
                        <ul>
                          {names.map((artist) => (
                            <li key={artist.address}>
                              <Link href={href(artist.address)}>
                                {artist.name}
                              </Link>
                              <span className="pix">{`[${artist.albumCount}]`}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                </>
              }
            />
          ) : (
            <div className="board0 lone" data-a="up" data-d="2">
              <span className="pin" aria-hidden="true" />
              <span className="kr hand">
                {locale === "pt-BR" ? "nada aqui ainda" : "nothing here yet"}
              </span>
              <Link className="lk" href={localizedHref(locale, "/albums")}>
                {v3StringsFor(locale).empty.x2}
              </Link>
            </div>
          )}
        </section>
      </main>
    </V3Frame>
  );
}
