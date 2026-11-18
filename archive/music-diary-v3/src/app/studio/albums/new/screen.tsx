import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { Suspense } from "react";

import { AlbumForm } from "@/app/studio/albums/album-form";
import { emptyAlbum } from "@/app/studio/albums/album-values";
import { accessDenied } from "@/app/studio/access";
import { StudioFrame } from "@/app/studio/frame";
import { StudioLoading } from "@/app/studio/studio-loading";
import { studio } from "@/app/studio/studio-words";
import type { InterfaceLocale } from "@/i18n/locales";
import { listArtists } from "@/modules/catalog";
import { authorizeAuthor } from "@/modules/identity";

export function newAlbumMetadata(locale: InterfaceLocale): Metadata {
  return { title: studio(locale).words.meta.newAlbum };
}

interface Props {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
  locale: InterfaceLocale;
}

export function NewAlbumScreen({ searchParams, locale }: Props) {
  return (
    <Suspense fallback={<StudioLoading locale={locale} />}>
      <NewAlbum searchParams={searchParams} locale={locale} />
    </Suspense>
  );
}

async function NewAlbum({ searchParams, locale }: Props) {
  const authorization = await authorizeAuthor(await headers());
  if (!authorization.ok) {
    return accessDenied(authorization.reason, locale);
  }
  const { words, href } = studio(locale);
  const artists = (await listArtists(authorization.author)).filter(
    (artist) => !artist.archived,
  );
  // A link from an artist's page can name the first credit. It is only used if
  // it is one of the artists listed above.
  const { artist } = await searchParams;
  const preselected = artists.find((candidate) => candidate.id === artist);

  return (
    <StudioFrame locale={locale} path="/studio/albums/new" current="albums">
      <p>
        <Link href={href("/studio/albums")} className="studio-link">
          {words.album.back}
        </Link>
      </p>
      <h1 className="studio-title">{words.albums.add}</h1>
      <AlbumForm
        initial={{
          ...emptyAlbum,
          credits: [{ artistId: preselected?.id ?? "", creditedAs: "" }],
        }}
        artistOptions={artists.map((candidate) => ({
          value: candidate.id,
          label: candidate.name,
        }))}
      />
    </StudioFrame>
  );
}
