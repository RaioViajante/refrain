import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { accessDenied } from "@/app/studio/access";
import { formatDate, plural } from "@/app/studio/format";
import { StudioFrame } from "@/app/studio/frame";
import { ArtworkPlaceholder } from "@/app/studio/artwork-placeholder";
import { JournalControls } from "@/app/studio/journals/journal-controls";
import { RestoreJournalButton } from "@/app/studio/journals/restore-button";
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

type JournalProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ restored?: string | string[] }>;
};

export default function JournalPage({ params, searchParams }: JournalProps) {
  return (
    <Suspense fallback={<StudioLoading />}>
      <Journal params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function Journal({ params, searchParams }: JournalProps) {
  const authorization = await authorizeAuthor(await headers());
  if (!authorization.ok) {
    return accessDenied(authorization.reason);
  }
  const { id } = await params;
  const { restored } = await searchParams;
  const journal = await getAlbumJournal(authorization.author, id);
  if (!journal) {
    notFound();
  }
  const deleted = journal.deletedAt !== null;
  // Only a fixed word picks the notice; the query string is never shown. It
  // is claimed only while the journal really is live, so a stale link to a
  // journal that was deleted again says nothing false.
  const restoredNotice = deleted
    ? null
    : restored === "private"
      ? "Restored from Recently deleted. Part of it was published when it was deleted, and that part is now private. Nothing is published again until you choose to publish it."
      : restored === "1"
        ? "Restored from Recently deleted, with its writing exactly as you left it."
        : null;
  const paragraphs =
    journal.body === null ? null : textToParagraphs(journal.body);

  return (
    <StudioFrame current="journals" layout="wide">
      <p>
        <Link href="/studio/journals" className="studio-link">
          ← Journals
        </Link>
      </p>

      <div className="studio-journal">
        <div className="studio-journal-head">
          <p className="studio-meta">Album journal</p>
          <h1
            className="studio-title"
            style={{ fontSize: "clamp(34px, 4.2vw, 56px)" }}
          >
            {journal.albumTitle}
          </h1>
          <p className="studio-meta">
            {journal.artistNames ? `${journal.artistNames} · ` : ""}
            <Link
              href={`/studio/albums/${journal.albumId}`}
              className="studio-link"
            >
              The album
            </Link>
          </p>
          <p className="studio-meta">
            <StatusMark status={journal.status} /> · written in{" "}
            {LANGUAGE_NAMES[journal.locale]} ·{" "}
            {plural(journal.wordCount, "word")} · started{" "}
            {formatDate(journal.createdAt)} · edited{" "}
            {formatDate(journal.updatedAt)} (UTC dates)
          </p>
        </div>

        <div className="studio-journal-writing">
          {restoredNotice ? (
            <p role="status" className="studio-panel">
              {restoredNotice}
            </p>
          ) : null}

          {deleted ? (
            <div className="studio-panel space-y-3">
              <p>
                This journal has been in Recently deleted since{" "}
                {formatDate(journal.deletedAt!)}. Its writing is kept in the
                database, and it cannot be changed there until you restore it.
              </p>
              <RestoreJournalButton
                entryId={journal.entryId}
                albumTitle={journal.albumTitle}
                wasPublished={journal.versions.some(
                  (version) => version.status === "published",
                )}
              />
            </div>
          ) : null}

          <article lang={journal.locale} className="space-y-6">
            {journal.opening ? (
              <p className="studio-opening">{journal.opening}</p>
            ) : null}
            {paragraphs === null ? (
              <p className="studio-panel" lang="en">
                This text has formatting that the plain editor can’t show
                without losing it. It is untouched.
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
        </div>

        <div className="studio-journal-side">
          <ArtworkPlaceholder />
          {deleted ? null : (
            <p>
              <Link
                href={`/studio/journals/${journal.entryId}/edit`}
                className="studio-button"
              >
                Edit this journal
              </Link>
            </p>
          )}

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
        </div>
      </div>
    </StudioFrame>
  );
}
