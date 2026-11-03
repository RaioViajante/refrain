import type { ReactNode } from "react";

import { Icon } from "@/app/studio/icons";
import { StudioNavLink } from "@/app/studio/nav-link";
import { SignOutButton } from "@/app/studio/sign-out-button";

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

const PRIMARY: { id: Primary; label: string; href: string }[] = [
  { id: "desk", label: "Desk", href: "/studio" },
  { id: "catalog", label: "Catalog", href: "/studio/catalog" },
];

// Where each section sits. Writing (the desk, its journals, and its
// memories) is the Desk; the music library (artists, albums, tracks) is the
// Catalog.
function primaryOf(section: StudioSection): Primary {
  return section === "desk" || section === "journals" || section === "memories"
    ? "desk"
    : "catalog";
}

const CATALOG_SECTIONS: { id: StudioSection; label: string; href: string }[] = [
  { id: "catalog", label: "Overview", href: "/studio/catalog" },
  { id: "artists", label: "Artists", href: "/studio/artists" },
  { id: "albums", label: "Albums", href: "/studio/albums" },
  { id: "tracks", label: "Tracks", href: "/studio/tracks" },
];

/** The id that the skip link and every studio page's <main> share. */
export const STUDIO_CONTENT_ID = "studio-content";

/**
 * The studio's header: the "Writing studio" label, the navigation, and the
 * session control. With no `current` it is only the label, as on the sign-in
 * page. Presentation only: pages render it after they have authorized the
 * request, so an anonymous response never contains the studio's furniture.
 */
export function StudioHeader({ current }: { current?: StudioSection }) {
  const primary = current ? primaryOf(current) : undefined;
  return (
    <header className="studio-header">
      <a href={`#${STUDIO_CONTENT_ID}`} className="studio-skip">
        Skip to the content
      </a>
      <div className="studio-shell studio-header-bar">
        <p className="studio-header-label">
          <Icon name="studio" size={16} />
          <span className="studio-header-label-text">Writing studio</span>
        </p>
        {primary ? (
          <>
            <nav className="studio-nav" aria-label="Writing studio">
              {PRIMARY.map((item) => (
                <StudioNavLink
                  key={item.id}
                  href={item.href}
                  current={item.id === primary}
                >
                  {item.label}
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
export function CatalogNav({ current }: { current: StudioSection }) {
  return (
    <nav className="studio-subnav" aria-label="Catalog sections">
      {CATALOG_SECTIONS.map((section) => (
        <StudioNavLink
          key={section.id}
          href={section.href}
          current={section.id === current}
        >
          {section.label}
        </StudioNavLink>
      ))}
    </nav>
  );
}

/** The closing line of every studio page: a drawn rule and one sentence. */
export function StudioFooter() {
  return (
    <footer className="studio-shell studio-footer">
      <p>some songs take you back.</p>
    </footer>
  );
}

/**
 * The studio's page furniture. Presentation only: it is rendered by pages
 * that have already authorized the request, and shows no private data. The
 * character illustration belongs to the public homepage and never appears
 * here.
 *
 * `layout` is "notebook" (a margin column and one writing column, the
 * default) or "wide" (the whole shell, for the journal and its editor).
 */
export function StudioFrame({
  current,
  layout = "notebook",
  children,
}: {
  current: StudioSection;
  layout?: "notebook" | "wide";
  children: ReactNode;
}) {
  return (
    <>
      <StudioHeader current={current} />
      <main
        id={STUDIO_CONTENT_ID}
        tabIndex={-1}
        className="studio-main"
        data-layout={layout}
      >
        {primaryOf(current) === "catalog" ? (
          <CatalogNav current={current} />
        ) : null}
        {children}
      </main>
      <StudioFooter />
    </>
  );
}
