import Link from "next/link";

import { publicFontClasses } from "@/app/public-fonts";

import "@/app/public.css";

// The public page furniture (docs/design-system.md § Page furniture): minimal,
// centered navigation with no logo, wordmark, or site name, and a centered,
// understated footer, and a skip link that is the first tab stop and shows
// only while it has keyboard focus. Only the destinations that exist are
// links: the lists (Albums, Artists, Memories) and the language selector
// arrive with their own pages, and a link to a page that is not there would
// be a broken promise. On the Home, "Home" is the current page.

export type PublicSection = "home" | "albums";

/** The id that the skip link and every public page's <main> share. */
export const PUBLIC_CONTENT_ID = "main";

export function PublicFrame({
  current,
  children,
}: Readonly<{ current?: PublicSection; children: React.ReactNode }>) {
  return (
    <div className={`${publicFontClasses} public`}>
      <a href={`#${PUBLIC_CONTENT_ID}`} className="public-skip">
        Skip to content
      </a>
      <header className="public-shell public-header">
        <nav aria-label="Main">
          <ul className="public-nav" role="list">
            <li>
              <Link
                className="public-link"
                href="/"
                aria-current={current === "home" ? "page" : undefined}
              >
                Home
              </Link>
            </li>
            {current === "albums" ? (
              <li>
                <span className="public-link" aria-current="page">
                  Albums
                </span>
              </li>
            ) : null}
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
