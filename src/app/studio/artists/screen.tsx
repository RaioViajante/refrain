import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { Suspense } from "react";

import { accessDenied } from "@/app/studio/access";
import { ArtistThumb } from "@/app/studio/artist-photograph";
import { StudioFrame } from "@/app/studio/frame";
import { StudioLoading } from "@/app/studio/studio-loading";
import { studio, type StudioSpeech } from "@/app/studio/studio-words";
import type { InterfaceLocale } from "@/i18n/locales";
import {
  listArtistPhotos,
  listArtists,
  type ArtistPhotoImage,
  type ArtistSummary,
} from "@/modules/catalog";
import { authorizeAuthor } from "@/modules/identity";

// A fixed title: the studio never puts catalog or writing in page metadata.
export function artistsMetadata(locale: InterfaceLocale): Metadata {
  return { title: studio(locale).words.meta.artists };
}

export function ArtistsScreen({ locale }: { locale: InterfaceLocale }) {
  return (
    <Suspense fallback={<StudioLoading locale={locale} />}>
      <Artists locale={locale} />
    </Suspense>
  );
}

async function Artists({ locale }: { locale: InterfaceLocale }) {
  const authorization = await authorizeAuthor(await headers());
  if (!authorization.ok) {
    return accessDenied(authorization.reason, locale);
  }
  const speech = studio(locale);
  const { href } = speech;
  const w = speech.words.artists;
  const [artists, photos] = await Promise.all([
    listArtists(authorization.author),
    listArtistPhotos(authorization.author),
  ]);
  const active = artists.filter((artist) => !artist.archived);
  const archived = artists.filter((artist) => artist.archived);

  return (
    <StudioFrame locale={locale} path="/studio/artists" current="artists">
      <h1 className="studio-title">{w.title}</h1>
      <p className="studio-lede">{w.lead}</p>
      <p>
        <Link href={href("/studio/artists/new")} className="studio-button">
          {w.add}
        </Link>
      </p>

      {artists.length === 0 ? (
        <div className="studio-panel">
          <p className="studio-section-title">{w.emptyTitle}</p>
          <p>{w.emptyBody}</p>
        </div>
      ) : (
        <>
          <ArtistList
            speech={speech}
            artists={active}
            photos={photos}
            label={w.listLabel}
          />
          {archived.length > 0 ? (
            <section aria-labelledby="archived-artists">
              <h2 id="archived-artists" className="studio-section-title">
                {w.archived}
              </h2>
              <p className="studio-hint">{w.archivedHint}</p>
              <ArtistList
                speech={speech}
                artists={archived}
                photos={photos}
                label={w.archivedLabel}
              />
            </section>
          ) : null}
        </>
      )}
    </StudioFrame>
  );
}

function ArtistList({
  speech: { words, href },
  artists,
  photos,
  label,
}: {
  speech: StudioSpeech;
  artists: ArtistSummary[];
  photos: Map<string, ArtistPhotoImage>;
  label: string;
}) {
  return (
    <ul className="studio-list" aria-label={label}>
      {artists.map((artist) => (
        <li key={artist.id} className="studio-row studio-entry">
          <ArtistThumb image={photos.get(artist.id)} />
          <span className="studio-entry-body">
            <span className="studio-row-title">
              <Link href={href(`/studio/artists/${artist.id}`)}>
                {artist.name}
              </Link>
            </span>
            <span className="studio-meta">
              {artist.kind === "group"
                ? words.artists.band
                : words.artists.person}{" "}
              · {words.counts.albums(artist.albumCount)} ·{" "}
              {words.counts.tracks(artist.trackCount)} ·{" "}
              {words.counts.journals(artist.journalCount)}
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}
