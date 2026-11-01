import { headers } from "next/headers";
import Link from "next/link";
import { Suspense } from "react";

import { accessDenied } from "@/app/studio/access";
import { plural } from "@/app/studio/format";
import { StudioFrame } from "@/app/studio/frame";
import { Icon } from "@/app/studio/icons";
import { StatusMark } from "@/app/studio/status-mark";
import { StudioLoading } from "@/app/studio/studio-loading";
import { getCatalogStatistics } from "@/modules/catalog";
import { authorizeAuthor } from "@/modules/identity";
import {
  getJournalStatistics,
  listAlbumJournalProgress,
  listAlbumJournals,
} from "@/modules/journals";

// The Writing Studio's desk: the author's journals first, then a way to write
// another. Every figure on it is a SQL aggregate computed by PostgreSQL on this
// request: nothing is counted in JavaScript or cached.
export default function StudioPage() {
  return (
    <Suspense fallback={<StudioLoading />}>
      <Desk />
    </Suspense>
  );
}

// How many journals the desk lists; the rest are one link away.
const DESK_LIMIT = 12;

async function Desk() {
  // The authorization boundary: a valid database session of the configured
  // author, checked on every request. Nothing below renders otherwise.
  const authorization = await authorizeAuthor(await headers());
  if (!authorization.ok) {
    return accessDenied(authorization.reason);
  }
  const { author } = authorization;
  const [catalog, statistics, journals, progress] = await Promise.all([
    getCatalogStatistics(author),
    getJournalStatistics(author),
    listAlbumJournals(author),
    listAlbumJournalProgress(author),
  ]);
  // "4 of 10 tracks written" is an aggregate PostgreSQL computes (AC-05); the
  // page only puts it beside the journal it belongs to.
  const tracksWritten = new Map(progress.map((row) => [row.entryId, row]));
  const listed = journals.slice(0, DESK_LIMIT);
  const catalogEmpty = catalog.artists === 0 && catalog.albums === 0;

  return (
    <StudioFrame current="desk">
      <h1 className="studio-title">Desk</h1>
      <p className="studio-lede">
        Everything you are writing. Everything here is private.
      </p>

      {journals.length === 0 ? (
        <div className="studio-panel studio-empty">
          <p className="studio-section-title">Nothing written yet.</p>
          {catalogEmpty ? (
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
          ) : (
            <>
              <p>
                Start with an album you love. A journal begins as a draft that
                only you can see.
              </p>
              <p>
                <Link
                  href="/studio/journals/new"
                  className="studio-button studio-button-primary"
                >
                  <Icon name="plus" />
                  Write a journal
                </Link>
              </p>
            </>
          )}
        </div>
      ) : (
        <div className="studio-actions" style={{ marginTop: 26 }}>
          <Link
            href="/studio/journals/new"
            className="studio-button studio-button-primary"
          >
            <Icon name="plus" />
            Write a journal
          </Link>
        </div>
      )}

      {journals.length > 0 ? (
        <section aria-labelledby="desk-journals" className="studio-desk-list">
          <h2 id="desk-journals" className="studio-sr-only">
            Your journals
          </h2>
          <p className="studio-meta">
            {plural(statistics.total, "journal")}: {statistics.draft}{" "}
            {statistics.draft === 1 ? "draft" : "drafts"}, {statistics.private}{" "}
            private, {statistics.published} published.
          </p>
          <ul className="studio-list" aria-label="Journals">
            {listed.map((journal) => {
              const written = tracksWritten.get(journal.entryId);
              return (
                <li key={journal.entryId} className="studio-row studio-entry">
                  <span className="studio-thumb" aria-hidden="true">
                    <Icon name="album" size={26} />
                  </span>
                  <span className="studio-entry-body">
                    <span className="studio-row-title">
                      <Link href={`/studio/journals/${journal.entryId}`}>
                        {journal.albumTitle}
                      </Link>
                    </span>
                    <span className="studio-meta">
                      Album journal
                      {journal.artistNames ? ` · ${journal.artistNames}` : ""}
                      {written
                        ? ` · ${written.tracksWritten} of ${plural(written.trackCount, "track")} written`
                        : ""}
                    </span>
                  </span>
                  <span className="studio-entry-end studio-entry-end-row">
                    <Link
                      href={`/studio/journals/${journal.entryId}/edit`}
                      className="studio-link studio-meta studio-end-link"
                      aria-label={`Edit the journal about ${journal.albumTitle}`}
                    >
                      Edit
                    </Link>
                    <StatusMark status={journal.status} />
                  </span>
                </li>
              );
            })}
          </ul>
          <p className="studio-meta">
            <Link href="/studio/journals" className="studio-link">
              {journals.length > DESK_LIMIT
                ? `All ${journals.length} journals`
                : "All journals"}
            </Link>
          </p>
        </section>
      ) : null}

      <p className="studio-meta">
        <Link
          href="/studio/journals/deleted"
          className="studio-link inline-flex items-center gap-2"
        >
          <Icon name="trash" size={16} />
          Recently deleted ({statistics.deleted})
        </Link>
      </p>

      <p className="studio-hint studio-desk-catalog">
        Your catalog:{" "}
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
        .{" "}
        <Link href="/studio/catalog" className="studio-link">
          Open the catalog
        </Link>
        .
      </p>
    </StudioFrame>
  );
}
