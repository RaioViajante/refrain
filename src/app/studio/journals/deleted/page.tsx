import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { Suspense } from "react";

import { accessDenied } from "@/app/studio/access";
import { formatDate } from "@/app/studio/format";
import { StudioFrame } from "@/app/studio/frame";
import { Icon } from "@/app/studio/icons";
import { RestoreJournalButton } from "@/app/studio/journals/restore-button";
import { StudioLoading } from "@/app/studio/studio-loading";
import { authorizeAuthor } from "@/modules/identity";
import { listDeletedAlbumJournals } from "@/modules/journals";

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
  const deleted = await listDeletedAlbumJournals(authorization.author);

  return (
    <StudioFrame current="journals">
      <p>
        <Link href="/studio/journals" className="studio-link">
          ← Journals
        </Link>
      </p>
      <h1 className="studio-title">Recently deleted</h1>
      <p className="studio-lede">
        Journals you moved here are not erased: the writing stays in the
        database, and nothing removes it automatically. Restoring brings a
        journal back to your journals, as it was. Permanent deletion is not
        offered yet.
      </p>
      <p className="studio-hint" style={{ maxWidth: "62ch" }}>
        A journal that was published when it was deleted comes back as private.
        Restoring never publishes anything; publishing it again shows you
        everything it would make public first, including any track reflections
        you had set to show.
      </p>

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
    </StudioFrame>
  );
}
