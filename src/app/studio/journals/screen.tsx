import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { Suspense } from "react";

import { accessDenied } from "@/app/studio/access";
import { AlbumThumb } from "@/app/studio/artwork-placeholder";
import { StudioFrame } from "@/app/studio/frame";
import { Icon } from "@/app/studio/icons";
import { StudioLoading } from "@/app/studio/studio-loading";
import { StatusMark } from "@/app/studio/status-mark";
import { studio, type StudioSpeech } from "@/app/studio/studio-words";
import { formatDate } from "@/i18n/format";
import type { InterfaceLocale } from "@/i18n/locales";
import { listAlbumCovers, type AlbumCover } from "@/modules/catalog";
import { authorizeAuthor } from "@/modules/identity";
import {
  getJournalStatistics,
  listAlbumJournals,
  listDeletedAlbumJournals,
  type AlbumJournalSummary,
} from "@/modules/journals";

// A fixed title: a journal's words never reach page metadata.
export function journalsMetadata(locale: InterfaceLocale): Metadata {
  return { title: studio(locale).words.meta.journals };
}

export function JournalsScreen({ locale }: { locale: InterfaceLocale }) {
  return (
    <Suspense fallback={<StudioLoading locale={locale} />}>
      <Journals locale={locale} />
    </Suspense>
  );
}

async function Journals({ locale }: { locale: InterfaceLocale }) {
  const authorization = await authorizeAuthor(await headers());
  if (!authorization.ok) {
    return accessDenied(authorization.reason, locale);
  }
  const speech = studio(locale);
  const { words, href } = speech;
  const w = words.journals;
  const { author } = authorization;
  const [journals, deleted, statistics, covers] = await Promise.all([
    listAlbumJournals(author),
    listDeletedAlbumJournals(author),
    getJournalStatistics(author),
    listAlbumCovers(author),
  ]);

  return (
    <StudioFrame locale={locale} path="/studio/journals" current="journals">
      <h1 className="studio-title">{w.title}</h1>
      <p className="studio-lede">{w.lead}</p>
      <p>
        <Link
          href={href("/studio/journals/new")}
          className="studio-button studio-button-primary"
        >
          <Icon name="plus" />
          {words.desk.writeJournal}
        </Link>
      </p>

      {journals.length === 0 && deleted.length === 0 ? (
        <div className="studio-panel">
          <p className="studio-section-title">{w.emptyTitle}</p>
          <p>{w.emptyBody}</p>
        </div>
      ) : (
        <>
          <p className="studio-meta" aria-label={w.totalsLabel}>
            {words.desk.journalsSummary(
              statistics.total,
              statistics.draft,
              statistics.private,
              statistics.published,
            )}
          </p>
          <JournalList
            speech={speech}
            journals={journals}
            covers={covers}
            label={w.listLabel}
          />
        </>
      )}

      {deleted.length > 0 ? (
        <section aria-labelledby="recently-deleted">
          <h2 id="recently-deleted" className="studio-section-title">
            {words.desk.recentlyDeleted(deleted.length)}
          </h2>
          <p className="studio-hint" style={{ maxWidth: "62ch" }}>
            {w.deletedHint}
          </p>
          <p>
            <Link
              href={href("/studio/journals/deleted")}
              className="studio-button"
            >
              {w.openDeleted}
            </Link>
          </p>
        </section>
      ) : null}
    </StudioFrame>
  );
}

function JournalList({
  speech: { locale, words, href },
  journals,
  covers,
  label,
}: {
  speech: StudioSpeech;
  journals: AlbumJournalSummary[];
  covers: Map<string, AlbumCover>;
  label: string;
}) {
  // The album is the journal's subject and heading (ADR 0002); the author's own
  // words appear only as a preview, so several journals about one album are
  // told apart by their dates and status.
  return (
    <ul className="studio-list" aria-label={label}>
      {journals.map((journal) => (
        <li key={journal.entryId} className="studio-row studio-entry">
          <AlbumThumb artwork={covers.get(journal.albumId)} />
          <span className="studio-entry-body">
            <span className="studio-row-title">
              <Link href={href(`/studio/journals/${journal.entryId}`)}>
                {journal.albumTitle}
              </Link>
            </span>
            <span className="studio-meta">{journal.artistNames}</span>
            <span
              className="studio-excerpt"
              lang={journal.excerpt ? journal.locale : undefined}
            >
              {journal.excerpt || words.album.nothingWritten}
            </span>
          </span>
          <span className="studio-entry-end">
            <StatusMark locale={locale} status={journal.status} />
            <span className="studio-meta">
              {words.journals.rowDates(
                formatDate(locale, journal.createdAt),
                formatDate(locale, journal.updatedAt),
                journal.wordCount,
              )}
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}
