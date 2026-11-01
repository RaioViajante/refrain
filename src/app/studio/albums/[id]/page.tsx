import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import {
  archiveAlbumAction,
  deleteAlbumAction,
  restoreAlbumAction,
} from "@/app/studio/albums/actions";
import { AlbumForm } from "@/app/studio/albums/album-form";
import { TracklistEditor } from "@/app/studio/albums/tracklist-editor";
import { accessDenied } from "@/app/studio/access";
import { ArtworkPlaceholder } from "@/app/studio/artwork-placeholder";
import { formatDate, plural } from "@/app/studio/format";
import { StudioFrame } from "@/app/studio/frame";
import { StudioLoading } from "@/app/studio/studio-loading";
import { RecordControls } from "@/app/studio/record-controls";
import { StatusMark } from "@/app/studio/status-mark";
import {
  getAlbum,
  listAlbumUsage,
  listArtists,
  listTracks,
} from "@/modules/catalog";
import { authorizeAuthor } from "@/modules/identity";
import { listAlbumJournals } from "@/modules/journals";

export const metadata: Metadata = { title: "Album · refrain" };

export default function AlbumPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return (
    <Suspense fallback={<StudioLoading />}>
      <Album params={params} />
    </Suspense>
  );
}

async function Album({ params }: { params: Promise<{ id: string }> }) {
  const authorization = await authorizeAuthor(await headers());
  if (!authorization.ok) {
    return accessDenied(authorization.reason);
  }
  const { author } = authorization;
  const { id } = await params;
  const album = await getAlbum(author, id);
  if (!album) {
    notFound();
  }
  const [artists, tracks, journals, usage] = await Promise.all([
    listArtists(author),
    listTracks(author),
    listAlbumJournals(author, { albumId: album.id }),
    listAlbumUsage(author),
  ]);

  // Pickers hide archived artists, but a credit that already exists stays.
  const credited = new Set(album.credits.map((credit) => credit.artistId));
  const artistOptions = artists
    .filter((artist) => !artist.archived || credited.has(artist.id))
    .map((artist) => ({
      value: artist.id,
      label: artist.archived ? `${artist.name} (archived)` : artist.name,
    }));
  const onAlbum = new Set(album.tracklist.map((track) => track.trackId));
  const addable = tracks
    .filter((track) => !track.archived && !onAlbum.has(track.id))
    .map((track) => ({
      value: track.id,
      label: track.artistNames
        ? `${track.title} — ${track.artistNames}`
        : track.title,
    }));
  const usedIn = usage.find((row) => row.albumId === album.id)?.usedIn ?? 0;

  return (
    <StudioFrame current="albums">
      <p>
        <Link href="/studio/albums" className="studio-link">
          ← Albums
        </Link>
      </p>
      <div className="flex flex-wrap items-end gap-8">
        <ArtworkPlaceholder />
        <div className="space-y-2">
          <h1 className="studio-title">{album.title}</h1>
          <p className="studio-meta">
            {album.credits
              .map((credit) => credit.creditedAs ?? credit.artistName)
              .join(", ")}
            {album.firstReleaseYear ? ` · ${album.firstReleaseYear}` : ""}
            {` · ${plural(album.tracklist.length, "track")}`}
          </p>
        </div>
      </div>
      {album.archived ? (
        <p className="studio-panel">
          This album is archived: hidden from pickers, with its journals and
          tracklist kept.
        </p>
      ) : null}

      <section aria-labelledby="album-details" className="space-y-4">
        <h2 id="album-details" className="studio-section-title">
          Details
        </h2>
        <AlbumForm
          albumId={album.id}
          artistOptions={artistOptions}
          initial={{
            title: album.title,
            year: album.firstReleaseYear ? String(album.firstReleaseYear) : "",
            mbReleaseGroupId: album.mbReleaseGroupId ?? "",
            credits: album.credits.map((credit) => ({
              artistId: credit.artistId,
              creditedAs: credit.creditedAs ?? "",
            })),
            label: album.edition?.label ?? "",
            releaseDate: album.edition?.releaseDate ?? "",
            country: album.edition?.country ?? "",
          }}
        />
      </section>

      <section aria-labelledby="album-tracklist" className="space-y-4">
        <h2 id="album-tracklist" className="studio-section-title">
          Tracklist
        </h2>
        <TracklistEditor
          albumId={album.id}
          tracklist={album.tracklist}
          addable={addable}
          albumArtistIds={album.credits.map((credit) => credit.artistId)}
          readOnly={album.archived}
        />
      </section>

      <section aria-labelledby="album-journals" className="space-y-4">
        <h2 id="album-journals" className="studio-section-title">
          Journals about this album
        </h2>
        {journals.length === 0 ? (
          <p className="studio-hint">Nothing written about this album yet.</p>
        ) : (
          <ul className="studio-list">
            {journals.map((journal) => (
              <li key={journal.entryId} className="studio-row">
                <span className="studio-row-title">
                  <Link href={`/studio/journals/${journal.entryId}`}>
                    Journal started {formatDate(journal.createdAt)}
                  </Link>
                </span>
                <StatusMark status={journal.status} />
                <span className="studio-meta">
                  edited {formatDate(journal.updatedAt)}
                </span>
                <span
                  className="studio-meta"
                  style={{ flexBasis: "100%" }}
                  lang={journal.excerpt ? journal.locale : undefined}
                >
                  {journal.excerpt || "Nothing written yet"}
                </span>
              </li>
            ))}
          </ul>
        )}
        {album.archived ? null : (
          <p>
            <Link
              href={`/studio/journals/new?album=${album.id}`}
              className="studio-button"
            >
              Write a journal about this album
            </Link>
          </p>
        )}
      </section>

      <section aria-labelledby="album-keep" className="space-y-3">
        <h2 id="album-keep" className="studio-section-title">
          Archive or delete
        </h2>
        <RecordControls
          id={album.id}
          noun="album"
          archived={album.archived}
          archive={archiveAlbumAction}
          restore={restoreAlbumAction}
          remove={deleteAlbumAction}
          archiveNote={`Archiving hides the album from pickers and deletes nothing. ${plural(usedIn, "entry", "entries")} written about it stay as they are, showing its title as plain text. Its tracklist and credits are kept.`}
          afterDelete="/studio/albums"
        />
      </section>
    </StudioFrame>
  );
}
