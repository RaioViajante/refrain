import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { Suspense } from "react";

import { accessDenied } from "@/app/studio/access";
import { plural } from "@/app/studio/format";
import { StudioFrame } from "@/app/studio/frame";
import { Icon, type IconName } from "@/app/studio/icons";
import { StudioLoading } from "@/app/studio/studio-loading";
import { getCatalogStatistics } from "@/modules/catalog";
import { authorizeAuthor } from "@/modules/identity";

// A fixed title: nothing from the catalog reaches page metadata.
export const metadata: Metadata = { title: "Catalog · refrain" };

// The Catalog overview: the way into artists, albums and tracks. Every figure
// is a SQL aggregate computed by PostgreSQL on this request.
export default function CatalogPage() {
  return (
    <Suspense fallback={<StudioLoading />}>
      <Catalog />
    </Suspense>
  );
}

async function Catalog() {
  // The authorization boundary: checked on every request, before anything
  // below renders.
  const authorization = await authorizeAuthor(await headers());
  if (!authorization.ok) {
    return accessDenied(authorization.reason);
  }
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
      name: "Artists",
      icon: "artist",
      href: "/studio/artists",
      summary: plural(statistics.artists, "artist"),
      add: { href: "/studio/artists/new", label: "Add an artist" },
    },
    {
      name: "Albums",
      icon: "album",
      href: "/studio/albums",
      summary: `${plural(statistics.albums, "album")} · ${plural(statistics.albumsWithoutTracks, "album")} without tracks`,
      add: { href: "/studio/albums/new", label: "Add an album" },
    },
    {
      name: "Tracks",
      icon: "note",
      href: "/studio/tracks",
      summary: `${plural(statistics.tracks, "track")} · ${plural(statistics.tracksWithoutAlbum, "track")} on no album`,
      add: { href: "/studio/tracks/new", label: "Add a track" },
    },
  ];

  return (
    <StudioFrame current="catalog">
      <h1 className="studio-title">Catalog</h1>
      <p className="studio-lede">
        The artists, albums and tracks your writing points to. Nothing here
        deletes writing.
      </p>

      <p>
        <Link href="/studio/catalog/add" className="studio-button">
          <Icon name="search" size={17} />
          Add music
        </Link>
      </p>

      {empty ? (
        <div className="studio-panel">
          <p className="studio-section-title">Nothing in the catalog yet</p>
          <p>
            Everything starts with an artist or a band.{" "}
            <Link href="/studio/catalog/add" className="studio-link">
              Find one on MusicBrainz
            </Link>{" "}
            or{" "}
            <Link href="/studio/artists/new" className="studio-link">
              add one by hand
            </Link>
            , then an album that credits them, and the music you love will have
            somewhere to live.
          </p>
        </div>
      ) : null}

      <ul className="studio-list" aria-label="Catalog areas">
        {sections.map((section) => (
          <li key={section.name} className="studio-row studio-entry">
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
        {plural(statistics.archivedRecords, "archived record")}. Archived
        records are hidden from pickers and stay attached to the writing that
        uses them.
      </p>
    </StudioFrame>
  );
}
