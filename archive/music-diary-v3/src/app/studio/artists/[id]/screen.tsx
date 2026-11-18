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
import { StudioFrame } from "@/app/studio/frame";
import { StudioLoading } from "@/app/studio/studio-loading";
import { RecordControls } from "@/app/studio/record-controls";
import { studio } from "@/app/studio/studio-words";
import type { InterfaceLocale } from "@/i18n/locales";
import { getArtist } from "@/modules/catalog";
import { authorizeAuthor } from "@/modules/identity";

export function artistMetadata(locale: InterfaceLocale): Metadata {
  return { title: studio(locale).words.meta.artist };
}

interface Props {
  params: Promise<{ id: string }>;
  locale: InterfaceLocale;
}

export function ArtistScreen({ params, locale }: Props) {
  return (
    <Suspense fallback={<StudioLoading locale={locale} />}>
      <Artist params={params} locale={locale} />
    </Suspense>
  );
}

async function Artist({ params, locale }: Props) {
  const authorization = await authorizeAuthor(await headers());
  if (!authorization.ok) {
    return accessDenied(authorization.reason, locale);
  }
  const { words, href } = studio(locale);
  const w = words.artist;
  const { id } = await params;
  const artist = await getArtist(authorization.author, id);
  if (!artist) {
    notFound();
  }

  return (
    <StudioFrame
      locale={locale}
      path={`/studio/artists/${artist.id}`}
      current="artists"
    >
      <p>
        <Link href={href("/studio/artists")} className="studio-link">
          {w.back}
        </Link>
      </p>
      <h1 className="studio-title">{artist.name}</h1>
      {artist.archived ? <p className="studio-panel">{w.archived}</p> : null}

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
          {w.photograph}{" "}
          <span className="studio-optional">({words.common.optional})</span>
        </h2>
        <figure className="studio-photo-figure">
          <PhotoFrame
            locale={locale}
            image={artist.photo.photo}
            name={artist.name}
          />
          {artist.photo.photo ? (
            <figcaption>
              <PhotoAttribution locale={locale} photo={artist.photo.photo} />
            </figcaption>
          ) : null}
        </figure>
        {artist.photo.unreadable ? (
          <p className="studio-hint" style={{ maxWidth: "62ch" }}>
            {w.photoUnreadable}
          </p>
        ) : artist.photo.photo ? null : (
          <p className="studio-hint">{w.noPhoto}</p>
        )}
        {artist.archived ? (
          <p className="studio-hint">{w.restoreToChangePhoto}</p>
        ) : null}
        <p>
          <Link
            href={href(`/studio/artists/${artist.id}/photo`)}
            className="studio-button"
          >
            {artist.photo.state === null ? w.choosePhoto : w.changePhoto}
          </Link>
        </p>
      </section>

      <section aria-labelledby="artist-albums" className="space-y-3">
        <h2 id="artist-albums" className="studio-section-title">
          {w.albums}
        </h2>
        {artist.albums.length === 0 ? (
          <p className="studio-hint">
            {w.noAlbums}
            <Link href={href("/studio/albums/new")} className="studio-link">
              {w.addAlbum}
            </Link>
            .
          </p>
        ) : (
          <ul className="studio-list">
            {artist.albums.map((album) => (
              <li key={album.id} className="studio-row">
                <span className="studio-row-title">
                  <Link href={href(`/studio/albums/${album.id}`)}>
                    {album.title}
                  </Link>
                </span>
                {album.firstReleaseYear ? (
                  <span className="studio-meta">{album.firstReleaseYear}</span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        <p className="studio-hint">
          {w.credited(artist.albumCount, artist.trackCount)}
        </p>
      </section>

      <section aria-labelledby="artist-keep" className="space-y-3">
        <h2 id="artist-keep" className="studio-section-title">
          {words.catalogRecord.archiveOrDelete}
        </h2>
        <RecordControls
          id={artist.id}
          kind="artist"
          archived={artist.archived}
          archive={archiveArtistAction}
          restore={restoreArtistAction}
          remove={deleteArtistAction}
          archiveNote={w.archiveNote(
            artist.albumCount,
            artist.trackCount,
            artist.journalCount,
          )}
          afterDelete={href("/studio/artists")}
        />
      </section>
    </StudioFrame>
  );
}
