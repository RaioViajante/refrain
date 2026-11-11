import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { accessDenied } from "@/app/studio/access";
import { ArtworkPlaceholder } from "@/app/studio/artwork-placeholder";
import { StudioFrame } from "@/app/studio/frame";
import { JournalCatalogMargin } from "@/app/studio/journals/journal-catalog-margin";
import { JournalEditor } from "@/app/studio/journals/journal-editor";
import { StudioLoading } from "@/app/studio/studio-loading";
import { studio } from "@/app/studio/studio-words";
import type { InterfaceLocale } from "@/i18n/locales";
import { getAlbumCover } from "@/modules/catalog";
import { authorizeAuthor } from "@/modules/identity";
import { getAlbumJournal, getTrackByTrack } from "@/modules/journals";

export function editJournalMetadata(locale: InterfaceLocale): Metadata {
  return { title: studio(locale).words.meta.editJournal };
}

interface Props {
  params: Promise<{ id: string }>;
  locale: InterfaceLocale;
}

export function EditJournalScreen({ params, locale }: Props) {
  return (
    <Suspense fallback={<StudioLoading locale={locale} />}>
      <EditJournal params={params} locale={locale} />
    </Suspense>
  );
}

async function EditJournal({ params, locale }: Props) {
  const authorization = await authorizeAuthor(await headers());
  if (!authorization.ok) {
    return accessDenied(authorization.reason, locale);
  }
  const { words, href } = studio(locale);
  const w = words.editJournal;
  const { id } = await params;
  const journal = await getAlbumJournal(authorization.author, id);
  if (!journal) {
    notFound();
  }

  const back = (
    <p>
      <Link
        href={href(`/studio/journals/${journal.entryId}`)}
        className="studio-link"
      >
        {w.back}
      </Link>
    </p>
  );
  const path = `/studio/journals/${journal.entryId}/edit`;

  if (journal.deletedAt !== null) {
    return (
      <StudioFrame locale={locale} path={path} current="journals">
        {back}
        <h1 className="studio-title">{w.title}</h1>
        <p className="studio-panel">{w.deleted}</p>
      </StudioFrame>
    );
  }
  if (journal.body === null) {
    return (
      <StudioFrame locale={locale} path={path} current="journals">
        {back}
        <h1 className="studio-title">{w.title}</h1>
        <p className="studio-panel">{w.unsupported}</p>
      </StudioFrame>
    );
  }

  const [trackByTrack, cover] = await Promise.all([
    getTrackByTrack(authorization.author, id),
    getAlbumCover(authorization.author, journal.albumId),
  ]);

  return (
    <StudioFrame locale={locale} path={path} current="journals" layout="wide">
      <JournalEditor
        back={{
          href: href(`/studio/journals/${journal.entryId}`),
          label: w.theJournal,
        }}
        heading={
          <div className="studio-editor-head studio-editor-head-album">
            <ArtworkPlaceholder
              locale={locale}
              artwork={cover}
              title={journal.albumTitle}
              size={120}
            />
            <div>
              <p className="studio-meta">{w.editing}</p>
              <h1 className="studio-title studio-title-editor">
                <span className="studio-sr-only">{w.editingLabel}</span>
                {journal.albumTitle}
              </h1>
              {journal.artistNames ? (
                <p className="studio-meta">{journal.artistNames}</p>
              ) : null}
            </div>
          </div>
        }
        catalog={
          <JournalCatalogMargin
            locale={locale}
            albumId={journal.albumId}
            albumTitle={journal.albumTitle}
            artistNames={journal.artistNames}
            hasCover={cover !== null}
          />
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
