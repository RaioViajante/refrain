import Link from "next/link";

import type {
  PublicArtist,
  PublicArtistAlbum,
  PublicArtistTrack,
} from "@/modules/publication/public";

import {
  ArtistPhotoCredit,
  ArtistPhotoFrame,
} from "@/app/(public)/_components/artist-photograph";
import { Artwork } from "@/app/(public)/_components/home-view";
import { PersonIcon } from "@/app/(public)/_components/person-icon";
import { PUBLIC_CONTENT_ID } from "@/app/(public)/_components/public-frame";
import { RecordIcon } from "@/app/(public)/_components/record-icon";

// The public artist page (M3.5; the approved V4.4 `Artist` screen). It renders
// only what the Publication read model returned: the artist's name, the
// photograph the author chose with its attribution, and the album journals
// and track reflections that are already public. It has no author control.
//
// The approved screen is an artist *journal*: an opening sentence, an essay,
// "Last edited", "Written in", and a facts line about the artist. Artist
// journals have no public reading contract yet, and the catalog holds no
// biography, so the page shows less, never something invented: the name, the
// photograph, and "In this journal" (docs/design-system.md § Public artist
// page).

const albumAddress = (slug: string) => `/albums/${slug}`;

function AlbumRow({ album }: Readonly<{ album: PublicArtistAlbum }>) {
  const year = album.firstReleaseYear ? String(album.firstReleaseYear) : null;
  return (
    <li>
      <Link className="pa-album" href={albumAddress(album.slug)}>
        <Artwork
          artwork={album.artwork}
          className="ph-art pa-album-art"
          sizes="120px"
          fallback={<RecordIcon className="ph-art-icon" size={22} />}
        />
        <span className="pa-album-text">
          <span className="pa-album-title">{album.title}</span>{" "}
          <span className="pa-album-facts">
            {year ? `${year}` : null}
            {year && album.trackCount > 0 ? " · " : null}
            {album.trackCount > 0 ? (
              <>
                <span aria-hidden="true">{`${album.writtenTrackCount} / ${album.trackCount} tracks`}</span>
                <span className="pj-visually-hidden">{`${album.writtenTrackCount} of ${album.trackCount} tracks written about`}</span>
              </>
            ) : null}
          </span>
        </span>
      </Link>
    </li>
  );
}

function TrackRow({ track }: Readonly<{ track: PublicArtistTrack }>) {
  const where =
    track.number === null
      ? `in ${track.albumTitle}`
      : `in ${track.albumTitle} · ${String(track.number).padStart(2, "0")}`;
  return (
    <li className="pa-track-item">
      <Link className="pa-track" href={`${albumAddress(track.slug)}#tracks`}>
        <span className="pa-track-title">{track.title}</span>{" "}
        <span className="pa-track-where">{where}</span>
      </Link>
    </li>
  );
}

export function ArtistView({ artist }: Readonly<{ artist: PublicArtist }>) {
  return (
    <main className="public-shell pj pa" id={PUBLIC_CONTENT_ID} tabIndex={-1}>
      <article className="pj-grid pa-grid">
        <figure className="pa-figure">
          <ArtistPhotoFrame name={artist.name} photo={artist.photo} />
          {artist.photo ? (
            <figcaption>
              <ArtistPhotoCredit photo={artist.photo} />
            </figcaption>
          ) : null}
        </figure>
        <header className="pj-head pa-head">
          <p className="pj-kind">
            <PersonIcon />
            Artist
          </p>
          <h1 className="pj-title pa-title">{artist.name}</h1>
        </header>
      </article>

      <section className="pj-grid pa-section" aria-labelledby="pa-in-journal">
        <div className="pa-margin">
          <h2 id="pa-in-journal">In this journal</h2>
        </div>
        <div className="pa-lists">
          <h3 id="pa-albums" className="pa-list-title">
            Album journals
          </h3>
          <ul className="pa-albums" role="list" aria-labelledby="pa-albums">
            {artist.albums.map((album) => (
              <AlbumRow key={album.slug} album={album} />
            ))}
          </ul>
          {artist.tracks.length > 0 ? (
            <>
              <h3 id="pa-tracks" className="pa-list-title">
                Tracks I wrote about
              </h3>
              <ul className="pa-tracks" role="list" aria-labelledby="pa-tracks">
                {artist.tracks.map((track) => (
                  <TrackRow
                    key={`${track.slug}:${track.number ?? ""}:${track.title}`}
                    track={track}
                  />
                ))}
              </ul>
            </>
          ) : null}
        </div>
      </section>
    </main>
  );
}
