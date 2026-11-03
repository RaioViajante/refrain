import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { accessDenied } from "@/app/studio/access";
import {
  archiveArtistAction,
  deleteArtistAction,
  restoreArtistAction,
} from "@/app/studio/artists/actions";
import { PhotoAttribution, PhotoFrame } from "@/app/studio/artist-photograph";
import { ArtistForm } from "@/app/studio/artists/artist-form";
import { plural } from "@/app/studio/format";
import { StudioFrame } from "@/app/studio/frame";
import { StudioLoading } from "@/app/studio/studio-loading";
import { RecordControls } from "@/app/studio/record-controls";
import { getArtist } from "@/modules/catalog";
import { authorizeAuthor } from "@/modules/identity";

export const metadata: Metadata = { title: "Artist · refrain" };

export default function ArtistPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return (
    <Suspense fallback={<StudioLoading />}>
      <Artist params={params} />
    </Suspense>
  );
}

async function Artist({ params }: { params: Promise<{ id: string }> }) {
  const authorization = await authorizeAuthor(await headers());
  if (!authorization.ok) {
    return accessDenied(authorization.reason);
  }
  const { id } = await params;
  const artist = await getArtist(authorization.author, id);
  if (!artist) {
    notFound();
  }

  return (
    <StudioFrame current="artists">
      <p>
        <Link href="/studio/artists" className="studio-link">
          ← Artists
        </Link>
      </p>
      <h1 className="studio-title">{artist.name}</h1>
      {artist.archived ? (
        <p className="studio-panel">
          This artist is archived: hidden from pickers, with everything written
          about them kept.
        </p>
      ) : null}

      <ArtistForm
        artistId={artist.id}
        initial={{
          name: artist.name,
          sortName: artist.sortName ?? "",
          kind: artist.kind,
          mbArtistId: artist.mbArtistId ?? "",
        }}
      />

      <section aria-labelledby="artist-photo" className="space-y-3">
        <h2 id="artist-photo" className="studio-section-title">
          Photograph <span className="studio-meta">(optional)</span>
        </h2>
        <figure className="studio-photo-figure">
          <PhotoFrame image={artist.photo.photo} name={artist.name} />
          {artist.photo.photo ? (
            <figcaption>
              <PhotoAttribution photo={artist.photo.photo} />
            </figcaption>
          ) : null}
        </figure>
        {artist.photo.unreadable ? (
          <p className="studio-hint" style={{ maxWidth: "62ch" }}>
            The photograph on file isn’t in the form Refrain writes, so it isn’t
            shown. Open the photograph page to remove it.
          </p>
        ) : artist.photo.photo ? null : (
          <p className="studio-hint">No photo. The page works without one.</p>
        )}
        {artist.archived ? (
          <p className="studio-hint">
            Restore the artist to change the photograph.
          </p>
        ) : null}
        <p>
          <Link
            href={`/studio/artists/${artist.id}/photo`}
            className="studio-button"
          >
            {artist.photo.state === null
              ? "Choose from Wikimedia Commons…"
              : "Change or remove the photograph…"}
          </Link>
        </p>
      </section>

      <section aria-labelledby="artist-albums" className="space-y-3">
        <h2 id="artist-albums" className="studio-section-title">
          Albums
        </h2>
        {artist.albums.length === 0 ? (
          <p className="studio-hint">
            No album credits this artist yet.{" "}
            <Link href="/studio/albums/new" className="studio-link">
              Add an album
            </Link>
            .
          </p>
        ) : (
          <ul className="studio-list">
            {artist.albums.map((album) => (
              <li key={album.id} className="studio-row">
                <span className="studio-row-title">
                  <Link href={`/studio/albums/${album.id}`}>{album.title}</Link>
                </span>
                {album.firstReleaseYear ? (
                  <span className="studio-meta">{album.firstReleaseYear}</span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        <p className="studio-hint">
          Credited on {plural(artist.albumCount, "album")} and{" "}
          {plural(artist.trackCount, "track")}.
        </p>
      </section>

      <section aria-labelledby="artist-keep" className="space-y-3">
        <h2 id="artist-keep" className="studio-section-title">
          Archive or delete
        </h2>
        <RecordControls
          id={artist.id}
          noun="artist"
          archived={artist.archived}
          archive={archiveArtistAction}
          restore={restoreArtistAction}
          remove={deleteArtistAction}
          archiveNote={`Archiving hides the artist from pickers and deletes nothing. ${plural(artist.albumCount, "album")} and ${plural(artist.trackCount, "track")} keep the credit, and ${plural(artist.journalCount, "journal")} written about the artist stay as they are, showing the name as plain text.`}
          afterDelete="/studio/artists"
        />
      </section>
    </StudioFrame>
  );
}
