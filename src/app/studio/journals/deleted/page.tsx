import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { Suspense } from "react";

import { accessDenied } from "@/app/studio/access";
import { formatDate } from "@/app/studio/format";
import { StudioFrame } from "@/app/studio/frame";
import { Icon } from "@/app/studio/icons";
import { RestoreJournalButton } from "@/app/studio/journals/restore-button";
import { songsLine } from "@/app/studio/memories/memory-rows";
import { RestoreMemoryButton } from "@/app/studio/memories/restore-memory-button";
import { StudioLoading } from "@/app/studio/studio-loading";
import { authorizeAuthor } from "@/modules/identity";
import {
  listDeletedAlbumJournals,
  listDeletedMemories,
} from "@/modules/journals";

// A fixed title: a journal's words never reach page metadata.
export const metadata: Metadata = { title: "Recently deleted · refrain" };

const LANGUAGE_NAMES = {
  en: "English",
  "pt-BR": "Português (Brasil)",
} as const;

export default function RecentlyDeletedPage() {
  return (
    <Suspense fallback={<StudioLoading />}>
      <RecentlyDeleted />
    </Suspense>
  );
}

async function RecentlyDeleted() {
  const authorization = await authorizeAuthor(await headers());
  if (!authorization.ok) {
    return accessDenied(authorization.reason);
  }
  const [deleted, deletedMemories] = await Promise.all([
    listDeletedAlbumJournals(authorization.author),
    listDeletedMemories(authorization.author),
  ]);

  return (
    <StudioFrame current="journals">
      <p>
        <Link href="/studio/journals" className="studio-link">
          ← Journals
        </Link>
      </p>
      <h1 className="studio-title">Recently deleted</h1>
      <p className="studio-lede">
        Journals and memories you moved here are not erased: the writing stays
        in the database, and nothing removes it automatically. Restoring brings
        it back as it was. Permanent deletion is not offered yet.
      </p>
      <p className="studio-hint" style={{ maxWidth: "62ch" }}>
        A journal that was published when it was deleted comes back as private.
        Restoring never publishes anything; publishing it again shows you
        everything it would publish first, including any track reflections you
        had set to be included when published.
      </p>

      <h2 className="studio-section-title">Journals</h2>
      {deleted.length === 0 ? (
        <div className="studio-panel">
          <p className="studio-section-title">Nothing here</p>
          <p>No journal is in Recently deleted.</p>
        </div>
      ) : (
        <ul className="studio-list" aria-label="Recently deleted journals">
          {deleted.map((journal) => {
            const wasPublished = journal.versions.some(
              (version) => version.status === "published",
            );
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
                  <span className="studio-meta">{journal.artistNames}</span>
                  <span
                    className="studio-excerpt"
                    lang={journal.excerpt ? journal.locale : undefined}
                  >
                    {journal.excerpt || "Nothing written yet"}
                  </span>
                  <span className="studio-meta">
                    deleted{" "}
                    {journal.deletedAt ? formatDate(journal.deletedAt) : ""}
                    {" · "}
                    {journal.versions
                      .map(
                        (version) =>
                          `${LANGUAGE_NAMES[version.locale]}: ${version.status}${version.status === "published" ? ", returns as private" : ""}`,
                      )
                      .join("; ")}
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
          Memories
        </h2>
        {deletedMemories.length === 0 ? (
          <div className="studio-panel">
            <p>No memory is in Recently deleted.</p>
          </div>
        ) : (
          <ul className="studio-list" aria-label="Recently deleted memories">
            {deletedMemories.map((memory) => (
              <li key={memory.entryId} className="studio-row studio-entry">
                <span className="studio-thumb" aria-hidden="true">
                  <Icon name="note" size={26} />
                </span>
                <span className="studio-entry-body">
                  <span className="studio-row-title">
                    <Link
                      href={`/studio/memories/${memory.entryId}`}
                      lang={memory.locale}
                    >
                      {memory.title}
                    </Link>
                  </span>
                  <span className="studio-meta">
                    Memory · {songsLine(memory.recordingTitles)}
                  </span>
                  <span
                    className="studio-excerpt"
                    lang={memory.excerpt ? memory.locale : undefined}
                  >
                    {memory.excerpt || "Nothing written yet"}
                  </span>
                  <span className="studio-meta">
                    deleted{" "}
                    {memory.deletedAt ? formatDate(memory.deletedAt) : ""}
                    {" · "}
                    {memory.versions
                      .map(
                        (version) =>
                          `${LANGUAGE_NAMES[version.locale]}: ${version.status}${version.status === "published" ? ", returns as private" : ""}`,
                      )
                      .join("; ")}
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
