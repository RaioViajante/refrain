import { headers } from "next/headers";
import Link from "next/link";
import { Suspense } from "react";

import { accessDenied } from "@/app/studio/access";
import { plural } from "@/app/studio/format";
import { StudioFrame } from "@/app/studio/frame";
import { StudioLoading } from "@/app/studio/studio-loading";
import { getCatalogStatistics } from "@/modules/catalog";
import { authorizeAuthor } from "@/modules/identity";
import {
  getJournalStatistics,
  listAlbumJournalProgress,
} from "@/modules/journals";

// The Writing Studio's desk. Every figure on it is a SQL aggregate computed by
// PostgreSQL on this request: nothing is counted in JavaScript or cached.
export default function StudioPage() {
  return (
    <Suspense fallback={<StudioLoading />}>
      <Desk />
    </Suspense>
  );
}

async function Desk() {
  // The authorization boundary: a valid database session of the configured
  // author, checked on every request. Nothing below renders otherwise.
  const authorization = await authorizeAuthor(await headers());
  if (!authorization.ok) {
    return accessDenied(authorization.reason);
  }
  const { author } = authorization;
  const [catalog, journals, progress] = await Promise.all([
    getCatalogStatistics(author),
    getJournalStatistics(author),
    listAlbumJournalProgress(author),
  ]);
  const empty = catalog.artists === 0 && catalog.albums === 0;

  return (
    <StudioFrame current="desk">
      <h1 className="studio-title">Your desk</h1>
      <p className="studio-lede">
        Music is the context; the memory is the purpose. Catalog what you love,
        then write about it. Everything here is private.
      </p>

      {empty && journals.total === 0 ? (
        <div className="studio-panel">
          <p className="studio-section-title">Start here</p>
          <ol className="list-decimal pl-6 space-y-1">
            <li>
              <Link href="/studio/artists/new" className="studio-link">
                Add an artist
              </Link>
              , or a band.
            </li>
            <li>
              <Link href="/studio/albums/new" className="studio-link">
                Add an album
              </Link>{" "}
              that credits them.
            </li>
            <li>Build its tracklist from the album’s page.</li>
            <li>
              <Link href="/studio/journals/new" className="studio-link">
                Write a journal
              </Link>{" "}
              about it. It begins as a draft that only you can see.
            </li>
          </ol>
        </div>
      ) : null}

      <section className="studio-notebook" aria-labelledby="desk-catalog">
        <h2 id="desk-catalog" className="studio-section-title">
          Your catalog
        </h2>
        <div className="space-y-3">
          <p className="text-[19px]">
            <Link href="/studio/artists" className="studio-link">
              {plural(catalog.artists, "artist")}
            </Link>
            ,{" "}
            <Link href="/studio/albums" className="studio-link">
              {plural(catalog.albums, "album")}
            </Link>
            , and{" "}
            <Link href="/studio/tracks" className="studio-link">
              {plural(catalog.tracks, "track")}
            </Link>
            .
          </p>
          <p className="studio-meta">
            {plural(catalog.albumsWithoutTracks, "album")} without tracks ·{" "}
            {plural(catalog.tracksWithoutAlbum, "track")} on no album ·{" "}
            {plural(catalog.archivedRecords, "archived record")}
          </p>
        </div>
      </section>

      <section className="studio-notebook" aria-labelledby="desk-journals">
        <h2 id="desk-journals" className="studio-section-title">
          Your journals
        </h2>
        <div className="space-y-4">
          <p className="text-[19px]">
            <Link href="/studio/journals" className="studio-link">
              {plural(journals.total, "journal")}
            </Link>
            : {journals.draft} {journals.draft === 1 ? "draft" : "drafts"},{" "}
            {journals.private} private, {journals.published} published.
          </p>
          {journals.deleted > 0 ? (
            <p className="studio-meta">
              <Link href="/studio/journals/deleted" className="studio-link">
                Recently deleted ({journals.deleted})
              </Link>
            </p>
          ) : null}

          {progress.length > 0 ? (
            <>
              <ul className="studio-list" aria-label="Journals in progress">
                {progress.map((journal) => (
                  <li key={journal.entryId} className="studio-row">
                    <span className="studio-row-title">
                      <Link href={`/studio/journals/${journal.entryId}`}>
                        {journal.albumTitle}
                      </Link>
                    </span>
                    <span className="studio-meta">
                      {journal.tracksWritten} of{" "}
                      {plural(journal.trackCount, "track")} written
                    </span>
                  </li>
                ))}
              </ul>
              <p className="studio-hint">
                Track-by-track reflections arrive in a later release.
              </p>
            </>
          ) : null}
        </div>
      </section>
    </StudioFrame>
  );
}
