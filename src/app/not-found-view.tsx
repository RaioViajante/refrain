import Link from "next/link";

import { otherLocale, type InterfaceLocale } from "@/i18n/locales";
import { localizedHref } from "@/i18n/paths";
import { v3StringsFor } from "@/i18n/v3";

import { V3_CONTENT_ID, V3Frame } from "./v3/frame";
import { Kraft, Vinyl } from "./v3/objects";

// The not-found view (docs/design-system.md, Part I, Pages: 404): a scratched
// record that skips, one way back to the start, and the three sections. It is
// the same for every address that is not served, for every reason (INV-5),
// and depends on no data.
//
// ADR 0008 § 8 keeps the interim bilingual view: the global not-found is one
// English document for every address, `/pt/...` included, so the other
// language's lines follow, marked with their own `lang`.

const KRAFT_CLIPS = [
  "polygon(3.6% 0.0%,2.9% 14.3%,4.4% 28.6%,0.8% 42.9%,4.7% 57.1%,4.5% 71.4%,1.0% 85.7%,3.2% 100.0%,95.3% 100.0%,98.8% 85.7%,96.1% 71.4%,97.5% 57.1%,97.6% 42.9%,95.7% 28.6%,96.5% 14.3%,98.2% 0.0%)",
  "polygon(0.5% 0.0%,4.8% 14.3%,2.6% 28.6%,2.1% 42.9%,4.8% 57.1%,4.4% 71.4%,0.2% 85.7%,4.2% 100.0%,99.5% 100.0%,98.3% 85.7%,97.6% 71.4%,97.1% 57.1%,98.8% 42.9%,99.6% 28.6%,95.3% 14.3%,99.5% 0.0%)",
  "polygon(0.2% 0.0%,3.1% 14.3%,3.6% 28.6%,1.8% 42.9%,3.2% 57.1%,4.1% 71.4%,5.0% 85.7%,1.1% 100.0%,99.0% 100.0%,96.5% 85.7%,97.9% 71.4%,99.6% 57.1%,98.2% 42.9%,95.4% 28.6%,98.3% 14.3%,98.2% 0.0%)",
];
const KRAFT_TILTS = ["-1.5deg", "1deg", "-0.5deg"];

export function NotFoundView({ locale }: Readonly<{ locale: InterfaceLocale }>) {
  const t = v3StringsFor(locale).notFound;
  const second = otherLocale(locale);
  const other = v3StringsFor(second).notFound;
  const sections = [
    { key: "albums", href: "/albums", label: t.albums },
    { key: "artists", href: "/artists", label: t.artists },
    { key: "memories", href: "/memories", label: t.memories },
  ] as const;
  return (
    <V3Frame locale={locale} path="/" page="notfound">
      <main id={V3_CONTENT_ID} tabIndex={-1}>
        <section className="nf wrap" aria-labelledby="pp-h1">
          <div>
            <span className="code pix" data-a="fade" data-d="0">
              {t.code}
            </span>
            <h1 id="pp-h1" data-a="up" data-d="1">
              {t.h1}
              <span className="ser">{t.h1b}</span>
            </h1>
            <p className="say" data-a="up" data-d="3">
              {t.say}
            </p>
            <div className="acts" data-a="up" data-d="5">
              <Link className="pill" href={localizedHref(locale, "/")}>
                {t.back}
              </Link>
              {sections.map((section, i) => (
                <Kraft
                  key={section.key}
                  seed={section.key}
                  link
                  href={localizedHref(locale, section.href)}
                  style={{ clipPath: KRAFT_CLIPS[i], rotate: KRAFT_TILTS[i] }}
                >
                  {section.label}
                </Kraft>
              ))}
            </div>
            <p className="nf-other say" lang={second}>
              <span className="pix">{other.code}</span> {other.h1}: {other.h1b}{" "}
              <Link href={localizedHref(second, "/")} hrefLang={second}>
                {other.back}
              </Link>
            </p>
          </div>
          <div className="disc" aria-hidden="true" data-a="rec" data-d="2">
            <span className="spin">
              <Vinyl top="404" bottom={locale === "pt-BR" ? "LADO B" : "SIDE B"} />
              <svg className="scr" viewBox="0 0 100 100" aria-hidden="true">
                <path d="M58 16 C70 19 79 26 85 36" strokeWidth=".45" strokeOpacity=".75" />
                <path
                  d="M60 18.5 C70.5 21.5 77.5 27.5 82.6 36.4"
                  strokeWidth=".25"
                  strokeOpacity=".5"
                />
                <path
                  d="M71 22.8 l1.6 -1.3 M75.4 26.6 l1.5 -1.4"
                  strokeWidth=".3"
                  strokeOpacity=".6"
                />
              </svg>
            </span>
            <svg className="arrow" viewBox="0 0 110 90" aria-hidden="true">
              <path d="M96 6 C80 10 62 22 52 46 C47 58 46 68 47 78" />
              <path d="M40 68 L47 79 L55 69" />
            </svg>
            <span className="note hand" data-a="write" data-d="14">
              {t.note}
            </span>
          </div>
        </section>
      </main>
    </V3Frame>
  );
}
