import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { Suspense } from "react";

import { accessDenied } from "@/app/studio/access";
import { plural } from "@/app/studio/format";
import { StudioFrame } from "@/app/studio/frame";
import { StudioLoading } from "@/app/studio/studio-loading";
import {
  listAlbumsWithArtists,
  listAlbumTrackCounts,
  listAlbumUsage,
} from "@/modules/catalog";
import { authorizeAuthor } from "@/modules/identity";

export const metadata: Metadata = { title: "Albums · refrain" };

export default function AlbumsPage() {
  return (
    <Suspense fallback={<StudioLoading />}>
      <Albums />
    </Suspense>
  );
}

async function Albums() {
  const authorization = await authorizeAuthor(await headers());
  if (!authorization.ok) {
    return accessDenied(authorization.reason);
  }
  const { author } = authorization;
  // Three SQL queries, each one the evidence for an academic requirement:
  // the albums with their credited artists (a JOIN, AC-04), the tracks on each
  // album (a COUNT with GROUP BY, AC-05), and how many entries use each album
  // (a subquery, AC-05). The page only arranges what PostgreSQL returned.
  const [credits, counts, usage] = await Promise.all([
    listAlbumsWithArtists(author),
    listAlbumTrackCounts(author),
    listAlbumUsage(author),
  ]);

  const artistsByAlbum = new Map<string, string[]>();
  for (const credit of credits) {
    artistsByAlbum.set(credit.albumId, [
      ...(artistsByAlbum.get(credit.albumId) ?? []),
      credit.artistName,
    ]);
  }
  const usedIn = new Map(usage.map((row) => [row.albumId, row.usedIn]));
  const active = counts.filter((album) => !album.archived);
  const archived = counts.filter((album) => album.archived);

  const row = (album: (typeof counts)[number]) => (
    <li key={album.albumId} className="studio-row">
      <span className="studio-row-title">
        <Link href={`/studio/albums/${album.albumId}`}>{album.title}</Link>
      </span>
      <span className="studio-meta">
        {[
          artistsByAlbum.get(album.albumId)?.join(", ") ?? "no credited artist",
          album.firstReleaseYear ? String(album.firstReleaseYear) : "",
          plural(album.trackCount, "track"),
          album.archived
            ? ""
            : `used in ${plural(usedIn.get(album.albumId) ?? 0, "entry", "entries")}`,
        ]
          .filter(Boolean)
          .join(" · ")}
      </span>
    </li>
  );

  return (
    <StudioFrame current="albums">
      <h1 className="studio-title">Albums</h1>
      <p className="studio-lede">
        Each album is the work itself, with the release that sets its track
        order. Journals are written about albums.
      </p>
      <p>
        <Link href="/studio/albums/new" className="studio-button">
          Add an album
        </Link>
      </p>

      {counts.length === 0 ? (
        <div className="studio-panel">
          <p className="studio-section-title">No albums yet</p>
          <p>
            Add an album, credit it to an artist, and build its tracklist. Then
            you can write a journal about it.
          </p>
        </div>
      ) : (
        <>
          <ul className="studio-list" aria-label="Albums">
            {active.map(row)}
          </ul>
          {archived.length > 0 ? (
            <section aria-labelledby="archived-albums">
              <h2 id="archived-albums" className="studio-section-title">
                Archived
              </h2>
              <p className="studio-hint">
                Hidden from pickers. Their journals are untouched.
              </p>
              <ul className="studio-list" aria-label="Archived albums">
                {archived.map(row)}
              </ul>
            </section>
          ) : null}
        </>
      )}
    </StudioFrame>
  );
}
