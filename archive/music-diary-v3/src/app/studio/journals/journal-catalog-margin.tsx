import Link from "next/link";

import type { InterfaceLocale } from "@/i18n/locales";
import { localizedHref } from "@/i18n/paths";
import { studioWords } from "@/i18n/studio";

// The settings margin's catalog blocks, from the approved AlbumEditor screen:
// the album's facts with the way to its catalog record, and its artwork with
// the way to change it. The same on a new journal and on an existing one.

export function JournalCatalogMargin({
  locale,
  albumId,
  albumTitle,
  artistNames,
  hasCover,
  coverShown,
}: {
  locale: InterfaceLocale;
  albumId: string;
  albumTitle: string;
  artistNames: string;
  /** Whether a cover is stored, shown or not. */
  hasCover: boolean;
  /** Whether it is shown (the cover display switch is on). */
  coverShown: boolean;
}) {
  const w = studioWords(locale).journalMargin;
  return (
    <>
      <section aria-labelledby="editor-catalog" className="space-y-1">
        <h2 id="editor-catalog" className="studio-margin-title">
          {w.fromCatalog}
        </h2>
        <p className="studio-meta">
          {[artistNames, albumTitle].filter(Boolean).join(" · ")}
        </p>
        <p>
          <Link
            href={localizedHref(locale, `/studio/albums/${albumId}`)}
            className="studio-link studio-meta"
          >
            {w.editInCatalog}
          </Link>
        </p>
      </section>
      <section aria-labelledby="editor-artwork" className="space-y-1">
        <h2 id="editor-artwork" className="studio-margin-title">
          {w.artwork}
        </h2>
        <p className="studio-meta">
          {hasCover
            ? coverShown
              ? w.coverSource
              : w.coverHidden
            : w.noArtwork}
        </p>
        <p>
          <Link
            href={localizedHref(locale, `/studio/albums/${albumId}/artwork`)}
            className="studio-link studio-meta"
          >
            {w.change}
            <span className="studio-sr-only">{w.changeLabel}</span>
          </Link>
        </p>
      </section>
    </>
  );
}
