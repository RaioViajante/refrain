import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { Suspense } from "react";

import { accessDenied } from "@/app/studio/access";
import { StudioFrame } from "@/app/studio/frame";
import { Icon } from "@/app/studio/icons";
import { StudioLoading } from "@/app/studio/studio-loading";
import { studio } from "@/app/studio/studio-words";
import { formatDate } from "@/i18n/format";
import type { InterfaceLocale } from "@/i18n/locales";
import { studioWords } from "@/i18n/studio";
import { v3StringsFor } from "@/i18n/v3";
import { getCatalogStatistics } from "@/modules/catalog";
import { authorizeAuthor } from "@/modules/identity";
import {
  getJournalStatistics,
  getMemoryStatistics,
  listAlbumJournalProgress,
  listAlbumJournals,
  listMemories,
  type VisibilityStatus,
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

// How many unpublished entries "Keep writing" lists; the rest are one link
// away, in the Library.
const DESK_LIMIT = 12;
// How many published entries, and how many memories before "All N memories".
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
  const [catalog, statistics, journals, progress, memories, memoryStatistics] =
    await Promise.all([
      getCatalogStatistics(author),
      getJournalStatistics(author),
      listAlbumJournals(author),
      listAlbumJournalProgress(author),
      listMemories(author),
      getMemoryStatistics(author),
    ]);
  // "4 of 10 tracks written" is an aggregate PostgreSQL computes (AC-05); the
  // page only puts it beside the journal it belongs to.
  const tracksWritten = new Map(progress.map((row) => [row.entryId, row]));
  const catalogEmpty = catalog.artists === 0 && catalog.albums === 0;
  const nothingWritten = journals.length === 0 && memories.length === 0;

  // The v3 Desk (ADR 0011, proposed): what to keep writing (everything not
  // published, most recently edited first) and what is on the site, from the
  // same rows as before. Nothing here is public, and nothing is counted in
  // JavaScript: the lists are the queries' rows, the figures their aggregates.
  const v3 = v3StringsFor(locale).desk;
  const rows: DeskRow[] = [
    ...journals.map((journal): DeskRow => {
      const written = tracksWritten.get(journal.entryId);
      return {
        key: journal.entryId,
        href: href(`/studio/journals/${journal.entryId}/edit`),
        title: journal.albumTitle,
        label: w.editJournalAbout(journal.albumTitle),
        status: journal.status,
        subject: "journal",
        updatedAt: journal.updatedAt,
        meta: [
          w.albumJournal,
          journal.artistNames || null,
          w.edited(formatDate(locale, journal.updatedAt)),
          written
            ? w.tracksWritten(written.tracksWritten, written.trackCount)
            : null,
        ],
      };
    }),
    ...memories.map((memory): DeskRow => ({
      key: memory.entryId,
      href: href(`/studio/memories/${memory.entryId}`),
      title: memory.title,
      label: null,
      status: memory.status,
      subject: "memory",
      updatedAt: memory.updatedAt,
      meta: [
        v3.s23,
        memory.recordingTitles[0] ?? null,
        w.edited(formatDate(locale, memory.updatedAt)),
      ],
    })),
  ].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
  const keepWriting = rows
    .filter((row) => row.status !== "published")
    .slice(0, DESK_LIMIT);
  const published = rows
    .filter((row) => row.status === "published")
    .slice(0, DESK_MEMORY_LIMIT);

  return (
    <StudioFrame locale={locale} path="/studio" current="desk" layout="wide">
      <h1 className="t1">{v3.s19}</h1>
      <p className="sub">{w.greetingLead}</p>

      <div className="quick">
        <Link href={href("/studio/journals/new")}>
          <b>+ {v3.s21}</b>
          <span>{w.journalCardHint}</span>
        </Link>
        <Link href={href("/studio/memories/new")}>
          <b>+ {v3.s23}</b>
          <span>{w.memoryCardHint}</span>
        </Link>
        <Link href={href("/studio/catalog/add")}>
          <b>+ {w.musicCard}</b>
          <span>{w.musicCardHint}</span>
        </Link>
      </div>

      {nothingWritten && catalogEmpty ? (
        <section className="panel desk-first" aria-labelledby="desk-first">
          <div className="sec">
            <h2 id="desk-first">{w.nothingWritten}</h2>
            <ol className="desk-steps">
              <li>
                <Link href={href("/studio/artists/new")} className="lnk">
                  {w.firstSteps.addArtist}
                </Link>
                {w.firstSteps.addArtistRest}
              </li>
              <li>
                <Link href={href("/studio/albums/new")} className="lnk">
                  {w.firstSteps.addAlbum}
                </Link>
                {w.firstSteps.addAlbumRest}
              </li>
              <li>{w.firstSteps.tracklist}</li>
              <li>
                <Link href={href("/studio/journals/new")} className="lnk">
                  {w.firstSteps.writeJournal}
                </Link>
                {w.firstSteps.writeJournalRest}
              </li>
            </ol>
            <p className="hint">
              {w.firstSteps.orBefore}
              <Link href={href("/studio/memories/new")} className="lnk">
                {w.firstSteps.writeMemory}
              </Link>
              {w.firstSteps.orAfter}
            </p>
          </div>
        </section>
      ) : null}

      <div className="cols">
        <section className="panel" aria-labelledby="desk-keep">
          <div className="sec hd">
            <h2 id="desk-keep">{v3.s27}</h2>
            <Link href={href("/studio/journals")} className="btn quiet sm">
              {v3.s28}
            </Link>
          </div>
          {keepWriting.length > 0 ? (
            <DeskList
              locale={locale}
              rows={keepWriting}
              labelledBy="desk-keep"
            />
          ) : (
            <p className="sec hint">
              {nothingWritten ? w.startWith : w.keepWritingEmpty}
            </p>
          )}
        </section>

        <div className="desk-aside">
          <section className="panel" aria-labelledby="desk-site">
            <div className="sec">
              <h2 id="desk-site">{v3.s29}</h2>
            </div>
            <div className="stat desk-stat">
              <div>
                <b className="num">{statistics.published}</b>
                <span>{v3.s30}</span>
              </div>
              <div>
                <b className="num">{memoryStatistics.published}</b>
                <span>{v3.s31}</span>
              </div>
            </div>
          </section>
          <p className="desk-more">
            <Link href={href("/studio/memories")} className="lnk">
              {memories.length > DESK_MEMORY_LIMIT
                ? w.allMemoriesCount(memories.length)
                : w.allMemories}
            </Link>
            <Link
              href={href("/studio/journals/deleted")}
              className="lnk desk-bin"
            >
              <Icon name="trash" size={16} />
              {w.recentlyDeleted(statistics.deleted + memoryStatistics.deleted)}
            </Link>
          </p>
        </div>
      </div>

      <section
        className="panel desk-published"
        aria-labelledby="desk-published"
      >
        <div className="sec">
          <h2 id="desk-published">{v3.s35}</h2>
        </div>
        {published.length > 0 ? (
          <DeskList
            locale={locale}
            rows={published}
            labelledBy="desk-published"
          />
        ) : (
          <p className="sec hint">{w.publishedEmpty}</p>
        )}
      </section>

      <p className="desk-catalog">
        {w.yourCatalog}
        <Link href={href("/studio/artists")} className="lnk">
          {words.counts.artists(catalog.artists)}
        </Link>
        {w.catalogComma}
        <Link href={href("/studio/albums")} className="lnk">
          {words.counts.albums(catalog.albums)}
        </Link>
        {w.catalogAnd}
        <Link href={href("/studio/tracks")} className="lnk">
          {words.counts.tracks(catalog.tracks)}
        </Link>
        {w.catalogEnd}
        <Link href={href("/studio/catalog")} className="lnk">
          {w.openCatalog}
        </Link>
        {w.catalogClose}
      </p>
    </StudioFrame>
  );
}

interface DeskRow {
  key: string;
  href: string;
  title: string;
  /** The link's own name, when the title alone would not say what it opens. */
  label: string | null;
  status: VisibilityStatus;
  subject: "journal" | "memory";
  updatedAt: Date;
  meta: (string | null)[];
}

/** One of the Desk's lists: the title links to the entry, then its state. */
function DeskList({
  locale,
  rows,
  labelledBy,
}: {
  locale: InterfaceLocale;
  rows: DeskRow[];
  labelledBy: string;
}) {
  const words = studioWords(locale);
  return (
    <ul className="list" aria-labelledby={labelledBy}>
      {rows.map((row) => (
        <li key={row.key}>
          <Link
            href={row.href}
            className="ti"
            aria-label={row.label ?? undefined}
          >
            {row.title}
          </Link>
          <span
            className={`tag${row.status === "published" ? " pub" : row.status === "draft" ? " drf" : ""}`}
          >
            {row.subject === "memory"
              ? words.memoryStatus[row.status]
              : words.status[row.status]}
          </span>
          <span className="m">
            {row.meta.filter((part) => part).join(" · ")}
          </span>
        </li>
      ))}
    </ul>
  );
}
