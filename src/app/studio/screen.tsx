import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { Suspense } from "react";

import { accessDenied } from "@/app/studio/access";
import { AlbumThumb } from "@/app/studio/artwork-placeholder";
import { StudioFrame } from "@/app/studio/frame";
import { Icon } from "@/app/studio/icons";
import { MemoryRows } from "@/app/studio/memories/memory-rows";
import { StatusMark } from "@/app/studio/status-mark";
import { StudioLoading } from "@/app/studio/studio-loading";
import { studio } from "@/app/studio/studio-words";
import type { InterfaceLocale } from "@/i18n/locales";
import { getCatalogStatistics, listAlbumCovers } from "@/modules/catalog";
import { authorizeAuthor } from "@/modules/identity";
import {
  getJournalStatistics,
  getMemoryStatistics,
  listAlbumJournalProgress,
  listAlbumJournals,
  listMemories,
} from "@/modules/journals";

// The Writing Studio's desk: the author's journals first, then a way to write
// another. Every figure on it is a SQL aggregate computed by PostgreSQL on this
// request: nothing is counted in JavaScript or cached.
export function deskMetadata(locale: InterfaceLocale): Metadata {
  return { title: studio(locale).words.meta.studio };
}

export function DeskScreen({ locale }: { locale: InterfaceLocale }) {
  return (
    <Suspense fallback={<StudioLoading locale={locale} />}>
      <Desk locale={locale} />
    </Suspense>
  );
}

// How many journals the desk lists; the rest are one link away.
const DESK_LIMIT = 12;
// How many memories the desk lists (M3.6).
const DESK_MEMORY_LIMIT = 6;

async function Desk({ locale }: { locale: InterfaceLocale }) {
  // The authorization boundary: a valid database session of the configured
  // author, checked on every request. Nothing below renders otherwise.
  const authorization = await authorizeAuthor(await headers());
  if (!authorization.ok) {
    return accessDenied(authorization.reason, locale);
  }
  const { words, href } = studio(locale);
  const w = words.desk;
  const { author } = authorization;
  const [
    catalog,
    statistics,
    journals,
    progress,
    memories,
    memoryStatistics,
    covers,
  ] = await Promise.all([
    getCatalogStatistics(author),
    getJournalStatistics(author),
    listAlbumJournals(author),
    listAlbumJournalProgress(author),
    listMemories(author),
    getMemoryStatistics(author),
    listAlbumCovers(author),
  ]);
  // "4 of 10 tracks written" is an aggregate PostgreSQL computes (AC-05); the
  // page only puts it beside the journal it belongs to.
  const tracksWritten = new Map(progress.map((row) => [row.entryId, row]));
  const listed = journals.slice(0, DESK_LIMIT);
  const catalogEmpty = catalog.artists === 0 && catalog.albums === 0;
  const nothingWritten = journals.length === 0 && memories.length === 0;

  return (
    <StudioFrame locale={locale} path="/studio" current="desk">
      <h1 className="studio-title">{w.title}</h1>
      <p className="studio-lede">{w.lead}</p>

      {nothingWritten ? (
        <div className="studio-panel studio-empty">
          <p className="studio-section-title">{w.nothingWritten}</p>
          {catalogEmpty ? (
            <>
              <ol className="list-decimal pl-6 space-y-1">
                <li>
                  <Link
                    href={href("/studio/artists/new")}
                    className="studio-link"
                  >
                    {w.firstSteps.addArtist}
                  </Link>
                  {w.firstSteps.addArtistRest}
                </li>
                <li>
                  <Link
                    href={href("/studio/albums/new")}
                    className="studio-link"
                  >
                    {w.firstSteps.addAlbum}
                  </Link>
                  {w.firstSteps.addAlbumRest}
                </li>
                <li>{w.firstSteps.tracklist}</li>
                <li>
                  <Link
                    href={href("/studio/journals/new")}
                    className="studio-link"
                  >
                    {w.firstSteps.writeJournal}
                  </Link>
                  {w.firstSteps.writeJournalRest}
                </li>
              </ol>
              <p>
                {w.firstSteps.orBefore}
                <Link
                  href={href("/studio/memories/new")}
                  className="studio-link"
                >
                  {w.firstSteps.writeMemory}
                </Link>
                {w.firstSteps.orAfter}
              </p>
            </>
          ) : (
            <>
              <p>{w.startWith}</p>
              <div className="studio-actions">
                <Link
                  href={href("/studio/journals/new")}
                  className="studio-button studio-button-primary"
                >
                  <Icon name="plus" />
                  {w.writeJournal}
                </Link>
                <Link
                  href={href("/studio/memories/new")}
                  className="studio-button"
                >
                  <Icon name="plus" />
                  {w.writeMemory}
                </Link>
              </div>
            </>
          )}
        </div>
      ) : (
        <div className="studio-actions" style={{ marginTop: 26 }}>
          <Link
            href={href("/studio/journals/new")}
            className="studio-button studio-button-primary"
          >
            <Icon name="plus" />
            {w.writeJournal}
          </Link>
          <Link href={href("/studio/memories/new")} className="studio-button">
            <Icon name="plus" />
            {w.writeMemory}
          </Link>
        </div>
      )}

      {journals.length > 0 ? (
        <section aria-labelledby="desk-journals" className="studio-desk-list">
          <h2 id="desk-journals" className="studio-sr-only">
            {w.yourJournals}
          </h2>
          <p className="studio-meta">
            {w.journalsSummary(
              statistics.total,
              statistics.draft,
              statistics.private,
              statistics.published,
            )}
          </p>
          <ul className="studio-list" aria-label={w.journalsLabel}>
            {listed.map((journal) => {
              const written = tracksWritten.get(journal.entryId);
              return (
                <li key={journal.entryId} className="studio-row studio-entry">
                  <AlbumThumb artwork={covers.get(journal.albumId)} />
                  <span className="studio-entry-body">
                    <span className="studio-row-title">
                      <Link href={href(`/studio/journals/${journal.entryId}`)}>
                        {journal.albumTitle}
                      </Link>
                    </span>
                    <span className="studio-meta">
                      {w.albumJournal}
                      {journal.artistNames ? ` · ${journal.artistNames}` : ""}
                      {written
                        ? ` · ${w.tracksWritten(written.tracksWritten, written.trackCount)}`
                        : ""}
                    </span>
                  </span>
                  <span className="studio-entry-end studio-entry-end-row">
                    <Link
                      href={href(`/studio/journals/${journal.entryId}/edit`)}
                      className="studio-link studio-meta studio-end-link"
                      aria-label={w.editJournalAbout(journal.albumTitle)}
                    >
                      {words.common.edit}
                    </Link>
                    <StatusMark locale={locale} status={journal.status} />
                  </span>
                </li>
              );
            })}
          </ul>
          <p className="studio-meta">
            <Link href={href("/studio/journals")} className="studio-link">
              {journals.length > DESK_LIMIT
                ? w.allJournalsCount(journals.length)
                : w.allJournals}
            </Link>
          </p>
        </section>
      ) : null}

      {memories.length > 0 ? (
        <section aria-labelledby="desk-memories" className="studio-desk-list">
          <h2 id="desk-memories" className="studio-sr-only">
            {w.yourMemories}
          </h2>
          <p className="studio-meta">
            {w.memoriesSummary(
              memoryStatistics.total,
              memoryStatistics.draft,
              memoryStatistics.private,
              memoryStatistics.published,
            )}
          </p>
          <MemoryRows
            locale={locale}
            memories={memories.slice(0, DESK_MEMORY_LIMIT)}
            label={w.memoriesLabel}
            compact
          />
          <p className="studio-meta">
            <Link href={href("/studio/memories")} className="studio-link">
              {memories.length > DESK_MEMORY_LIMIT
                ? w.allMemoriesCount(memories.length)
                : w.allMemories}
            </Link>
          </p>
        </section>
      ) : (
        <p className="studio-meta">
          <Link href={href("/studio/memories")} className="studio-link">
            {w.memories}
          </Link>
        </p>
      )}

      <p className="studio-meta">
        <Link
          href={href("/studio/journals/deleted")}
          className="studio-link inline-flex items-center gap-2"
        >
          <Icon name="trash" size={16} />
          {w.recentlyDeleted(statistics.deleted + memoryStatistics.deleted)}
        </Link>
      </p>

      <p className="studio-hint studio-desk-catalog">
        {w.yourCatalog}
        <Link href={href("/studio/artists")} className="studio-link">
          {words.counts.artists(catalog.artists)}
        </Link>
        {w.catalogComma}
        <Link href={href("/studio/albums")} className="studio-link">
          {words.counts.albums(catalog.albums)}
        </Link>
        {w.catalogAnd}
        <Link href={href("/studio/tracks")} className="studio-link">
          {words.counts.tracks(catalog.tracks)}
        </Link>
        {w.catalogEnd}
        <Link href={href("/studio/catalog")} className="studio-link">
          {w.openCatalog}
        </Link>
        {w.catalogClose}
      </p>
    </StudioFrame>
  );
}
