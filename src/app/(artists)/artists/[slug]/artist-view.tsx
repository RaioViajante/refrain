import Link from "next/link";

import type { PublicArtist } from "@/modules/publication/public";

import { Cover, labelLine } from "@/app/v3/cover";
import { Vinyl } from "@/app/v3/objects";
import { TORN_HALVES } from "@/app/v3/rings";
import type { InterfaceLocale } from "@/i18n/locales";
import { localizedHref } from "@/i18n/paths";
import { v3StringsFor } from "@/i18n/v3";

// The public artist page (docs/design-system.md, Part I, Pages: artist): the
// portrait torn in two as the page opens, the name between the halves with
// what the journal knows about the artist, and their album journals on the
// shelf.
//
// The photograph is the one the author chose, with the credit its licence
// asks for, under the portrait (Deployment gate item 7 still governs a hosted
// page). It is shown in black and white and torn in two, and the credit says
// so. Without a photograph the halves are kraft with the name in hand (Empty
// states). Labels appear only for what the public page can say: the number of
// public album journals, and the album when there is exactly one. Artist
// journals are not public yet (ADR 0011 § 4.3, proposed), so the page quotes no
// journal of its own.

const LABEL_TOPS = [330, 430, 530, 630];

const COPY = {
  en: {
    shelfH: "the albums here",
    shelfB: "on the shelf",
    allR: "All artists",
    shown: "Shown in black and white, torn in two.",
    photo: "Photograph",
    license: "License",
    source: "Source",
  },
  "pt-BR": {
    shelfH: "os álbuns aqui",
    shelfB: "na estante",
    allR: "Todos os artistas",
    shown: "Mostrada em preto e branco, rasgada em duas.",
    photo: "Fotografia",
    license: "Licença",
    source: "Fonte",
  },
} as const;

export function ArtistView({
  artist,
  locale,
}: Readonly<{ artist: PublicArtist; locale: InterfaceLocale }>) {
  const t = v3StringsFor(locale).artist;
  const c = COPY[locale];
  const words = artist.name.trim().split(/\s+/);
  const first = words.length > 1 ? words.slice(0, -1).join(" ") : artist.name;
  const rest = words.length > 1 ? words[words.length - 1] : "";
  const only = artist.albums.length === 1 ? artist.albums[0]! : null;
  const labels: { label: string; value: string }[] = [
    { label: t.l1, value: String(artist.albums.length) },
  ];
  if (only) {
    labels.push({
      label: t.l2,
      value: [only.title, only.firstReleaseYear].filter(Boolean).join(", "),
    });
  }
  const photo = artist.photo;
  const halfStyle = (side: "left" | "right") =>
    photo
      ? {
          clipPath: TORN_HALVES[side],
          backgroundImage: `url("${photo.src}")`,
          backgroundSize: "200% 100%",
          backgroundPosition: side === "left" ? "0 0" : "100% 0",
        }
      : { clipPath: TORN_HALVES[side] };
  return (
    <main id="main" tabIndex={-1}>
      <article>
        <section className="wrap" aria-labelledby="pp-h1">
          <div
            className={`torn ${photo ? "has-photo" : "no-photo"}`}
            data-io=""
          >
            <span
              className="half l"
              aria-hidden="true"
              style={halfStyle("left")}
            >
              {photo ? null : (
                <span className="knm hand">{first.toLowerCase()}</span>
              )}
            </span>
            <span
              className="half r"
              aria-hidden="true"
              style={halfStyle("right")}
            >
              {photo ? null : (
                <span className="knm hand">
                  {(rest || first).toLowerCase()}
                </span>
              )}
            </span>
            <div className="mid">
              <p className="k pix">
                {locale === "pt-BR" ? "ARTISTA" : "ARTIST"}
              </p>
              <h1 id="pp-h1">
                {first}
                {rest ? <span className="ser">{rest}</span> : null}
              </h1>
            </div>
            {labels.map((entry, i) => (
              <p
                key={entry.label}
                className="lab"
                style={{
                  top: `${LABEL_TOPS[i]}px`,
                  margin: 0,
                  ["--ld" as string]: `${(1.6 + i * 0.25).toFixed(2)}s`,
                }}
              >
                <span className="pix lab-k">{entry.label}</span>
                <br />
                <span className="hand">{entry.value}</span>
              </p>
            ))}
            <span
              className="crop"
              aria-hidden="true"
              style={{
                left: "2%",
                top: 14,
                borderTopWidth: 1.5,
                borderLeftWidth: 1.5,
              }}
            />
            <span
              className="crop"
              aria-hidden="true"
              style={{
                right: "2%",
                top: 14,
                borderTopWidth: 1.5,
                borderRightWidth: 1.5,
              }}
            />
            <span
              className="crop"
              aria-hidden="true"
              style={{
                left: "2%",
                bottom: 14,
                borderBottomWidth: 1.5,
                borderLeftWidth: 1.5,
              }}
            />
            <span
              className="crop"
              aria-hidden="true"
              style={{
                right: "2%",
                bottom: 14,
                borderBottomWidth: 1.5,
                borderRightWidth: 1.5,
              }}
            />
          </div>
          {photo ? (
            <p className="pcredit pix">
              {c.photo}: {photo.credit} ·{" "}
              {photo.license.url ? (
                <a
                  href={photo.license.url}
                  rel="license noopener"
                  target="_blank"
                >
                  {photo.license.name}
                </a>
              ) : (
                photo.license.name
              )}{" "}
              ·{" "}
              <a href={photo.sourceUrl} rel="noopener" target="_blank">
                {c.source}
              </a>{" "}
              · {photo.modifications} {c.shown}
            </p>
          ) : null}
        </section>
        {artist.albums.length > 0 ? (
          <section className="his wrap" aria-labelledby="pp-his">
            <div className="shead">
              <h2 id="pp-his">
                {c.shelfH}
                <span className="ser">{c.shelfB}</span>
              </h2>
            </div>
            {artist.albums.map((album) => {
              const href = localizedHref(locale, `/albums/${album.slug}`);
              return (
                <div key={album.slug} className="row">
                  <Link
                    className="sl"
                    href={href}
                    data-a="sleeve"
                    data-d="0"
                    style={{ ["--vx" as string]: "-40%" }}
                    aria-hidden="true"
                    tabIndex={-1}
                  >
                    <Vinyl
                      top={artist.name.toLowerCase()}
                      bottom={album.title.toUpperCase()}
                    />
                    <Cover
                      artwork={album.artwork}
                      title={album.title}
                      line={labelLine([artist.name], album.firstReleaseYear)}
                      sizes="300px"
                    />
                  </Link>
                  <Link className="tx" href={href}>
                    <span className="t ser" style={{ display: "block" }}>
                      {album.title}
                    </span>
                    <span className="m" style={{ display: "block" }}>
                      {[artist.name, album.firstReleaseYear]
                        .filter(Boolean)
                        .join(", ")}
                    </span>
                  </Link>
                </div>
              );
            })}
            <div style={{ marginTop: 60 }}>
              <Link
                className="pill ghost"
                href={localizedHref(locale, "/artists")}
              >
                {c.allR}
              </Link>
            </div>
          </section>
        ) : null}
      </article>
    </main>
  );
}
