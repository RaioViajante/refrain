import type { ReactNode } from "react";

import { Icon } from "@/app/studio/icons";
import { StudioNavLink } from "@/app/studio/nav-link";
import { SignOutButton } from "@/app/studio/sign-out-button";

export type StudioSection =
  "desk" | "artists" | "albums" | "tracks" | "journals";

const SECTIONS: { id: StudioSection; label: string; href: string }[] = [
  { id: "desk", label: "Desk", href: "/studio" },
  { id: "artists", label: "Artists", href: "/studio/artists" },
  { id: "albums", label: "Albums", href: "/studio/albums" },
  { id: "tracks", label: "Tracks", href: "/studio/tracks" },
  { id: "journals", label: "Journals", href: "/studio/journals" },
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
  return (
    <header className="studio-header">
      <a href={`#${STUDIO_CONTENT_ID}`} className="studio-skip">
        Skip to the content
      </a>
      <div className="studio-shell studio-header-bar">
        <p className="studio-header-label">
          <Icon name="studio" size={16} />
          Writing studio
        </p>
        {current ? (
          <>
            <nav className="studio-nav" aria-label="Writing studio">
              {SECTIONS.map((section) => (
                <StudioNavLink
                  key={section.id}
                  href={section.href}
                  current={section.id === current}
                >
                  {section.label}
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
      <main id={STUDIO_CONTENT_ID} className="studio-main" data-layout={layout}>
        {children}
      </main>
      <StudioFooter />
    </>
  );
}
