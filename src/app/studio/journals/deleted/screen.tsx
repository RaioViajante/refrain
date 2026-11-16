import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { Suspense } from "react";

import { accessDenied } from "@/app/studio/access";
import { StudioFrame } from "@/app/studio/frame";
import { RestoreJournalButton } from "@/app/studio/journals/restore-button";
import { songsLine } from "@/app/studio/memories/memory-rows";
import { RestoreMemoryButton } from "@/app/studio/memories/restore-memory-button";
import { StudioLoading } from "@/app/studio/studio-loading";
import { studio } from "@/app/studio/studio-words";
import { formatDate } from "@/i18n/format";
import type { InterfaceLocale } from "@/i18n/locales";
import { v3StringsFor } from "@/i18n/v3";
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
  const [deleted, deletedMemories] = await Promise.all([
    listDeletedAlbumJournals(authorization.author),
    listDeletedMemories(authorization.author),
  ]);

  // The v3 Bin (ADR 0011, proposed): the reference's panels, lists, and "In
  // the bin" tag. What a restore will do (each version's status), the
  // writing's first words, and the restore dialogs are unchanged (ADR 0005).
  const v3 = v3StringsFor(locale).library;

  return (
    <StudioFrame
      locale={locale}
      path="/studio/journals/deleted"
      current="journals"
      layout="wide"
    >
      <p className="bin-back">
        <Link href={href("/studio/journals")} className="lnk">
          {words.newJournal.back}
        </Link>
      </p>
      <h1 className="t1">{w.title}</h1>
      <p className="sub">{w.lead}</p>
      <p className="sub bin-hint">{w.hint}</p>

      <section aria-labelledby="deleted-journals" className="panel bin-panel">
        <div className="sec">
          <h2 id="deleted-journals">{w.journals}</h2>
        </div>
        {deleted.length === 0 ? (
          <div className="sec">
            <p className="bin-empty">{w.nothingHere}</p>
            <p className="hint">{w.noJournal}</p>
          </div>
        ) : (
          <ul className="list" aria-label={w.journalsLabel}>
            {deleted.map((journal) => {
              const wasPublished = journal.versions.some(
                (version) => version.status === "published",
              );
              return (
                <li key={journal.entryId} className="bin-row">
                  <span className="bin-body">
                    <Link
                      href={href(`/studio/journals/${journal.entryId}`)}
                      className="ti"
                    >
                      {journal.albumTitle}
                    </Link>
                    <span className="m">{journal.artistNames}</span>
                    <span
                      className="m bin-excerpt"
                      lang={journal.excerpt ? journal.locale : undefined}
                    >
                      {journal.excerpt || words.album.nothingWritten}
                    </span>
                    <span className="m">
                      {w.deletedOn(
                        journal.deletedAt
                          ? formatDate(locale, journal.deletedAt)
                          : "",
                      )}
                      {" · "}
                      {versionsLine(journal.versions)}
                    </span>
                  </span>
                  <span className="bin-end">
                    <span className="tag">{v3.binS}</span>
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
      </section>

      <section aria-labelledby="deleted-memories" className="panel bin-panel">
        <div className="sec">
          <h2 id="deleted-memories">{w.memories}</h2>
        </div>
        {deletedMemories.length === 0 ? (
          <div className="sec">
            <p className="hint">{w.noMemory}</p>
          </div>
        ) : (
          <ul className="list" aria-label={w.memoriesLabel}>
            {deletedMemories.map((memory) => (
              <li key={memory.entryId} className="bin-row">
                <span className="bin-body">
                  <Link
                    href={href(`/studio/memories/${memory.entryId}`)}
                    lang={memory.locale}
                    className="ti"
                  >
                    {memory.title}
                  </Link>
                  <span className="m">
                    {words.memories.kind} ·{" "}
                    {songsLine(words, memory.recordingTitles)}
                  </span>
                  <span
                    className="m bin-excerpt"
                    lang={memory.excerpt ? memory.locale : undefined}
                  >
                    {memory.excerpt || words.album.nothingWritten}
                  </span>
                  <span className="m">
                    {w.deletedOn(
                      memory.deletedAt
                        ? formatDate(locale, memory.deletedAt)
                        : "",
                    )}
                    {" · "}
                    {versionsLine(memory.versions)}
                  </span>
                </span>
                <span className="bin-end">
                  <span className="tag">{v3.binS}</span>
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
