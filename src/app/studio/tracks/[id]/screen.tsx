import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { accessDenied } from "@/app/studio/access";
import { StudioFrame } from "@/app/studio/frame";
import { Icon } from "@/app/studio/icons";
import { StatusMark } from "@/app/studio/status-mark";
import { StudioLoading } from "@/app/studio/studio-loading";
import { RecordControls } from "@/app/studio/record-controls";
import { studio } from "@/app/studio/studio-words";
import {
  archiveTrackAction,
  deleteTrackAction,
  restoreTrackAction,
} from "@/app/studio/tracks/actions";
import { TrackForm } from "@/app/studio/tracks/track-form";
import { initialTrackValues } from "@/app/studio/tracks/track-values";
import type { InterfaceLocale } from "@/i18n/locales";
import { getTrack, listArtists } from "@/modules/catalog";
import { authorizeAuthor } from "@/modules/identity";
import { listMemoriesOfRecording } from "@/modules/journals";

export function trackMetadata(locale: InterfaceLocale): Metadata {
  return { title: studio(locale).words.meta.track };
}

interface Props {
  params: Promise<{ id: string }>;
  locale: InterfaceLocale;
}

export function TrackScreen({ params, locale }: Props) {
  return (
    <Suspense fallback={<StudioLoading locale={locale} />}>
      <Track params={params} locale={locale} />
    </Suspense>
  );
}

async function Track({ params, locale }: Props) {
  const authorization = await authorizeAuthor(await headers());
  if (!authorization.ok) {
    return accessDenied(authorization.reason, locale);
  }
  const { words, href } = studio(locale);
  const w = words.track;
  const { id } = await params;
  const [track, artists, memories] = await Promise.all([
    getTrack(authorization.author, id),
    listArtists(authorization.author),
    listMemoriesOfRecording(authorization.author, id),
  ]);
  if (!track) {
    notFound();
  }
  // Pickers hide archived artists, but a credit that already exists stays.
  const credited = new Set(track.credits.map((credit) => credit.artistId));
  const artistOptions = artists
    .filter((artist) => !artist.archived || credited.has(artist.id))
    .map((artist) => ({
      value: artist.id,
      label: artist.archived
        ? words.album.archivedOption(artist.name)
        : artist.name,
    }));

  return (
    <StudioFrame
      locale={locale}
      path={`/studio/tracks/${track.id}`}
      current="tracks"
    >
      <p>
        <Link href={href("/studio/tracks")} className="studio-link">
          {w.back}
        </Link>
      </p>
      <h1 className="studio-title">{track.title}</h1>
      {track.archived ? <p className="studio-panel">{w.archived}</p> : null}

      <TrackForm
        trackId={track.id}
        initial={initialTrackValues({
          ...track,
          artistIds: track.credits.map((credit) => credit.artistId),
        })}
        artistOptions={artistOptions}
      />

      <section aria-labelledby="track-albums" className="space-y-3">
        <h2 id="track-albums" className="studio-section-title">
          {w.onAlbums}
        </h2>
        {track.albums.length === 0 ? (
          <p className="studio-hint">{w.noAlbum}</p>
        ) : (
          <ul className="studio-list">
            {track.albums.map((album) => (
              <li key={album.id} className="studio-row">
                <span className="studio-row-title">
                  <Link href={href(`/studio/albums/${album.id}`)}>
                    {album.title}
                  </Link>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="track-memories" className="space-y-3">
        <h2 id="track-memories" className="studio-section-title">
          {w.memories}
        </h2>
        {memories.length === 0 ? (
          <p className="studio-hint">{w.noMemory}</p>
        ) : (
          <ul className="studio-list" aria-label={w.memoriesLabel}>
            {memories.map((memory) => (
              <li key={memory.entryId} className="studio-row">
                <span className="studio-row-title">
                  <Link
                    href={href(`/studio/memories/${memory.entryId}`)}
                    lang={memory.locale}
                  >
                    {memory.title}
                  </Link>
                </span>
                <StatusMark locale={locale} status={memory.status} />
              </li>
            ))}
          </ul>
        )}
        {track.archived ? (
          <p className="studio-hint">{w.archivedNoMemory}</p>
        ) : (
          <p>
            <Link
              href={href(`/studio/memories/new?track=${track.id}`)}
              className="studio-button"
            >
              <Icon name="note" />
              {w.writeMemory}
            </Link>
          </p>
        )}
      </section>

      <section aria-labelledby="track-keep" className="space-y-3">
        <h2 id="track-keep" className="studio-section-title">
          {words.catalogRecord.archiveOrDelete}
        </h2>
        <RecordControls
          id={track.id}
          kind="track"
          archived={track.archived}
          archive={archiveTrackAction}
          restore={restoreTrackAction}
          remove={deleteTrackAction}
          archiveNote={w.archiveNote}
          afterDelete={href("/studio/tracks")}
        />
      </section>
    </StudioFrame>
  );
}
