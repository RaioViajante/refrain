import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { Suspense } from "react";

import { accessDenied } from "@/app/studio/access";
import { ArtistForm } from "@/app/studio/artists/artist-form";
import { StudioFrame } from "@/app/studio/frame";
import { StudioLoading } from "@/app/studio/studio-loading";
import { studio } from "@/app/studio/studio-words";
import type { InterfaceLocale } from "@/i18n/locales";
import { authorizeAuthor } from "@/modules/identity";

export function newArtistMetadata(locale: InterfaceLocale): Metadata {
  return { title: studio(locale).words.meta.newArtist };
}

export function NewArtistScreen({ locale }: { locale: InterfaceLocale }) {
  return (
    <Suspense fallback={<StudioLoading locale={locale} />}>
      <NewArtist locale={locale} />
    </Suspense>
  );
}

async function NewArtist({ locale }: { locale: InterfaceLocale }) {
  const authorization = await authorizeAuthor(await headers());
  if (!authorization.ok) {
    return accessDenied(authorization.reason, locale);
  }
  const { words, href } = studio(locale);
  return (
    <StudioFrame locale={locale} path="/studio/artists/new" current="artists">
      <p>
        <Link href={href("/studio/artists")} className="studio-link">
          {words.artist.back}
        </Link>
      </p>
      <h1 className="studio-title">{words.artists.add}</h1>
      <ArtistForm />
    </StudioFrame>
  );
}
