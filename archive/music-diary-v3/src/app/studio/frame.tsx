import type { ReactNode } from "react";

import { Icon } from "@/app/studio/icons";
import { StudioLanguageSelector } from "@/app/studio/language-selector";
import { StudioNavLink } from "@/app/studio/nav-link";
import { SignOutButton } from "@/app/studio/sign-out-button";
import type { InterfaceLocale } from "@/i18n/locales";
import { addressPair, localizedHref } from "@/i18n/paths";
import { v3StringsFor } from "@/i18n/v3";

import { v3FontClasses } from "@/app/v3/fonts";

import "@/app/v3/studio.css";
import "@/app/v3/studio-theme.css";
import { studioWords, type StudioDictionary } from "@/i18n/studio";

/**
 * The page a studio screen belongs to. The header has exactly two destinations,
 * Desk and Catalog (the approved V4.4 design); every other section is reached
 * from them, so each section names which of the two it sits under.
 */
export type StudioSection =
  | "desk"
  | "journals"
  | "memories"
  | "catalog"
  | "artists"
  | "albums"
  | "tracks";

type Primary = "desk" | "catalog";

const PRIMARY: {
  id: Primary;
  label: (words: StudioDictionary) => string;
  href: string;
}[] = [
  { id: "desk", label: (words) => words.frame.desk, href: "/studio" },
  {
    id: "catalog",
    label: (words) => words.frame.catalog,
    href: "/studio/catalog",
  },
];

// Where each section sits. Writing (the desk, its journals, and its
// memories) is the Desk; the music library (artists, albums, tracks) is the
// Catalog.
function primaryOf(section: StudioSection): Primary {
  return section === "desk" || section === "journals" || section === "memories"
    ? "desk"
    : "catalog";
}

const CATALOG_SECTIONS: {
  id: StudioSection;
  label: (words: StudioDictionary) => string;
  href: string;
}[] = [
  {
    id: "catalog",
    label: (words) => words.frame.overview,
    href: "/studio/catalog",
  },
  {
    id: "artists",
    label: (words) => words.frame.artists,
    href: "/studio/artists",
  },
  {
    id: "albums",
    label: (words) => words.frame.albums,
    href: "/studio/albums",
  },
  {
    id: "tracks",
    label: (words) => words.frame.tracks,
    href: "/studio/tracks",
  },
];

/** The id that the skip link and every studio page's <main> share. */
export const STUDIO_CONTENT_ID = "studio-content";

/**
 * The studio's header: the "Writing studio" label, the navigation, and the
 * session control. With no `current` it is only the label, as on the sign-in
 * page. Presentation only: pages render it after they have authorized the
 * request, so an anonymous response never contains the studio's furniture.
 */
export function StudioHeader({
  locale,
  current,
}: {
  locale: InterfaceLocale;
  current?: StudioSection;
}) {
  const words = studioWords(locale);
  const primary = current ? primaryOf(current) : undefined;
  return (
    <header className="studio-header">
      <a href={`#${STUDIO_CONTENT_ID}`} className="studio-skip">
        {words.frame.skipLink}
      </a>
      <div className="studio-shell studio-header-bar">
        <p className="studio-header-label">
          <Icon name="studio" size={16} />
          <span className="studio-header-label-text">{words.frame.studio}</span>
        </p>
        {primary ? (
          <>
            <nav
              className="studio-nav"
              aria-label={words.frame.navigationLabel}
            >
              {PRIMARY.map((item) => (
                <StudioNavLink
                  key={item.id}
                  href={localizedHref(locale, item.href)}
                  current={item.id === primary}
                >
                  {item.label(words)}
                </StudioNavLink>
              ))}
            </nav>
            <div className="studio-header-end">
              <SignOutButton />
            </div>
          </>
        ) : null}
      </div>
    </header>
  );
}

/**
 * The Catalog's own navigation: Overview, Artists, Albums, Tracks. Plain links
 * that are always visible (no menu), with the current section marked. In the
 * notebook layout it sits in the margin column, as in the V4.4 Catalog screen;
 * on a narrow screen it is a row above the page.
 */
export function CatalogNav({
  locale,
  current,
}: {
  locale: InterfaceLocale;
  current: StudioSection;
}) {
  const words = studioWords(locale);
  return (
    <nav
      className="studio-subnav"
      aria-label={words.frame.catalogNavigationLabel}
    >
      {CATALOG_SECTIONS.map((section) => (
        <StudioNavLink
          key={section.id}
          href={localizedHref(locale, section.href)}
          current={section.id === current}
        >
          {section.label(words)}
        </StudioNavLink>
      ))}
    </nav>
  );
}

/**
 * The closing line of every studio page: a drawn rule, one sentence, and the
 * language selector. `path` is the page's English path, built from its route
 * and its validated id; the selector links to the same page in each language.
 */
export function StudioFooter({
  locale,
  path,
}: {
  locale: InterfaceLocale;
  path: string;
}) {
  const words = studioWords(locale);
  return (
    <footer className="studio-shell studio-footer">
      <p>{words.frame.closingLine}</p>
      <StudioLanguageSelector locale={locale} path={path} />
    </footer>
  );
}

/**
 * The studio's page furniture in the v3 design (docs/design-system.md, Part I,
 * Writing Studio; ADR 0011, proposed): the sidebar (the name, Desk, the
 * Library, Write, the catalog, and at its foot the site, the languages, and
 * the session), a top bar with the section, and the screen. Presentation
 * only: it is rendered by pages that have already authorized the request, and
 * shows no private data.
 *
 * Until the v3 Library, Settings, and artist journal editor exist, the
 * sidebar links the screens that do: the album journals (the Library), the
 * memories, and the catalog.
 *
 * `layout` is "notebook" (a margin column and one writing column, the
 * default) or "wide" (the whole shell, for the journal and its editor).
 */
export function StudioFrame({
  locale,
  path,
  current,
  layout = "notebook",
  children,
}: {
  locale: InterfaceLocale;
  /** The page's English path, for the languages. */
  path: string;
  current: StudioSection;
  layout?: "notebook" | "wide";
  children: ReactNode;
}) {
  const words = studioWords(locale);
  const v3 = v3StringsFor(locale).desk;
  const pair = addressPair(path);
  const primary = primaryOf(current);
  const crumb =
    primary === "catalog"
      ? words.frame.catalog
      : current === "journals"
        ? v3.s39
        : current === "memories"
          ? v3.s41
          : v3.s36;
  return (
    <div className={`stu ${v3FontClasses}`}>
      <aside className="side">
        <a href={`#${STUDIO_CONTENT_ID}`} className="studio-skip">
          {words.frame.skipLink}
        </a>
        <a className="wm" href={localizedHref(locale, "/studio")}>
          refrain<small>studio</small>
        </a>
        <nav aria-label={words.frame.navigationLabel}>
          <StudioNavLink
            href={localizedHref(locale, "/studio")}
            current={current === "desk"}
          >
            {v3.s38}
          </StudioNavLink>
          <StudioNavLink
            href={localizedHref(locale, "/studio/journals")}
            current={current === "journals"}
          >
            {v3.s39}
          </StudioNavLink>
          <StudioNavLink
            href={localizedHref(locale, "/studio/memories")}
            current={current === "memories"}
          >
            {v3StringsFor(locale).home.memories}
          </StudioNavLink>
          <span className="grp">{v3.s43}</span>
          <a href={localizedHref(locale, "/studio/journals/new")}>
            <span className="pl" aria-hidden="true">
              +
            </span>
            {v3.s40}
          </a>
          <a href={localizedHref(locale, "/studio/memories/new")}>
            <span className="pl" aria-hidden="true">
              +
            </span>
            {v3.s41}
          </a>
          <span className="grp">{words.frame.catalog}</span>
          <StudioNavLink
            href={localizedHref(locale, "/studio/catalog")}
            current={primary === "catalog"}
          >
            {words.frame.catalog}
          </StudioNavLink>
          {/* On a phone the sidebar's foot keeps only the languages, beside
              the wordmark as in the reference; these two end the menu. */}
          <a className="m-only" href={localizedHref(locale, "/")}>
            {v3.s46} ↗
          </a>
          <span className="m-only m-signout">
            <SignOutButton />
          </span>
        </nav>
        <div className="foot">
          <a className="hide-m" href={localizedHref(locale, "/")}>
            {v3.s46} ↗
          </a>
          <div className="seg" role="group" aria-label={v3.langA}>
            <a
              href={pair.en}
              hrefLang="en"
              lang="en"
              aria-current={locale === "en" ? "true" : undefined}
            >
              EN
            </a>
            <a
              href={pair["pt-BR"]}
              hrefLang="pt-BR"
              lang="pt-BR"
              aria-current={locale === "pt-BR" ? "true" : undefined}
            >
              PT
            </a>
          </div>
          <span className="hide-m">
            raioviajante · <SignOutButton />
          </span>
        </div>
      </aside>
      <div className="main">
        <div className="bar">
          <span className="crumb">
            <b>{crumb}</b>
          </span>
          {current === "desk" ? (
            <a
              className="btn pri new"
              href={localizedHref(locale, "/studio/journals/new")}
            >
              + {v3.s37}
            </a>
          ) : null}
        </div>
        <main
          id={STUDIO_CONTENT_ID}
          tabIndex={-1}
          className="studio-main content"
          data-layout={layout}
        >
          {primary === "catalog" ? (
            <CatalogNav locale={locale} current={current} />
          ) : null}
          {children}
        </main>
      </div>
    </div>
  );
}
