import Link from "next/link";

import { INTERFACE_LOCALES, type InterfaceLocale } from "@/i18n/locales";
import { addressPair, localizedHref } from "@/i18n/paths";
import { dictionaryFor } from "@/i18n/dictionaries";
import { v3StringsFor } from "@/i18n/v3";

import { v3FontClasses } from "./fonts";
import { FOOTER_RINGS, HEADER_RINGS } from "./rings";
import { SoundToggle, V3Runtime } from "./runtime";

import "./v3.css";
import "./frame.css";

// The v3 page frame (docs/design-system.md, Part I, Navigation and language):
// the header (the Home's stacked sections, or an inner page's wordmark and row
// of sections), the page, and the torn navy footer with the tagline, the
// sections and About, the sound control, and the languages.
//
// Links are never underlined; hovering draws the pen circle, and the current
// section and language keep it. The languages are links to the same page in
// the other language: the URL is the only language state (ADR 0008 § 6).
// Every link keeps the interface language. The header and footer depend on no
// data, so they are the same in every state of the journal.

export type V3Section = "albums" | "artists" | "memories" | "about";

/** The id that the skip link and every public page's <main> share. */
export const V3_CONTENT_ID = "main";

const HEADER_SECTIONS = ["albums", "artists", "memories"] as const;
const FOOTER_SECTIONS = ["albums", "artists", "memories", "about"] as const;

const SECTION_PATHS: Readonly<Record<V3Section, string>> = {
  albums: "/albums",
  artists: "/artists",
  memories: "/memories",
  about: "/about",
};

const LANGUAGE_SHORT: Readonly<Record<InterfaceLocale, "EN" | "PT">> = {
  en: "EN",
  "pt-BR": "PT",
};

function Ring({ ring }: Readonly<{ ring: { viewBox: string; d: string } }>) {
  return (
    <svg
      className="penring"
      viewBox={ring.viewBox}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <path pathLength={1} d={ring.d} />
    </svg>
  );
}

function Languages({
  locale,
  path,
  rings,
  label,
}: Readonly<{
  locale: InterfaceLocale;
  path: string | null;
  rings: {
    en: { viewBox: string; d: string };
    pt: { viewBox: string; d: string };
  };
  label: string;
}>) {
  const pair = path === null ? null : addressPair(path);
  return (
    <div className="lang" role="group" aria-label={label}>
      {INTERFACE_LOCALES.map((option, i) => {
        const short = LANGUAGE_SHORT[option];
        const ring = <Ring ring={option === "en" ? rings.en : rings.pt} />;
        return (
          <span key={option} className="lang-item">
            {i > 0 ? <span aria-hidden="true">/</span> : null}
            {pair ? (
              <a
                href={pair[option]}
                hrefLang={option}
                lang={option}
                aria-current={option === locale ? "true" : undefined}
              >
                {short}
                {ring}
              </a>
            ) : (
              <span
                className="lang-off"
                lang={option}
                data-current={option === locale}
              >
                {short}
              </span>
            )}
          </span>
        );
      })}
    </div>
  );
}

// The entrances (docs/design-system.md, Part I, Motion). The page is sent
// already armed (`io`), so content that is on screen when it arrives never
// paints, disappears at hydration, and comes back: it waits, hidden, and
// enters once, as the reference's page does. Nothing depends on the script:
// - without JavaScript, this style (inside <noscript>, a static string with
//   no data) shows everything in place;
// - if the runtime never arrives, frame.css releases everything after three
//   seconds (`.pp.io:not([data-runtime="ready"])`);
// - under reduced motion, v3.css and frame.css show everything in place.
// Every rule that hides an element before its entrance is listed here.
const NO_SCRIPT_RELEASE = [
  ".pp.io [data-a]:not(.on)",
  '.pp.io [data-a="sleeve"]:not(.on) .vinyl',
  ".pp.io .orb2:not(.on) .ri img",
  ".pp.io .orb2:not(.on) .ri .ric",
  ".pp.io .orb2:not(.on) > .vinyl",
  ".pp.io .torn:not(.on) .half",
  ".pp.io .torn:not(.on) .mid",
  ".pp.io .torn:not(.on) .lab",
  ".pp.io .torn:not(.on) .phl",
]
  .join(",")
  .concat(
    "{opacity:1!important}",
    ".pp.io .board:not(.on) .path mask path{stroke-dashoffset:0!important}",
  );

export function V3Frame({
  locale,
  path,
  page,
  current,
  inside = false,
  home = false,
  children,
}: Readonly<{
  locale: InterfaceLocale;
  /** The page's English path, for the language links; null for none. */
  path: string | null;
  /** The page's name, as a class on the root (`pg-<page>`). */
  page: string;
  /** The section the page belongs to; none on the Home or the 404. */
  current?: V3Section;
  /** True on a page inside the section rather than the section's own page. */
  inside?: boolean;
  /** The Home's header: the sections stacked, and no wordmark. */
  home?: boolean;
  children: React.ReactNode;
}>) {
  const t = v3StringsFor(locale);
  const frame = t.home;
  const label = (section: V3Section) => frame[section];
  const ariaCurrent = (section: V3Section) =>
    current === section ? (inside ? "true" : "page") : undefined;
  return (
    <div className={`pp io pg-${page} ${v3FontClasses}`}>
      {/* Without JavaScript nothing is waiting to be revealed (see below). */}
      <noscript>
        <style>{NO_SCRIPT_RELEASE}</style>
      </noscript>
      <a href={`#${V3_CONTENT_ID}`} className="skip">
        {locale === "pt-BR" ? "Pular para o conteúdo" : "Skip to content"}
      </a>
      <header className={home ? "hdr wrap" : "hdr in wrap"}>
        {home ? null : (
          <Link className="wm" href={localizedHref(locale, "/")}>
            refrain
          </Link>
        )}
        <nav aria-label={dictionaryFor(locale).frame.navigationLabel}>
          {HEADER_SECTIONS.map((section) => (
            <Link
              key={section}
              href={localizedHref(locale, SECTION_PATHS[section])}
              aria-current={ariaCurrent(section)}
            >
              {label(section)}
              <Ring ring={HEADER_RINGS[section]} />
            </Link>
          ))}
        </nav>
        <div className="tools">
          <Languages
            locale={locale}
            path={path}
            rings={{ en: HEADER_RINGS.en, pt: HEADER_RINGS.pt }}
            label={frame.langAria}
          />
        </div>
      </header>
      {children}
      <footer className="ftr">
        {/* eslint-disable-next-line @next/next/no-img-element -- a fixed decorative edge */}
        <img
          className="edge"
          src="/v3/torn-top.png"
          alt=""
          aria-hidden="true"
          loading="lazy"
        />
        <div className="sheet">
          <div className="wrap">
            <p className="tg ser" data-a="up" data-d="0">
              {frame.tag}
            </p>
            <div className="row">
              <nav aria-label={frame.navAria}>
                {FOOTER_SECTIONS.map((section) => (
                  <Link
                    key={section}
                    href={localizedHref(locale, SECTION_PATHS[section])}
                    aria-current={
                      current === section && !inside ? "page" : undefined
                    }
                  >
                    {label(section)}
                    <Ring ring={FOOTER_RINGS[section]} />
                  </Link>
                ))}
              </nav>
              <div className="tools">
                <SoundToggle label={frame.snd} />
                <Languages
                  locale={locale}
                  path={path}
                  rings={{ en: FOOTER_RINGS.en, pt: FOOTER_RINGS.pt }}
                  label={frame.langAria}
                />
              </div>
            </div>
            <p className="fine pix">
              {frame.fine} <a href="https://raioviajante.com">raioviajante</a>
            </p>
          </div>
        </div>
      </footer>
      {/* Keyed by the page, so it sets itself up again after a client navigation. */}
      <V3Runtime key={`${page}:${path ?? ""}`} />
    </div>
  );
}
