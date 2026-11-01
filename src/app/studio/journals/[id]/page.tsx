import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { accessDenied } from "@/app/studio/access";
import { formatDate, plural } from "@/app/studio/format";
import { StudioFrame } from "@/app/studio/frame";
import { JournalControls } from "@/app/studio/journals/journal-controls";
import { StudioLoading } from "@/app/studio/studio-loading";
import { StatusMark } from "@/app/studio/status-mark";
import { authorizeAuthor } from "@/modules/identity";
import { getAlbumJournal, textToParagraphs } from "@/modules/journals";

// A fixed title: the journal's own words never reach page metadata.
export const metadata: Metadata = { title: "Journal · refrain" };

const LANGUAGE_NAMES = {
  en: "English",
  "pt-BR": "Português (Brasil)",
} as const;

export default function JournalPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return (
    <Suspense fallback={<StudioLoading />}>
      <Journal params={params} />
    </Suspense>
  );
}

async function Journal({ params }: { params: Promise<{ id: string }> }) {
  const authorization = await authorizeAuthor(await headers());
  if (!authorization.ok) {
    return accessDenied(authorization.reason);
  }
  const { id } = await params;
  const journal = await getAlbumJournal(authorization.author, id);
  if (!journal) {
    notFound();
  }
  const deleted = journal.deletedAt !== null;
  const paragraphs =
    journal.body === null ? null : textToParagraphs(journal.body);

  return (
    <StudioFrame current="journals">
      <p>
        <Link href="/studio/journals" className="studio-link">
          ← Journals
        </Link>
      </p>

      <header className="space-y-2">
        <p className="studio-meta">
          A journal about{" "}
          <Link
            href={`/studio/albums/${journal.albumId}`}
            className="studio-link"
          >
            {journal.albumTitle}
          </Link>
          {journal.artistNames ? ` · ${journal.artistNames}` : ""}
        </p>
        <h1 className="studio-title" style={{ fontSize: "42px" }}>
          {journal.albumTitle}
        </h1>
        <p className="studio-meta">
          <StatusMark status={journal.status} /> · written in{" "}
          {LANGUAGE_NAMES[journal.locale]} · {plural(journal.wordCount, "word")}{" "}
          · started {formatDate(journal.createdAt)} · edited{" "}
          {formatDate(journal.updatedAt)} (UTC dates)
        </p>
      </header>

      {deleted ? (
        <p className="studio-panel">
          This journal is in Recently deleted since{" "}
          {formatDate(journal.deletedAt!)}. The writing is kept, and it cannot
          be changed there. Restoring it is not available yet.
        </p>
      ) : (
        <p>
          <Link
            href={`/studio/journals/${journal.entryId}/edit`}
            className="studio-button"
          >
            Edit this journal
          </Link>
        </p>
      )}

      <article lang={journal.locale} className="space-y-6">
        {journal.opening ? (
          <p className="studio-opening">{journal.opening}</p>
        ) : null}
        {paragraphs === null ? (
          <p className="studio-panel" lang="en">
            This text has formatting that the plain editor can’t show without
            losing it. It is untouched.
          </p>
        ) : paragraphs.length === 0 ? (
          <p className="studio-hint" lang="en">
            Nothing written yet.
          </p>
        ) : (
          <div className="studio-reading">
            {paragraphs.map((lines, index) => (
              <p key={index}>
                {lines.map((line, lineIndex) => (
                  <span key={lineIndex}>
                    {lineIndex > 0 ? <br /> : null}
                    {line}
                  </span>
                ))}
              </p>
            ))}
          </div>
        )}
      </article>

      <section aria-labelledby="journal-state" className="space-y-3">
        <h2 id="journal-state" className="studio-section-title">
          Its state
        </h2>
        <dl className="studio-meta space-y-1">
          <div>
            <dt className="inline font-medium">Language versions: </dt>
            <dd className="inline">
              {journal.versions
                .map(
                  (version) =>
                    `${LANGUAGE_NAMES[version.locale]}${version.isOriginal ? " (original)" : " (your translation)"}, ${version.status}`,
                )
                .join("; ")}
              {journal.versions.length === 1
                ? ". You haven’t written a translation, and nothing is translated for you."
                : "."}
            </dd>
          </div>
          <div>
            <dt className="inline font-medium">Deleted: </dt>
            <dd className="inline">
              {deleted ? "yes, in Recently deleted" : "no"}
            </dd>
          </div>
        </dl>
      </section>

      {deleted ? null : (
        <section aria-labelledby="journal-manage" className="space-y-3">
          <h2 id="journal-manage" className="studio-section-title">
            Manage
          </h2>
          <JournalControls
            entryId={journal.entryId}
            locale={journal.locale}
            status={journal.status}
          />
        </section>
      )}
    </StudioFrame>
  );
}
