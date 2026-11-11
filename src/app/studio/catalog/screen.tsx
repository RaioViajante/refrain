import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { Suspense } from "react";

import { accessDenied } from "@/app/studio/access";
import { StudioFrame } from "@/app/studio/frame";
import { Icon, type IconName } from "@/app/studio/icons";
import { StudioLoading } from "@/app/studio/studio-loading";
import { studio } from "@/app/studio/studio-words";
import type { InterfaceLocale } from "@/i18n/locales";
import { getCatalogStatistics } from "@/modules/catalog";
import { authorizeAuthor } from "@/modules/identity";

// A fixed title: nothing from the catalog reaches page metadata.
export function catalogMetadata(locale: InterfaceLocale): Metadata {
  return { title: studio(locale).words.meta.catalog };
}

// The Catalog overview: the way into artists, albums and tracks. Every figure
// is a SQL aggregate computed by PostgreSQL on this request.
export function CatalogScreen({ locale }: { locale: InterfaceLocale }) {
  return (
    <Suspense fallback={<StudioLoading locale={locale} />}>
      <Catalog locale={locale} />
    </Suspense>
  );
}

async function Catalog({ locale }: { locale: InterfaceLocale }) {
  // The authorization boundary: checked on every request, before anything
  // below renders.
  const authorization = await authorizeAuthor(await headers());
  if (!authorization.ok) {
    return accessDenied(authorization.reason, locale);
  }
  const { words, href } = studio(locale);
  const w = words.catalog;
  const statistics = await getCatalogStatistics(authorization.author);
  const empty = statistics.artists === 0 && statistics.albums === 0;

  const sections: {
    name: string;
    icon: IconName;
    href: string;
    summary: string;
    add: { href: string; label: string };
  }[] = [
    {
      name: words.frame.artists,
      icon: "artist",
      href: href("/studio/artists"),
      summary: words.counts.artists(statistics.artists),
      add: { href: href("/studio/artists/new"), label: w.addArtist },
    },
    {
      name: words.frame.albums,
      icon: "album",
      href: href("/studio/albums"),
      summary: w.albumsSummary(
        statistics.albums,
        statistics.albumsWithoutTracks,
      ),
      add: { href: href("/studio/albums/new"), label: w.addAlbum },
    },
    {
      name: words.frame.tracks,
      icon: "note",
      href: href("/studio/tracks"),
      summary: w.tracksSummary(
        statistics.tracks,
        statistics.tracksWithoutAlbum,
      ),
      add: { href: href("/studio/tracks/new"), label: w.addTrack },
    },
  ];

  return (
    <StudioFrame locale={locale} path="/studio/catalog" current="catalog">
      <h1 className="studio-title">{w.title}</h1>
      <p className="studio-lede">{w.lead}</p>

      <p>
        <Link href={href("/studio/catalog/add")} className="studio-button">
          <Icon name="search" size={17} />
          {w.addMusic}
        </Link>
      </p>

      {empty ? (
        <div className="studio-panel">
          <p className="studio-section-title">{w.emptyTitle}</p>
          <p>
            {w.emptyStart}
            <Link href={href("/studio/catalog/add")} className="studio-link">
              {w.emptyFind}
            </Link>
            {w.emptyOr}
            <Link href={href("/studio/artists/new")} className="studio-link">
              {w.emptyByHand}
            </Link>
            {w.emptyEnd}
          </p>
        </div>
      ) : null}

      <ul className="studio-list" aria-label={w.areasLabel}>
        {sections.map((section) => (
          <li key={section.href} className="studio-row studio-entry">
            <span className="studio-thumb" data-bare aria-hidden="true">
              <Icon name={section.icon} size={26} />
            </span>
            <span className="studio-entry-body">
              <span className="studio-row-title">
                <Link href={section.href}>{section.name}</Link>
              </span>
              <span className="studio-meta">{section.summary}</span>
            </span>
            <span className="studio-entry-end">
              <Link href={section.add.href} className="studio-link">
                {section.add.label}
              </Link>
            </span>
          </li>
        ))}
      </ul>

      <p className="studio-hint">
        {w.archivedNote(statistics.archivedRecords)}
      </p>
    </StudioFrame>
  );
}
