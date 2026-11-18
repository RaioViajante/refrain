import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { Suspense } from "react";

import { accessDenied } from "@/app/studio/access";
import { AlbumThumb } from "@/app/studio/artwork-placeholder";
import { StudioFrame } from "@/app/studio/frame";
import { StudioLoading } from "@/app/studio/studio-loading";
import { studio } from "@/app/studio/studio-words";
import type { InterfaceLocale } from "@/i18n/locales";
import {
  listAlbumCovers,
  listAlbumsWithArtists,
  listAlbumTrackCounts,
  listAlbumUsage,
} from "@/modules/catalog";
import { authorizeAuthor } from "@/modules/identity";

export function albumsMetadata(locale: InterfaceLocale): Metadata {
  return { title: studio(locale).words.meta.albums };
}

export function AlbumsScreen({ locale }: { locale: InterfaceLocale }) {
  return (
    <Suspense fallback={<StudioLoading locale={locale} />}>
      <Albums locale={locale} />
    </Suspense>
  );
}

async function Albums({ locale }: { locale: InterfaceLocale }) {
  const authorization = await authorizeAuthor(await headers());
  if (!authorization.ok) {
    return accessDenied(authorization.reason, locale);
  }
  const { words, href } = studio(locale);
  const w = words.albums;
  const { author } = authorization;
  // Three SQL queries, each one the evidence for an academic requirement:
  // the albums with their credited artists (a JOIN, AC-04), the tracks on each
  // album (a COUNT with GROUP BY, AC-05), and how many entries use each album
  // (a subquery, AC-05). The page only arranges what PostgreSQL returned.
  const [credits, counts, usage, covers] = await Promise.all([
    listAlbumsWithArtists(author),
    listAlbumTrackCounts(author),
    listAlbumUsage(author),
    listAlbumCovers(author),
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
    <li key={album.albumId} className="studio-row studio-entry">
      <AlbumThumb artwork={covers.get(album.albumId)} />
      <span className="studio-entry-body">
        <span className="studio-row-title">
          <Link href={href(`/studio/albums/${album.albumId}`)}>
            {album.title}
          </Link>
        </span>
        <span className="studio-meta">
          {[
            artistsByAlbum.get(album.albumId)?.join(", ") ?? w.noArtist,
            album.firstReleaseYear ? String(album.firstReleaseYear) : "",
            words.counts.tracks(album.trackCount),
            album.archived ? "" : w.usedIn(usedIn.get(album.albumId) ?? 0),
          ]
            .filter(Boolean)
            .join(" · ")}
        </span>
      </span>
    </li>
  );

  return (
    <StudioFrame locale={locale} path="/studio/albums" current="albums">
      <h1 className="studio-title">{w.title}</h1>
      <p className="studio-lede">{w.lead}</p>
      <p>
        <Link href={href("/studio/albums/new")} className="studio-button">
          {w.add}
        </Link>
      </p>

      {counts.length === 0 ? (
        <div className="studio-panel">
          <p className="studio-section-title">{w.emptyTitle}</p>
          <p>{w.emptyBody}</p>
        </div>
      ) : (
        <>
          <ul className="studio-list" aria-label={w.listLabel}>
            {active.map(row)}
          </ul>
          {archived.length > 0 ? (
            <section aria-labelledby="archived-albums">
              <h2 id="archived-albums" className="studio-section-title">
                {w.archived}
              </h2>
              <p className="studio-hint">{w.archivedHint}</p>
              <ul className="studio-list" aria-label={w.archivedLabel}>
                {archived.map(row)}
              </ul>
            </section>
          ) : null}
        </>
      )}
    </StudioFrame>
  );
}
