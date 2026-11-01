import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { Suspense } from "react";

import { accessDenied } from "@/app/studio/access";
import { formatDate, plural } from "@/app/studio/format";
import { StudioFrame } from "@/app/studio/frame";
import { StudioLoading } from "@/app/studio/studio-loading";
import { StatusMark } from "@/app/studio/status-mark";
import { authorizeAuthor } from "@/modules/identity";
import {
  getJournalStatistics,
  listAlbumJournals,
  listDeletedAlbumJournals,
  type AlbumJournalSummary,
} from "@/modules/journals";

// A fixed title: a journal's words never reach page metadata.
export const metadata: Metadata = { title: "Journals · refrain" };

export default function JournalsPage() {
  return (
    <Suspense fallback={<StudioLoading />}>
      <Journals />
    </Suspense>
  );
}

async function Journals() {
  const authorization = await authorizeAuthor(await headers());
  if (!authorization.ok) {
    return accessDenied(authorization.reason);
  }
  const { author } = authorization;
  const [journals, deleted, statistics] = await Promise.all([
    listAlbumJournals(author),
    listDeletedAlbumJournals(author),
    getJournalStatistics(author),
  ]);

  return (
    <StudioFrame current="journals">
      <h1 className="studio-title">Journals</h1>
      <p className="studio-lede">
        What you write about the albums you love. An album can have as many
        journals as you want, written over the years.
      </p>
      <p>
        <Link href="/studio/journals/new" className="studio-button">
          Write a journal
        </Link>
      </p>

      {journals.length === 0 && deleted.length === 0 ? (
        <div className="studio-panel">
          <p className="studio-section-title">Nothing written yet</p>
          <p>
            Choose an album and start a journal. It begins as a draft that only
            you can see, and it is saved only when you save it.
          </p>
        </div>
      ) : (
        <>
          <p className="studio-meta" aria-label="Journal totals">
            {plural(statistics.total, "journal")}: {statistics.draft}{" "}
            {statistics.draft === 1 ? "draft" : "drafts"}, {statistics.private}{" "}
            private, {statistics.published} published.
          </p>
          <JournalList journals={journals} label="Journals" />
        </>
      )}

      {deleted.length > 0 ? (
        <section aria-labelledby="recently-deleted" id="recently-deleted">
          <h2 id="recently-deleted" className="studio-section-title">
            Recently deleted ({deleted.length})
          </h2>
          <p className="studio-hint" style={{ maxWidth: "62ch" }}>
            Moved there, not erased: the writing stays in the database, and
            nothing removes it automatically. You can restore a journal from
            there; permanent deletion is not offered yet.
          </p>
          <p>
            <Link href="/studio/journals/deleted" className="studio-button">
              Open Recently deleted
            </Link>
          </p>
        </section>
      ) : null}
    </StudioFrame>
  );
}

function JournalList({
  journals,
  label,
}: {
  journals: AlbumJournalSummary[];
  label: string;
}) {
  // The album is the journal's subject and heading (ADR 0002); the author's own
  // words appear only as a preview, so several journals about one album are
  // told apart by their dates and status.
  return (
    <ul className="studio-list" aria-label={label}>
      {journals.map((journal) => (
        <li key={journal.entryId} className="studio-row">
          <span className="studio-row-title" style={{ flex: "1 1 280px" }}>
            <Link href={`/studio/journals/${journal.entryId}`}>
              {journal.albumTitle}
            </Link>
            <span className="studio-meta" style={{ display: "block" }}>
              {journal.artistNames}
            </span>
          </span>
          <span
            className="studio-meta"
            style={{ flex: "2 1 280px" }}
            lang={journal.excerpt ? journal.locale : undefined}
          >
            {journal.excerpt || "Nothing written yet"}
          </span>
          <StatusMark status={journal.status} />
          <span className="studio-meta">
            started {formatDate(journal.createdAt)} · edited{" "}
            {formatDate(journal.updatedAt)} ·{" "}
            {plural(journal.wordCount, "word")}
          </span>
        </li>
      ))}
    </ul>
  );
}
