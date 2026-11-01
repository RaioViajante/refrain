import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { Suspense } from "react";

import { accessDenied } from "@/app/studio/access";
import { plural } from "@/app/studio/format";
import { StudioFrame } from "@/app/studio/frame";
import { StudioLoading } from "@/app/studio/studio-loading";
import { listArtists, type ArtistSummary } from "@/modules/catalog";
import { authorizeAuthor } from "@/modules/identity";

// A fixed title: the studio never puts catalog or writing in page metadata.
export const metadata: Metadata = { title: "Artists · refrain" };

export default function ArtistsPage() {
  return (
    <Suspense fallback={<StudioLoading />}>
      <Artists />
    </Suspense>
  );
}

async function Artists() {
  const authorization = await authorizeAuthor(await headers());
  if (!authorization.ok) {
    return accessDenied(authorization.reason);
  }
  const artists = await listArtists(authorization.author);
  const active = artists.filter((artist) => !artist.archived);
  const archived = artists.filter((artist) => artist.archived);

  return (
    <StudioFrame current="artists">
      <h1 className="studio-title">Artists</h1>
      <p className="studio-lede">
        The people and bands behind the music you write about.
      </p>
      <p>
        <Link href="/studio/artists/new" className="studio-button">
          Add an artist
        </Link>
      </p>

      {artists.length === 0 ? (
        <div className="studio-panel">
          <p className="studio-section-title">No artists yet</p>
          <p>
            Everything starts with an artist or a band. Add one, then an album
            that credits them, and the music you love will have somewhere to
            live.
          </p>
        </div>
      ) : (
        <>
          <ArtistList artists={active} label="Artists" />
          {archived.length > 0 ? (
            <section aria-labelledby="archived-artists">
              <h2 id="archived-artists" className="studio-section-title">
                Archived
              </h2>
              <p className="studio-hint">
                Hidden from pickers. Their albums, tracks, and journals are
                untouched.
              </p>
              <ArtistList artists={archived} label="Archived artists" />
            </section>
          ) : null}
        </>
      )}
    </StudioFrame>
  );
}

function ArtistList({
  artists,
  label,
}: {
  artists: ArtistSummary[];
  label: string;
}) {
  return (
    <ul className="studio-list" aria-label={label}>
      {artists.map((artist) => (
        <li key={artist.id} className="studio-row">
          <span className="studio-row-title">
            <Link href={`/studio/artists/${artist.id}`}>{artist.name}</Link>
          </span>
          <span className="studio-meta">
            {artist.kind === "group" ? "Band" : "Person"} ·{" "}
            {plural(artist.albumCount, "album")} ·{" "}
            {plural(artist.trackCount, "track")} ·{" "}
            {plural(artist.journalCount, "journal")}
          </span>
        </li>
      ))}
    </ul>
  );
}
