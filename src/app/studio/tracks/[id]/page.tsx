import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { accessDenied } from "@/app/studio/access";
import { StudioFrame } from "@/app/studio/frame";
import { StudioLoading } from "@/app/studio/studio-loading";
import { RecordControls } from "@/app/studio/record-controls";
import {
  archiveTrackAction,
  deleteTrackAction,
  restoreTrackAction,
} from "@/app/studio/tracks/actions";
import { TrackForm } from "@/app/studio/tracks/track-form";
import { initialTrackValues } from "@/app/studio/tracks/track-values";
import { getTrack, listArtists } from "@/modules/catalog";
import { authorizeAuthor } from "@/modules/identity";

export const metadata: Metadata = { title: "Track · refrain" };

export default function TrackPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return (
    <Suspense fallback={<StudioLoading />}>
      <Track params={params} />
    </Suspense>
  );
}

async function Track({ params }: { params: Promise<{ id: string }> }) {
  const authorization = await authorizeAuthor(await headers());
  if (!authorization.ok) {
    return accessDenied(authorization.reason);
  }
  const { id } = await params;
  const [track, artists] = await Promise.all([
    getTrack(authorization.author, id),
    listArtists(authorization.author),
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
      label: artist.archived ? `${artist.name} (archived)` : artist.name,
    }));

  return (
    <StudioFrame current="tracks">
      <p>
        <Link href="/studio/tracks" className="studio-link">
          ← Tracks
        </Link>
      </p>
      <h1 className="studio-title">{track.title}</h1>
      {track.archived ? (
        <p className="studio-panel">
          This track is archived: hidden from pickers, and kept on the albums it
          is already on.
        </p>
      ) : null}

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
          On these albums
        </h2>
        {track.albums.length === 0 ? (
          <p className="studio-hint">
            Not on an album. Add it from an album’s page.
          </p>
        ) : (
          <ul className="studio-list">
            {track.albums.map((album) => (
              <li key={album.id} className="studio-row">
                <span className="studio-row-title">
                  <Link href={`/studio/albums/${album.id}`}>{album.title}</Link>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="track-keep" className="space-y-3">
        <h2 id="track-keep" className="studio-section-title">
          Archive or delete
        </h2>
        <RecordControls
          id={track.id}
          noun="track"
          archived={track.archived}
          archive={archiveTrackAction}
          restore={restoreTrackAction}
          remove={deleteTrackAction}
          archiveNote="Archiving hides the track from pickers and deletes nothing. It stays on the albums it is already on, and any writing about it is untouched."
          afterDelete="/studio/tracks"
        />
      </section>
    </StudioFrame>
  );
}
