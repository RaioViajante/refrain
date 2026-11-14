import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { Suspense } from "react";

import { accessDenied } from "@/app/studio/access";
import { ArtworkPlaceholder } from "@/app/studio/artwork-placeholder";
import { StudioFrame } from "@/app/studio/frame";
import { JournalCatalogMargin } from "@/app/studio/journals/journal-catalog-margin";
import { JournalEditor } from "@/app/studio/journals/journal-editor";
import { StudioLoading } from "@/app/studio/studio-loading";
import { studio } from "@/app/studio/studio-words";
import type { InterfaceLocale } from "@/i18n/locales";
import {
  getAlbumCover,
  listAlbumCovers,
  listAlbumsWithArtists,
  listAlbumTrackCounts,
} from "@/modules/catalog";
import { authorizeAuthor } from "@/modules/identity";

export function newJournalMetadata(locale: InterfaceLocale): Metadata {
  return { title: studio(locale).words.meta.newJournal };
}

interface Props {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
  locale: InterfaceLocale;
}

export function NewJournalScreen({ searchParams, locale }: Props) {
  return (
    <Suspense fallback={<StudioLoading locale={locale} />}>
      <NewJournal searchParams={searchParams} locale={locale} />
    </Suspense>
  );
}

async function NewJournal({ searchParams, locale }: Props) {
  const authorization = await authorizeAuthor(await headers());
  if (!authorization.ok) {
    return accessDenied(authorization.reason, locale);
  }
  const { words, href } = studio(locale);
  const w = words.newJournal;
  const { author } = authorization;
  const [albums, credits, covers] = await Promise.all([
    listAlbumTrackCounts(author),
    listAlbumsWithArtists(author),
    listAlbumCovers(author),
  ]);
  const choices = albums.filter((album) => !album.archived);
  // The album comes from the link, but only an album that exists and is not
  // archived is accepted: anything else shows the choice instead.
  const { album: requested } = await searchParams;
  const album = choices.find((candidate) => candidate.albumId === requested);
  const artists = credits
    .filter((credit) => credit.albumId === album?.albumId)
    .map((credit) => credit.artistName)
    .join(", ");
  // Whether the chosen album has a cover stored, shown or not.
  const cover = album ? await getAlbumCover(author, album.albumId) : null;

  return (
    <StudioFrame
      locale={locale}
      path={
        album
          ? `/studio/journals/new?album=${album.albumId}`
          : "/studio/journals/new"
      }
      current="journals"
      layout={album ? "wide" : "notebook"}
    >
      {album ? (
        <JournalEditor
          back={{ href: href("/studio/journals"), label: w.journals }}
          heading={
            <div className="studio-editor-head studio-editor-head-album">
              <ArtworkPlaceholder
                locale={locale}
                artwork={covers.get(album.albumId)}
                title={album.title}
                size={120}
              />
              <div>
                <h1 className="studio-title studio-title-editor">
                  {w.writeAbout(album.title)}
                </h1>
                {artists ? <p className="studio-meta">{artists}</p> : null}
              </div>
            </div>
          }
          catalog={
            <JournalCatalogMargin
              locale={locale}
              albumId={album.albumId}
              albumTitle={album.title}
              artistNames={artists}
              hasCover={cover?.stored ?? false}
              coverShown={covers.has(album.albumId)}
            />
          }
          create={{ albumId: album.albumId }}
          initial={{ opening: "", body: "" }}
        />
      ) : (
        <>
          <p>
            <Link href={href("/studio/journals")} className="studio-link">
              {w.back}
            </Link>
          </p>
          <h1 className="studio-title">{words.desk.writeJournal}</h1>
          {choices.length === 0 ? (
            <div className="studio-panel">
              <p className="studio-section-title">{w.albumFirst}</p>
              <p>{w.albumFirstBody}</p>
              <p>
                <Link
                  href={href("/studio/albums/new")}
                  className="studio-button"
                >
                  {words.albums.add}
                </Link>
              </p>
            </div>
          ) : (
            <>
              <p className="studio-lede">{w.which}</p>
              <ul className="studio-list" aria-label={words.frame.albums}>
                {choices.map((choice) => (
                  <li key={choice.albumId} className="studio-row">
                    <span className="studio-row-title">
                      <Link
                        href={href(
                          `/studio/journals/new?album=${choice.albumId}`,
                        )}
                      >
                        {choice.title}
                      </Link>
                    </span>
                    {choice.firstReleaseYear ? (
                      <span className="studio-meta">
                        {choice.firstReleaseYear}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </StudioFrame>
  );
}
