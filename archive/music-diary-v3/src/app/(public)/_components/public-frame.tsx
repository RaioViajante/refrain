import Link from "next/link";

import { publicFontClasses } from "@/app/public-fonts";
import { dictionaryFor } from "@/i18n/dictionaries";
import type { InterfaceLocale } from "@/i18n/locales";
import { localizedHref } from "@/i18n/paths";

import { LanguageSelector } from "./language-selector";

import "@/app/public.css";

// The public page furniture (docs/design-system.md § Page furniture): minimal,
// centered navigation with no logo, wordmark, or site name, and a centered,
// understated footer, and a skip link that is the first tab stop and shows
// only while it has keyboard focus.
//
// The navigation always holds the same four links, Home, Albums, Artists, and
// Memories (M3.8a): every one is a real route, and none depends on the
// database or on the public-reads switch, so the header is the same in every
// state of the journal and reveals nothing. The current section has the drawn
// underline: on the section's own page (the Home, or an archive) its link is
// `aria-current="page"`; on a page inside it (an album journal, an artist, a
// memory) it is `aria-current="true"`, the link back to that section's list.
//
// Every link keeps the interface language (ADR 0008 § 6). The footer holds the
// language selector, which links to the page's own path in each language; a
// page that has no path of its own yet (the album journal while it loads)
// shows none.

export type PublicSection = "home" | "albums" | "artists" | "memories";

/** The id that the skip link and every public page's <main> share. */
export const PUBLIC_CONTENT_ID = "main";

const SECTIONS: readonly { section: PublicSection; href: string }[] = [
  { section: "home", href: "/" },
  { section: "albums", href: "/albums" },
  { section: "artists", href: "/artists" },
  { section: "memories", href: "/memories" },
];

export function PublicFrame({
  locale,
  path,
  selector,
  current,
  inside = false,
  children,
}: Readonly<{
  locale: InterfaceLocale;
  /** The page's English path, for the language selector; null for none. */
  path: string | null;
  /**
   * The selector itself, when the page's path is known only once its data has
   * streamed (the album journal): rendered in place of the one built from
   * `path`.
   */
  selector?: React.ReactNode;
  /** The section the page belongs to; none on the not-found view. */
  current?: PublicSection;
  /** True on a page inside the section rather than the section's own page. */
  inside?: boolean;
  children: React.ReactNode;
}>) {
  const t = dictionaryFor(locale);
  return (
    <div className={`${publicFontClasses} public`}>
      <a href={`#${PUBLIC_CONTENT_ID}`} className="public-skip">
        {t.frame.skipLink}
      </a>
      <header className="public-shell public-header">
        <nav aria-label={t.frame.navigationLabel}>
          <ul className="public-nav" role="list">
            {SECTIONS.map(({ section, href }) => (
              <li key={section}>
                <Link
                  className="public-link"
                  href={localizedHref(locale, href)}
                  aria-current={
                    current === section ? (inside ? "true" : "page") : undefined
                  }
                >
                  {t.frame.sections[section]}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </header>
      {children}
      <footer className="public-shell public-footer">
        <p className="public-closing">{t.frame.closingLine}</p>
        {selector ??
          (path !== null ? (
            <LanguageSelector locale={locale} path={path} />
          ) : null)}
      </footer>
    </div>
  );
}
