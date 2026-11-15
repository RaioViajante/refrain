import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";

import { publicReadsEnabled } from "@/modules/publication/public";

import {
  notFoundMetadata,
  publicPageMetadata,
} from "@/app/(public)/_components/page-metadata";
import { V3_CONTENT_ID, V3Frame } from "@/app/v3/frame";
import { HEADER_RINGS } from "@/app/v3/rings";
import { Kraft, Vinyl } from "@/app/v3/objects";
import type { InterfaceLocale } from "@/i18n/locales";
import { localizedHref } from "@/i18n/paths";
import { v3StringsFor } from "@/i18n/v3";

// The About page (docs/design-system.md, Part I, Pages: About): the liner
// notes, the back of a record sleeve with the credits, and three ways in.
//
// It is a public surface like the archives: while public reads are off it is
// the unknown address (src/proxy.ts), and it reads no journal. The author's
// own lines (why refrain exists, since, the initials, the thanks) are writing
// that has no home yet (ADR 0011 § 4.4, proposed): until it exists, the page
// shows none of it, and never the reference's bracketed placeholders. The
// sources row is the attribution that the music data and the images ask for
// (ADR 0011, D7).

const SOURCES = {
  en: {
    label: "SOURCES",
    text: "Music data from MusicBrainz. Album covers from the Cover Art Archive. Artist photographs from Wikimedia Commons, each credited where it is shown.",
  },
  "pt-BR": {
    label: "FONTES",
    text: "Dados musicais do MusicBrainz. Capas do Cover Art Archive. Fotos de artistas do Wikimedia Commons, cada uma com o crédito onde aparece.",
  },
} as const;

export async function aboutMetadata(
  locale: InterfaceLocale,
): Promise<Metadata> {
  await connection();
  if (!publicReadsEnabled()) {
    return notFoundMetadata(locale);
  }
  const t = v3StringsFor(locale).about;
  return publicPageMetadata({
    locale,
    path: "/about",
    title: `${t.h1} · refrain`,
    description: t.h1b,
    type: "website",
  });
}

export async function AboutScreen({
  locale,
}: Readonly<{ locale: InterfaceLocale }>) {
  await connection();
  if (!publicReadsEnabled()) {
    notFound();
  }
  const t = v3StringsFor(locale).about;
  const sources = SOURCES[locale];
  const ways = [
    { href: "/albums", k: t.k1, d: t.d1, rotate: "-2deg", delay: "0" },
    { href: "/memories", k: t.k2, d: t.d2, rotate: "1.5deg", delay: "2" },
    { href: "/artists", k: t.k3, d: t.d3, rotate: "-1deg", delay: "4" },
  ];
  return (
    <V3Frame locale={locale} path="/about" page="about" current="about">
      <main id={V3_CONTENT_ID} tabIndex={-1}>
        <section className="ptop wrap" aria-labelledby="pp-h1">
          <div className="shead">
            <h1 id="pp-h1" data-a="up" data-d="0">
              {t.h1}
              <span className="ser">{t.h1b}</span>
            </h1>
          </div>
          <div className="lnr">
            <div
              className="bw2"
              data-a="sleeve"
              data-d="2"
              style={{ ["--vx" as string]: "-40%" }}
            >
              <Vinyl top="refrain" bottom={t.side} />
              <div className="bk">
                <span className="mono ser" aria-hidden="true">
                  r
                </span>
                <div />
                <div>
                  <div className="top pix">
                    <span>{t.cr}</span>
                    <span>{t.side}</span>
                  </div>
                  <dl>
                    <dt className="pix">{t.c1}</dt>
                    <dd>
                      <a href="https://raioviajante.com">
                        raioviajante
                        <svg
                          className="penring"
                          viewBox="0 0 120 50"
                          preserveAspectRatio="none"
                          aria-hidden="true"
                        >
                          <path pathLength={1} d={HEADER_RINGS.artists.d} />
                        </svg>
                      </a>
                    </dd>
                    <dt className="pix">{t.c2}</dt>
                    <dd>{t.v2}</dd>
                    <dt className="pix">{t.c4}</dt>
                    <dd>
                      <span className="fonts">
                        <span
                          style={{
                            fontFamily: "var(--f-archivo)",
                            fontWeight: 700,
                          }}
                        >
                          Archivo
                        </span>
                        <span
                          className="ser"
                          style={{ fontStyle: "italic", fontSize: 19 }}
                        >
                          Instrument Serif
                        </span>
                        <span className="pix" style={{ fontSize: 12 }}>
                          Silkscreen
                        </span>
                        <span className="hand" style={{ fontSize: 20 }}>
                          La Belle Aurore
                        </span>
                      </span>
                    </dd>
                    <dt className="pix">{t.c5}</dt>
                    <dd>{t.v5}</dd>
                    <dt className="pix">{sources.label}</dt>
                    <dd>{sources.text}</dd>
                  </dl>
                </div>
              </div>
            </div>
          </div>
        </section>
        <section className="how wrap" aria-labelledby="pp-how">
          <div className="shead" data-a="up" data-d="0">
            <h2 id="pp-how">
              {t.howH}
              <span className="ser">{t.howB}</span>
            </h2>
          </div>
          <div className="three">
            {ways.map((way) => (
              <Link
                key={way.href}
                href={localizedHref(locale, way.href)}
                data-a="up"
                data-d={way.delay}
              >
                <Kraft seed={`about-${way.href}`} rotate={way.rotate}>
                  {way.k}
                </Kraft>
                <p>{way.d}</p>
              </Link>
            ))}
          </div>
        </section>
      </main>
    </V3Frame>
  );
}
