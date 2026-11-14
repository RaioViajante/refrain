import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { accessDenied } from "@/app/studio/access";
import { ArtworkPlaceholder } from "@/app/studio/artwork-placeholder";
import { StudioFrame } from "@/app/studio/frame";
import { StudioLoading } from "@/app/studio/studio-loading";
import { studio } from "@/app/studio/studio-words";
import type { InterfaceLocale } from "@/i18n/locales";
import { listAlbumArtworkChoices } from "@/modules/catalog";
import { authorizeAuthor } from "@/modules/identity";

import { ArtworkChooser } from "./artwork-chooser";

export function artworkMetadata(locale: InterfaceLocale): Metadata {
  return { title: studio(locale).words.meta.artwork };
}

// An album's artwork (M3.2): the front covers the Cover Art Archive has for
// the album's MusicBrainz edition (or release group), and the author's choice.
// While a published journal shows the album, nothing here can change it
// (ADR 0006 D5, gate G8). While the cover display switch is off, no image is
// shown, the candidates are listed as text, and none can be chosen
// (docs/security.md § Deployment gate, item 6); removal is still offered.

interface Props {
  params: Promise<{ id: string }>;
  locale: InterfaceLocale;
}

export function ArtworkScreen({ params, locale }: Props) {
  return (
    <Suspense fallback={<StudioLoading locale={locale} />}>
      <Artwork params={params} locale={locale} />
    </Suspense>
  );
}

async function Artwork({ params, locale }: Props) {
  const authorization = await authorizeAuthor(await headers());
  if (!authorization.ok) {
    return accessDenied(authorization.reason, locale);
  }
  const { words, href } = studio(locale);
  const w = words.artworkPage;
  const { id } = await params;
  const artwork = await listAlbumArtworkChoices(authorization.author, id);
  if (!artwork) {
    notFound();
  }

  return (
    <StudioFrame
      locale={locale}
      path={`/studio/albums/${id}/artwork`}
      current="albums"
    >
      <p>
        <Link href={href(`/studio/albums/${id}`)} className="studio-link">
          ← {artwork.title}
        </Link>
      </p>
      <h1 className="studio-title">{w.title}</h1>
      <div className="flex flex-wrap items-end gap-8">
        <ArtworkPlaceholder
          locale={locale}
          artwork={artwork.current}
          title={artwork.title}
          size={220}
        />
        <p className="studio-meta">
          {artwork.current
            ? w.coverSource
            : artwork.coverStored
              ? w.coverHidden
              : w.noArtwork}
        </p>
      </div>

      {artwork.onPublicPage ? (
        <div className="studio-panel" role="status">
          <p className="studio-section-title">
            {words.photoPage.onPublicPageTitle}
          </p>
          <p>{w.onPublicPageBody}</p>
        </div>
      ) : artwork.archived ? (
        <div className="studio-panel" role="status">
          <p>{w.archived}</p>
        </div>
      ) : !artwork.linked ? (
        <div className="studio-panel" role="status">
          <p className="studio-section-title">{w.notLinkedTitle}</p>
          <p>
            {w.notLinkedStart}
            <Link href={href("/studio/catalog/add")} className="studio-link">
              {words.catalog.addMusic}
            </Link>
            {w.notLinkedEnd}
          </p>
        </div>
      ) : artwork.unavailable ? (
        <div className="studio-panel" role="alert">
          <p className="studio-section-title">{w.unreachableTitle}</p>
          <p>{w.unreachableBody}</p>
          <p>
            <Link
              href={href(`/studio/albums/${id}/artwork`)}
              className="studio-button"
            >
              {words.photoPage.tryAgain}
            </Link>
          </p>
        </div>
      ) : (
        <ArtworkChooser
          albumId={id}
          title={artwork.title}
          currentCover={artwork.currentCover}
          hasArtwork={artwork.coverStored}
          coverDisplay={artwork.coverDisplay}
          fromReleaseGroup={artwork.source === "release_group"}
          // Only these fields reach the browser: never a stored or canonical
          // cover address, and no image source while covers are off.
          choices={artwork.choices.map((choice) => ({
            releaseId: choice.releaseId,
            imageId: choice.imageId,
            types: choice.types,
            artwork: choice.artwork,
            current: choice.current,
          }))}
        />
      )}
      <p className="studio-hint">{w.source}</p>
    </StudioFrame>
  );
}
