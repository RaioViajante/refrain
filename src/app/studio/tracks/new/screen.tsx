import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { Suspense } from "react";

import { accessDenied } from "@/app/studio/access";
import { StudioFrame } from "@/app/studio/frame";
import { StudioLoading } from "@/app/studio/studio-loading";
import { studio } from "@/app/studio/studio-words";
import { TrackForm } from "@/app/studio/tracks/track-form";
import { initialTrackValues } from "@/app/studio/tracks/track-values";
import type { InterfaceLocale } from "@/i18n/locales";
import { listAlbumTrackCounts, listArtists } from "@/modules/catalog";
import { authorizeAuthor } from "@/modules/identity";

export function newTrackMetadata(locale: InterfaceLocale): Metadata {
  return { title: studio(locale).words.meta.newTrack };
}

export function NewTrackScreen({ locale }: { locale: InterfaceLocale }) {
  return (
    <Suspense fallback={<StudioLoading locale={locale} />}>
      <NewTrack locale={locale} />
    </Suspense>
  );
}

async function NewTrack({ locale }: { locale: InterfaceLocale }) {
  const authorization = await authorizeAuthor(await headers());
  if (!authorization.ok) {
    return accessDenied(authorization.reason, locale);
  }
  const { words, href } = studio(locale);
  const [artists, albums] = await Promise.all([
    listArtists(authorization.author),
    listAlbumTrackCounts(authorization.author),
  ]);

  return (
    <StudioFrame locale={locale} path="/studio/tracks/new" current="tracks">
      <p>
        <Link href={href("/studio/tracks")} className="studio-link">
          {words.track.back}
        </Link>
      </p>
      <h1 className="studio-title">{words.tracks.add}</h1>
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
