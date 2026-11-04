import Link from "next/link";

import { publicFontClasses } from "@/app/public-fonts";

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
// The language selector arrives with its own milestone.

export type PublicSection = "home" | "albums" | "artists" | "memories";

/** The id that the skip link and every public page's <main> share. */
export const PUBLIC_CONTENT_ID = "main";

const SECTIONS: readonly {
  section: PublicSection;
  href: string;
  label: string;
}[] = [
  { section: "home", href: "/", label: "Home" },
  { section: "albums", href: "/albums", label: "Albums" },
  { section: "artists", href: "/artists", label: "Artists" },
  { section: "memories", href: "/memories", label: "Memories" },
];

export function PublicFrame({
  current,
  inside = false,
  children,
}: Readonly<{
  /** The section the page belongs to; none on the not-found view. */
  current?: PublicSection;
  /** True on a page inside the section rather than the section's own page. */
  inside?: boolean;
  children: React.ReactNode;
}>) {
  return (
    <div className={`${publicFontClasses} public`}>
      <a href={`#${PUBLIC_CONTENT_ID}`} className="public-skip">
        Skip to content
      </a>
      <header className="public-shell public-header">
        <nav aria-label="Main">
          <ul className="public-nav" role="list">
            {SECTIONS.map(({ section, href, label }) => (
              <li key={section}>
                <Link
                  className="public-link"
                  href={href}
                  aria-current={
                    current === section ? (inside ? "true" : "page") : undefined
                  }
                >
                  {label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </header>
      {children}
      <footer className="public-shell public-footer">
        <p className="public-closing">some songs take you back.</p>
      </footer>
    </div>
  );
}
