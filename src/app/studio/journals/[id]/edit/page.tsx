import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { accessDenied } from "@/app/studio/access";
import { ArtworkPlaceholder } from "@/app/studio/artwork-placeholder";
import { StudioFrame } from "@/app/studio/frame";
import { JournalEditor } from "@/app/studio/journals/journal-editor";
import { StudioLoading } from "@/app/studio/studio-loading";
import { getAlbumCover } from "@/modules/catalog";
import { authorizeAuthor } from "@/modules/identity";
import { getAlbumJournal, getTrackByTrack } from "@/modules/journals";

export const metadata: Metadata = { title: "Edit a journal · refrain" };

export default function EditJournalPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return (
    <Suspense fallback={<StudioLoading />}>
      <EditJournal params={params} />
    </Suspense>
  );
}

async function EditJournal({ params }: { params: Promise<{ id: string }> }) {
  const authorization = await authorizeAuthor(await headers());
  if (!authorization.ok) {
    return accessDenied(authorization.reason);
  }
  const { id } = await params;
  const journal = await getAlbumJournal(authorization.author, id);
  if (!journal) {
    notFound();
  }

  const back = (
    <p>
      <Link
        href={`/studio/journals/${journal.entryId}`}
        className="studio-link"
      >
        ← The journal
      </Link>
    </p>
  );

  if (journal.deletedAt !== null) {
    return (
      <StudioFrame current="journals">
        {back}
        <h1 className="studio-title">Edit a journal</h1>
        <p className="studio-panel">
          This journal is in Recently deleted, so it can’t be edited. Its
          writing is kept.
        </p>
      </StudioFrame>
    );
  }
  if (journal.body === null) {
    return (
      <StudioFrame current="journals">
        {back}
        <h1 className="studio-title">Edit a journal</h1>
        <p className="studio-panel">
          This text has formatting that the plain editor can’t show without
          losing it, so it can’t be edited here. It is untouched.
        </p>
      </StudioFrame>
    );
  }

  const [trackByTrack, cover] = await Promise.all([
    getTrackByTrack(authorization.author, id),
    getAlbumCover(authorization.author, journal.albumId),
  ]);

  return (
    <StudioFrame current="journals" layout="wide">
      <JournalEditor
        back={{
          href: `/studio/journals/${journal.entryId}`,
          label: "The journal",
        }}
        heading={
          <div className="studio-editor-head studio-editor-head-album">
            <ArtworkPlaceholder
              artwork={cover}
              title={journal.albumTitle}
              size={120}
            />
            <div>
              <p className="studio-meta">Editing your album journal</p>
              <h1 className="studio-title studio-title-editor">
                <span className="studio-sr-only">Editing: </span>
                {journal.albumTitle}
              </h1>
              {journal.artistNames ? (
                <p className="studio-meta">{journal.artistNames}</p>
              ) : null}
            </div>
          </div>
        }
        catalog={
          <>
            <section aria-labelledby="editor-catalog" className="space-y-1">
              <h2 id="editor-catalog" className="studio-margin-title">
                From your catalog
              </h2>
              <p className="studio-meta">
                {[journal.artistNames, journal.albumTitle]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
              <p>
                <Link
                  href={`/studio/albums/${journal.albumId}`}
                  className="studio-link studio-meta"
                >
                  Edit in catalog
                </Link>
              </p>
            </section>
            <section aria-labelledby="editor-artwork" className="space-y-1">
              <h2 id="editor-artwork" className="studio-margin-title">
                Artwork
              </h2>
              <p className="studio-meta">
                {cover ? "Cover Art Archive" : "No artwork yet"}
              </p>
              <p>
                <Link
                  href={`/studio/albums/${journal.albumId}/artwork`}
                  className="studio-link studio-meta"
                >
                  Change…
                  <span className="studio-sr-only"> the album’s artwork</span>
                </Link>
              </p>
            </section>
          </>
        }
        edit={{
          entryId: journal.entryId,
          version: journal.version,
          locale: journal.locale,
          status: journal.status,
          anyPublished: journal.versions.some(
            (version) => version.status === "published",
          ),
        }}
        initial={{ opening: journal.opening ?? "", body: journal.body }}
        tracks={trackByTrack?.tracks ?? []}
        albumRating={trackByTrack?.albumRating ?? null}
      />
    </StudioFrame>
  );
}
