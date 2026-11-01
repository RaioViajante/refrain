import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { accessDenied } from "@/app/studio/access";
import { StudioFrame } from "@/app/studio/frame";
import { JournalEditor } from "@/app/studio/journals/journal-editor";
import { StudioLoading } from "@/app/studio/studio-loading";
import { authorizeAuthor } from "@/modules/identity";
import { getAlbumJournal } from "@/modules/journals";

export const metadata: Metadata = { title: "Edit a journal · refrain" };

export default function EditJournalPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return (
    <Suspense fallback={<StudioLoading />}>
      <EditJournal params={params} />
    </Suspense>
  );
}

async function EditJournal({ params }: { params: Promise<{ id: string }> }) {
  const authorization = await authorizeAuthor(await headers());
  if (!authorization.ok) {
    return accessDenied(authorization.reason);
  }
  const { id } = await params;
  const journal = await getAlbumJournal(authorization.author, id);
  if (!journal) {
    notFound();
  }

  const back = (
    <p>
      <Link
        href={`/studio/journals/${journal.entryId}`}
        className="studio-link"
      >
        ← The journal
      </Link>
    </p>
  );

  if (journal.deletedAt !== null) {
    return (
      <StudioFrame current="journals">
        {back}
        <h1 className="studio-title">Edit a journal</h1>
        <p className="studio-panel">
          This journal is in Recently deleted, so it can’t be edited. Its
          writing is kept.
        </p>
      </StudioFrame>
    );
  }
  if (journal.body === null) {
    return (
      <StudioFrame current="journals">
        {back}
        <h1 className="studio-title">Edit a journal</h1>
        <p className="studio-panel">
          This text has formatting that the plain editor can’t show without
          losing it, so it can’t be edited here. It is untouched.
        </p>
      </StudioFrame>
    );
  }

  return (
    <StudioFrame current="journals">
      {back}
      <h1 className="studio-title">Edit: {journal.albumTitle}</h1>
      <JournalEditor
        edit={{
          entryId: journal.entryId,
          version: journal.version,
          locale: journal.locale,
        }}
        initial={{ opening: journal.opening ?? "", body: journal.body }}
      />
    </StudioFrame>
  );
}
