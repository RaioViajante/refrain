import Link from "next/link";

import type { PublicArtistCard } from "@/modules/publication/public";

import {
  ArchiveEmpty,
  ArchiveFrame,
  ArchiveUnavailable,
} from "@/app/(archives)/_components/archive-frame";
import { artistCountLine } from "@/app/(archives)/_components/archive-lines";
import { dictionaryFor } from "@/i18n/dictionaries";
import type { InterfaceLocale } from "@/i18n/locales";
import { localizedHref } from "@/i18n/paths";

// The Artists archive (the approved V4.4 `Artists` screen, M3.8a): the
// screen's ruled list, one row per artist, the name in Kalam and a quiet count
// of the albums written about on the right. Only the artists whose page is
// served appear (ADR 0006 A5); each row opens that page.
//
// What the screen shows and this page does not, by the owner's decisions:
// the "With a journal" section (artist journals have no public reading
// contract), "Solo artist" and "Band" (the catalog's artist kind is not public),
// counts of memories (a memory never makes an artist public), and
// photographs (they stay on the artist's own page, with their credit).

// The page's lead is the owner's (M3.8a), in the dictionaries (src/i18n). The
// screen's own lead says that a memory brings an artist here, which is not
// true: only an album journal does.

export function ArtistsArchive({
  artists,
  locale,
}: Readonly<{
  artists: readonly PublicArtistCard[] | null;
  locale: InterfaceLocale;
}>) {
  const t = dictionaryFor(locale);
  return (
    <ArchiveFrame
      locale={locale}
      section="artists"
      title={t.archives.artists.title}
      lead={t.archives.artists.lead}
    >
      {artists === null ? (
        <ArchiveUnavailable locale={locale} />
      ) : artists.length === 0 ? (
        <ArchiveEmpty locale={locale} />
      ) : (
        <ul className="px-rows" role="list">
          {artists.map((artist) => (
            <li key={artist.address} className="px-row-item">
              <Link
                className="px-row"
                href={localizedHref(locale, `/artists/${artist.address}`)}
              >
                <span className="px-row-name">{artist.name}</span>{" "}
                <span className="px-row-meta">
                  {artistCountLine(locale, artist)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </ArchiveFrame>
  );
}
