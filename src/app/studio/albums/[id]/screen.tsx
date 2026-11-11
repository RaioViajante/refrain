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
import { StudioFrame } from "@/app/studio/frame";
import { StudioLoading } from "@/app/studio/studio-loading";
import { RecordControls } from "@/app/studio/record-controls";
import { StatusMark } from "@/app/studio/status-mark";
import { studio } from "@/app/studio/studio-words";
import { formatDate } from "@/i18n/format";
import type { InterfaceLocale } from "@/i18n/locales";
import {
  getAlbum,
  listAlbumUsage,
  listArtists,
  listTracks,
} from "@/modules/catalog";
import { authorizeAuthor } from "@/modules/identity";
import { listAlbumJournals } from "@/modules/journals";

export function albumMetadata(locale: InterfaceLocale): Metadata {
  return { title: studio(locale).words.meta.album };
}

interface Props {
  params: Promise<{ id: string }>;
  locale: InterfaceLocale;
}

export function AlbumScreen({ params, locale }: Props) {
  return (
    <Suspense fallback={<StudioLoading locale={locale} />}>
      <Album params={params} locale={locale} />
    </Suspense>
  );
}

async function Album({ params, locale }: Props) {
  const authorization = await authorizeAuthor(await headers());
  if (!authorization.ok) {
    return accessDenied(authorization.reason, locale);
  }
  const { words, href } = studio(locale);
  const w = words.album;
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
      label: artist.archived ? w.archivedOption(artist.name) : artist.name,
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
    <StudioFrame
      locale={locale}
      path={`/studio/albums/${album.id}`}
      current="albums"
    >
      <p>
        <Link href={href("/studio/albums")} className="studio-link">
          {w.back}
        </Link>
      </p>
      <div className="flex flex-wrap items-end gap-8">
        <ArtworkPlaceholder
          locale={locale}
          artwork={album.artwork}
          title={album.title}
        />
        <div className="space-y-2">
          <h1 className="studio-title">{album.title}</h1>
          <p className="studio-meta">
            {album.credits
              .map((credit) => credit.creditedAs ?? credit.artistName)
              .join(", ")}
            {album.firstReleaseYear ? ` · ${album.firstReleaseYear}` : ""}
            {` · ${words.counts.tracks(album.tracklist.length)}`}
          </p>
        </div>
      </div>
      {album.archived ? <p className="studio-panel">{w.archived}</p> : null}

      <section aria-labelledby="album-details" className="space-y-4">
        <h2 id="album-details" className="studio-section-title">
          {w.details}
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

      <section aria-labelledby="album-artwork" className="space-y-3">
        <h2 id="album-artwork" className="studio-section-title">
          {w.artworkTitle}
        </h2>
        <p className="studio-hint" style={{ maxWidth: "62ch" }}>
          {album.artwork ? w.coverSource : w.noArtwork}
          {album.mbReleaseGroupId || album.edition?.mbReleaseId
            ? w.linked
            : w.notLinked}
        </p>
        <p>
          {album.mbReleaseGroupId || album.edition?.mbReleaseId ? (
            <Link
              href={href(`/studio/albums/${album.id}/artwork`)}
              className="studio-button"
            >
              {album.artwork ? w.changeArtwork : w.chooseArtwork}
            </Link>
          ) : (
            <Link
              href={href(
                `/studio/catalog/add?${new URLSearchParams({ q: album.title })}`,
              )}
              className="studio-button"
            >
              {w.findOnMusicBrainz}
            </Link>
          )}
        </p>
      </section>

      <section aria-labelledby="album-tracklist" className="space-y-4">
        <h2 id="album-tracklist" className="studio-section-title">
          {w.tracklist}
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
          {w.journalsTitle}
        </h2>
        {journals.length === 0 ? (
          <p className="studio-hint">{w.noJournals}</p>
        ) : (
          <ul className="studio-list">
            {journals.map((journal) => (
              <li key={journal.entryId} className="studio-row">
                <span className="studio-row-title">
                  <Link href={href(`/studio/journals/${journal.entryId}`)}>
                    {w.journalStarted(formatDate(locale, journal.createdAt))}
                  </Link>
                </span>
                <StatusMark locale={locale} status={journal.status} />
                <span className="studio-meta">
                  {w.edited(formatDate(locale, journal.updatedAt))}
                </span>
                <span
                  className="studio-meta"
                  style={{ flexBasis: "100%" }}
                  lang={journal.excerpt ? journal.locale : undefined}
                >
                  {journal.excerpt || w.nothingWritten}
                </span>
              </li>
            ))}
          </ul>
        )}
        {album.archived ? null : (
          <p>
            <Link
              href={href(`/studio/journals/new?album=${album.id}`)}
              className="studio-button"
            >
              {w.writeJournal}
            </Link>
          </p>
        )}
      </section>

      <section aria-labelledby="album-keep" className="space-y-3">
        <h2 id="album-keep" className="studio-section-title">
          {words.catalogRecord.archiveOrDelete}
        </h2>
        <RecordControls
          id={album.id}
          kind="album"
          archived={album.archived}
          archive={archiveAlbumAction}
          restore={restoreAlbumAction}
          remove={deleteAlbumAction}
          archiveNote={w.archiveNote(usedIn)}
          afterDelete={href("/studio/albums")}
        />
      </section>
    </StudioFrame>
  );
}
