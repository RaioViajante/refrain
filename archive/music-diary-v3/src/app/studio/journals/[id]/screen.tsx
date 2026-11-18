import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { accessDenied } from "@/app/studio/access";
import { StudioFrame } from "@/app/studio/frame";
import { ArtworkPlaceholder } from "@/app/studio/artwork-placeholder";
import { JournalControls } from "@/app/studio/journals/journal-controls";
import { RestoreJournalButton } from "@/app/studio/journals/restore-button";
import { StudioLoading } from "@/app/studio/studio-loading";
import { StatusMark } from "@/app/studio/status-mark";
import { studio } from "@/app/studio/studio-words";
import { formatDate } from "@/i18n/format";
import type { InterfaceLocale } from "@/i18n/locales";
import { getAlbumCover } from "@/modules/catalog";
import { authorizeAuthor } from "@/modules/identity";
import { getAlbumJournal, textToParagraphs } from "@/modules/journals";

// A fixed title: the journal's own words never reach page metadata.
export function journalMetadata(locale: InterfaceLocale): Metadata {
  return { title: studio(locale).words.meta.journal };
}

type JournalProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
  locale: InterfaceLocale;
};

export function JournalScreen({ params, searchParams, locale }: JournalProps) {
  return (
    <Suspense fallback={<StudioLoading locale={locale} />}>
      <Journal params={params} searchParams={searchParams} locale={locale} />
    </Suspense>
  );
}

async function Journal({ params, searchParams, locale }: JournalProps) {
  const authorization = await authorizeAuthor(await headers());
  if (!authorization.ok) {
    return accessDenied(authorization.reason, locale);
  }
  const { words, href } = studio(locale);
  const w = words.journal;
  const { id } = await params;
  const { restored } = await searchParams;
  const journal = await getAlbumJournal(authorization.author, id);
  if (!journal) {
    notFound();
  }
  const cover = await getAlbumCover(authorization.author, journal.albumId);
  const deleted = journal.deletedAt !== null;
  // Only a fixed word picks the notice; the query string is never shown. It
  // is claimed only while the journal really is live, so a stale link to a
  // journal that was deleted again says nothing false.
  const restoredNotice = deleted
    ? null
    : restored === "private"
      ? w.restoredPrivate
      : restored === "1"
        ? w.restored
        : null;
  const paragraphs =
    journal.body === null ? null : textToParagraphs(journal.body);

  return (
    <StudioFrame
      locale={locale}
      path={`/studio/journals/${journal.entryId}`}
      current="journals"
      layout="wide"
    >
      <p>
        <Link href={href("/studio/journals")} className="studio-link">
          {words.newJournal.back}
        </Link>
      </p>

      <div className="studio-journal">
        <div className="studio-journal-head">
          <p className="studio-meta">{words.desk.albumJournal}</p>
          <h1
            className="studio-title"
            style={{ fontSize: "clamp(34px, 4.2vw, 56px)" }}
          >
            {journal.albumTitle}
          </h1>
          <p className="studio-meta">
            {journal.artistNames ? `${journal.artistNames} · ` : ""}
            <Link
              href={href(`/studio/albums/${journal.albumId}`)}
              className="studio-link"
            >
              {w.theAlbum}
            </Link>
          </p>
          <p className="studio-meta">
            <StatusMark locale={locale} status={journal.status} />
            {w.facts(
              words.languageInSentence[journal.locale],
              journal.wordCount,
              formatDate(locale, journal.createdAt),
              formatDate(locale, journal.updatedAt),
            )}
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
              <p>{w.inDeleted(formatDate(locale, journal.deletedAt!))}</p>
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
              <p className="studio-panel" lang={locale}>
                {w.unsupported}
              </p>
            ) : paragraphs.length === 0 ? (
              <p className="studio-hint" lang={locale}>
                {words.desk.nothingWritten}
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
          <ArtworkPlaceholder
            locale={locale}
            artwork={cover?.artwork ?? null}
            title={journal.albumTitle}
            size={220}
          />
          {deleted ? null : (
            <p>
              <Link
                href={href(`/studio/journals/${journal.entryId}/edit`)}
                className="studio-button"
              >
                {w.edit}
              </Link>
            </p>
          )}

          <section aria-labelledby="journal-state" className="space-y-3">
            <h2 id="journal-state" className="studio-section-title">
              {w.state}
            </h2>
            <dl className="studio-meta space-y-1">
              <div>
                <dt className="inline font-medium">{w.versions}</dt>
                <dd className="inline">
                  {journal.versions
                    .map((version) =>
                      w.version(
                        words.languageInSentence[version.locale],
                        version.isOriginal,
                        words.statusLower[version.status],
                      ),
                    )
                    .join("; ")}
                  {journal.versions.length === 1 ? w.noTranslation : "."}
                </dd>
              </div>
              <div>
                <dt className="inline font-medium">{w.deletedLabel}</dt>
                <dd className="inline">
                  {deleted ? w.deletedYes : w.deletedNo}
                </dd>
              </div>
            </dl>
          </section>

          {deleted ? null : (
            <section aria-labelledby="journal-manage" className="space-y-3">
              <h2 id="journal-manage" className="studio-section-title">
                {w.manage}
              </h2>
              <JournalControls
                entryId={journal.entryId}
                versions={journal.versions}
              />
            </section>
          )}
        </div>
      </div>
    </StudioFrame>
  );
}
