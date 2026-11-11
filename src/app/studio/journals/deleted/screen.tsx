import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { Suspense } from "react";

import { accessDenied } from "@/app/studio/access";
import { AlbumThumb } from "@/app/studio/artwork-placeholder";
import { StudioFrame } from "@/app/studio/frame";
import { Icon } from "@/app/studio/icons";
import { RestoreJournalButton } from "@/app/studio/journals/restore-button";
import { songsLine } from "@/app/studio/memories/memory-rows";
import { RestoreMemoryButton } from "@/app/studio/memories/restore-memory-button";
import { StudioLoading } from "@/app/studio/studio-loading";
import { studio } from "@/app/studio/studio-words";
import { formatDate } from "@/i18n/format";
import type { InterfaceLocale } from "@/i18n/locales";
import { listAlbumCovers } from "@/modules/catalog";
import { authorizeAuthor } from "@/modules/identity";
import {
  listDeletedAlbumJournals,
  listDeletedMemories,
} from "@/modules/journals";

// A fixed title: a journal's words never reach page metadata.
export function deletedMetadata(locale: InterfaceLocale): Metadata {
  return { title: studio(locale).words.meta.deleted };
}

export function DeletedScreen({ locale }: { locale: InterfaceLocale }) {
  return (
    <Suspense fallback={<StudioLoading locale={locale} />}>
      <RecentlyDeleted locale={locale} />
    </Suspense>
  );
}

async function RecentlyDeleted({ locale }: { locale: InterfaceLocale }) {
  const authorization = await authorizeAuthor(await headers());
  if (!authorization.ok) {
    return accessDenied(authorization.reason, locale);
  }
  const { words, href } = studio(locale);
  const w = words.deleted;
  const versionsLine = (
    versions: readonly {
      locale: "en" | "pt-BR";
      status: "draft" | "private" | "published";
    }[],
  ) =>
    versions
      .map((version) =>
        w.version(
          words.languageInSentence[version.locale],
          words.statusLower[version.status],
          version.status === "published",
        ),
      )
      .join("; ");
  const [deleted, deletedMemories, covers] = await Promise.all([
    listDeletedAlbumJournals(authorization.author),
    listDeletedMemories(authorization.author),
    listAlbumCovers(authorization.author),
  ]);

  return (
    <StudioFrame
      locale={locale}
      path="/studio/journals/deleted"
      current="journals"
    >
      <p>
        <Link href={href("/studio/journals")} className="studio-link">
          {words.newJournal.back}
        </Link>
      </p>
      <h1 className="studio-title">{w.title}</h1>
      <p className="studio-lede">{w.lead}</p>
      <p className="studio-hint" style={{ maxWidth: "62ch" }}>
        {w.hint}
      </p>

      <h2 className="studio-section-title">{w.journals}</h2>
      {deleted.length === 0 ? (
        <div className="studio-panel">
          <p className="studio-section-title">{w.nothingHere}</p>
          <p>{w.noJournal}</p>
        </div>
      ) : (
        <ul className="studio-list" aria-label={w.journalsLabel}>
          {deleted.map((journal) => {
            const wasPublished = journal.versions.some(
              (version) => version.status === "published",
            );
            return (
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
                  <span className="studio-meta">
                    {w.deletedOn(
                      journal.deletedAt
                        ? formatDate(locale, journal.deletedAt)
                        : "",
                    )}
                    {" · "}
                    {versionsLine(journal.versions)}
                  </span>
                </span>
                <span className="studio-entry-end">
                  <RestoreJournalButton
                    entryId={journal.entryId}
                    albumTitle={journal.albumTitle}
                    wasPublished={wasPublished}
                  />
                </span>
              </li>
            );
          })}
        </ul>
      )}

      <section aria-labelledby="deleted-memories" className="space-y-3">
        <h2 id="deleted-memories" className="studio-section-title">
          {w.memories}
        </h2>
        {deletedMemories.length === 0 ? (
          <div className="studio-panel">
            <p>{w.noMemory}</p>
          </div>
        ) : (
          <ul className="studio-list" aria-label={w.memoriesLabel}>
            {deletedMemories.map((memory) => (
              <li key={memory.entryId} className="studio-row studio-entry">
                <span className="studio-thumb" aria-hidden="true">
                  <Icon name="note" size={26} />
                </span>
                <span className="studio-entry-body">
                  <span className="studio-row-title">
                    <Link
                      href={href(`/studio/memories/${memory.entryId}`)}
                      lang={memory.locale}
                    >
                      {memory.title}
                    </Link>
                  </span>
                  <span className="studio-meta">
                    {words.memories.kind} ·{" "}
                    {songsLine(words, memory.recordingTitles)}
                  </span>
                  <span
                    className="studio-excerpt"
                    lang={memory.excerpt ? memory.locale : undefined}
                  >
                    {memory.excerpt || words.album.nothingWritten}
                  </span>
                  <span className="studio-meta">
                    {w.deletedOn(
                      memory.deletedAt
                        ? formatDate(locale, memory.deletedAt)
                        : "",
                    )}
                    {" · "}
                    {versionsLine(memory.versions)}
                  </span>
                </span>
                <span className="studio-entry-end">
                  <RestoreMemoryButton
                    entryId={memory.entryId}
                    title={memory.title}
                    wasPublished={memory.versions.some(
                      (version) => version.status === "published",
                    )}
                  />
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </StudioFrame>
  );
}
