import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { Suspense } from "react";

import { accessDenied } from "@/app/studio/access";
import { formatDuration, plural } from "@/app/studio/format";
import { StudioFrame } from "@/app/studio/frame";
import { StudioLoading } from "@/app/studio/studio-loading";
import { listTracks, type TrackSummary } from "@/modules/catalog";
import { authorizeAuthor } from "@/modules/identity";

export const metadata: Metadata = { title: "Tracks · refrain" };

export default function TracksPage() {
  return (
    <Suspense fallback={<StudioLoading />}>
      <Tracks />
    </Suspense>
  );
}

async function Tracks() {
  const authorization = await authorizeAuthor(await headers());
  if (!authorization.ok) {
    return accessDenied(authorization.reason);
  }
  const tracks = await listTracks(authorization.author);
  const active = tracks.filter((track) => !track.archived);
  const archived = tracks.filter((track) => track.archived);

  return (
    <StudioFrame current="tracks">
      <h1 className="studio-title">Tracks</h1>
      <p className="studio-lede">
        Every recording in your catalog. One recording can be on several albums
        without being copied.
      </p>
      <p>
        <Link href="/studio/tracks/new" className="studio-button">
          Add a track
        </Link>
      </p>

      {tracks.length === 0 ? (
        <div className="studio-panel">
          <p className="studio-section-title">No tracks yet</p>
          <p>
            Add tracks here, or build an album’s tracklist and create them as
            you go.
          </p>
        </div>
      ) : (
        <>
          <TrackList tracks={active} label="Tracks" />
          {archived.length > 0 ? (
            <section aria-labelledby="archived-tracks">
              <h2 id="archived-tracks" className="studio-section-title">
                Archived
              </h2>
              <TrackList tracks={archived} label="Archived tracks" />
            </section>
          ) : null}
        </>
      )}
    </StudioFrame>
  );
}

function TrackList({
  tracks,
  label,
}: {
  tracks: TrackSummary[];
  label: string;
}) {
  return (
    <ul className="studio-list" aria-label={label}>
      {tracks.map((track) => (
        <li key={track.id} className="studio-row">
          <span className="studio-row-title">
            <Link href={`/studio/tracks/${track.id}`}>{track.title}</Link>
          </span>
          <span className="studio-meta">
            {[
              track.artistNames,
              formatDuration(track.lengthMs),
              track.albumCount === 0
                ? "not on an album"
                : `on ${plural(track.albumCount, "album")}`,
            ]
              .filter(Boolean)
              .join(" · ")}
          </span>
        </li>
      ))}
    </ul>
  );
}
