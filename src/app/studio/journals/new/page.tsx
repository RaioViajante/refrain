import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { Suspense } from "react";

import { accessDenied } from "@/app/studio/access";
import { StudioFrame } from "@/app/studio/frame";
import { JournalEditor } from "@/app/studio/journals/journal-editor";
import { StudioLoading } from "@/app/studio/studio-loading";
import { listAlbumsWithArtists, listAlbumTrackCounts } from "@/modules/catalog";
import { authorizeAuthor } from "@/modules/identity";

export const metadata: Metadata = { title: "Write a journal · refrain" };

export default function NewJournalPage({
  searchParams,
}: {
  searchParams: Promise<{ album?: string }>;
}) {
  return (
    <Suspense fallback={<StudioLoading />}>
      <NewJournal searchParams={searchParams} />
    </Suspense>
  );
}

async function NewJournal({
  searchParams,
}: {
  searchParams: Promise<{ album?: string }>;
}) {
  const authorization = await authorizeAuthor(await headers());
  if (!authorization.ok) {
    return accessDenied(authorization.reason);
  }
  const { author } = authorization;
  const [albums, credits] = await Promise.all([
    listAlbumTrackCounts(author),
    listAlbumsWithArtists(author),
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

  return (
    <StudioFrame current="journals" layout={album ? "wide" : "notebook"}>
      {album ? (
        <JournalEditor
          back={{ href: "/studio/journals", label: "Journals" }}
          heading={
            <div className="studio-editor-head">
              <h1 className="studio-title studio-title-editor">
                Write about {album.title}
              </h1>
              {artists ? <p className="studio-meta">{artists}</p> : null}
            </div>
          }
          create={{ albumId: album.albumId }}
          initial={{ opening: "", body: "" }}
        />
      ) : (
        <>
          <p>
            <Link href="/studio/journals" className="studio-link">
              ← Journals
            </Link>
          </p>
          <h1 className="studio-title">Write a journal</h1>
          {choices.length === 0 ? (
            <div className="studio-panel">
              <p className="studio-section-title">Add an album first</p>
              <p>A journal is written about an album in your catalog.</p>
              <p>
                <Link href="/studio/albums/new" className="studio-button">
                  Add an album
                </Link>
              </p>
            </div>
          ) : (
            <>
              <p className="studio-lede">Which album is it about?</p>
              <ul className="studio-list" aria-label="Albums">
                {choices.map((choice) => (
                  <li key={choice.albumId} className="studio-row">
                    <span className="studio-row-title">
                      <Link
                        href={`/studio/journals/new?album=${choice.albumId}`}
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
