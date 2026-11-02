import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { accessDenied } from "@/app/studio/access";
import { ArtworkPlaceholder } from "@/app/studio/artwork-placeholder";
import { StudioFrame } from "@/app/studio/frame";
import { StudioLoading } from "@/app/studio/studio-loading";
import { listAlbumArtworkChoices } from "@/modules/catalog";
import { authorizeAuthor } from "@/modules/identity";

import { ArtworkChooser } from "./artwork-chooser";

export const metadata: Metadata = { title: "Artwork · refrain" };

// An album's artwork (M3.2): the front covers the Cover Art Archive has for
// the album's MusicBrainz edition (or release group), and the author's choice.
// While a published journal shows the album, nothing here can change it
// (ADR 0006 D5, gate G8).

export default function ArtworkPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return (
    <Suspense fallback={<StudioLoading />}>
      <Artwork params={params} />
    </Suspense>
  );
}

async function Artwork({ params }: { params: Promise<{ id: string }> }) {
  const authorization = await authorizeAuthor(await headers());
  if (!authorization.ok) {
    return accessDenied(authorization.reason);
  }
  const { id } = await params;
  const artwork = await listAlbumArtworkChoices(authorization.author, id);
  if (!artwork) {
    notFound();
  }

  return (
    <StudioFrame current="albums">
      <p>
        <Link href={`/studio/albums/${id}`} className="studio-link">
          ← {artwork.title}
        </Link>
      </p>
      <h1 className="studio-title">Artwork</h1>
      <div className="flex flex-wrap items-end gap-8">
        <ArtworkPlaceholder
          artwork={artwork.current}
          title={artwork.title}
          size={220}
        />
        <p className="studio-meta">
          {artwork.current
            ? "Cover: Cover Art Archive"
            : "No artwork yet. The album shows the “no artwork yet” frame."}
        </p>
      </div>

      {artwork.onPublicPage ? (
        <div className="studio-panel" role="status">
          <p className="studio-section-title">Shown on a public page</p>
          <p>
            A published journal shows this album, so its artwork can’t change
            here: a change would reach readers without a confirmation, and that
            confirmation isn’t built yet. Unpublish the journal first if the
            artwork must change.
          </p>
        </div>
      ) : artwork.archived ? (
        <div className="studio-panel" role="status">
          <p>This album is archived. Restore it to change its artwork.</p>
        </div>
      ) : !artwork.linked ? (
        <div className="studio-panel" role="status">
          <p className="studio-section-title">Not linked to MusicBrainz</p>
          <p>
            Artwork comes from the Cover Art Archive, which needs to know which
            MusicBrainz album this is. Find it in{" "}
            <Link href="/studio/catalog/add" className="studio-link">
              Add music
            </Link>{" "}
            and choose “Link to this album”.
          </p>
        </div>
      ) : artwork.unavailable ? (
        <div className="studio-panel" role="alert">
          <p className="studio-section-title">
            Couldn’t reach the Cover Art Archive.
          </p>
          <p>
            Your catalog and your writing still work. Try again in a moment.
          </p>
          <p>
            <Link
              href={`/studio/albums/${id}/artwork`}
              className="studio-button"
            >
              Try again
            </Link>
          </p>
        </div>
      ) : (
        <ArtworkChooser
          albumId={id}
          title={artwork.title}
          currentCoverUrl={artwork.currentCoverUrl}
          hasArtwork={artwork.current !== null}
          fromReleaseGroup={artwork.source === "release_group"}
          choices={artwork.choices.map((choice) => ({
            releaseId: choice.releaseId,
            imageId: choice.imageId,
            src: choice.artwork.src,
            srcSet: choice.artwork.srcSet,
            current: choice.artwork.coverUrl === artwork.currentCoverUrl,
          }))}
        />
      )}
      <p className="studio-hint">
        Artwork from Cover Art Archive, added only if you choose it. Images are
        copyrighted by their owners.
      </p>
    </StudioFrame>
  );
}
