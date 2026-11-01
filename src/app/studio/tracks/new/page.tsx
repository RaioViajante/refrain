import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { Suspense } from "react";

import { accessDenied } from "@/app/studio/access";
import { StudioFrame } from "@/app/studio/frame";
import { StudioLoading } from "@/app/studio/studio-loading";
import { initialTrackValues, TrackForm } from "@/app/studio/tracks/track-form";
import { listAlbumTrackCounts, listArtists } from "@/modules/catalog";
import { authorizeAuthor } from "@/modules/identity";

export const metadata: Metadata = { title: "Add a track · refrain" };

export default function NewTrackPage() {
  return (
    <Suspense fallback={<StudioLoading />}>
      <NewTrack />
    </Suspense>
  );
}

async function NewTrack() {
  const authorization = await authorizeAuthor(await headers());
  if (!authorization.ok) {
    return accessDenied(authorization.reason);
  }
  const [artists, albums] = await Promise.all([
    listArtists(authorization.author),
    listAlbumTrackCounts(authorization.author),
  ]);

  return (
    <StudioFrame current="tracks">
      <p>
        <Link href="/studio/tracks" className="studio-link">
          ← Tracks
        </Link>
      </p>
      <h1 className="studio-title">Add a track</h1>
      <TrackForm
        initial={initialTrackValues()}
        artistOptions={artists
          .filter((artist) => !artist.archived)
          .map((artist) => ({ value: artist.id, label: artist.name }))}
        albumOptions={albums
          .filter((album) => !album.archived)
          .map((album) => ({ value: album.albumId, label: album.title }))}
      />
    </StudioFrame>
  );
}
