"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { ConfirmDialog, useSubmission } from "@/app/studio/form-kit";
import { restoreMemoryAction } from "@/app/studio/memories/actions";
import { failureMessage } from "@/app/studio/messages";
import { useStudio } from "@/app/studio/studio-locale";

/**
 * Restores a memory from Recently deleted, after asking. The writing and its
 * songs return whole; a version that was published returns as private, and
 * nothing is published. Afterwards it opens the restored memory.
 */
export function RestoreMemoryButton({
  entryId,
  title,
  wasPublished,
}: {
  entryId: string;
  /** For the accessible name only. */
  title: string;
  wasPublished: boolean;
}) {
  const router = useRouter();
  const { words, href } = useStudio();
  const w = words.restoreMemory;
  const { pending, failure, run, clearFailure } = useSubmission();
  const [asking, setAsking] = useState(false);

  async function restore() {
    const result = await run(() => restoreMemoryAction(entryId));
    setAsking(false);
    if (result.ok) {
      router.push(
        href(
          `/studio/memories/${entryId}?restored=${result.data.madePrivate.length > 0 ? "private" : "1"}`,
        ),
      );
    }
  }

  return (
    <div>
      <button
        type="button"
        className="studio-button"
        disabled={pending}
        aria-label={w.label(title)}
        onClick={() => {
          clearFailure();
          setAsking(true);
        }}
      >
        {words.restoreJournal.action}
      </button>
      {failure ? (
        <p role="alert" className="studio-problem" style={{ maxWidth: "62ch" }}>
          {failureMessage(words, failure, "memory")}
        </p>
      ) : null}
      <ConfirmDialog
        open={asking}
        title={w.question}
        confirmLabel={w.confirmLabel}
        pending={pending}
        onConfirm={restore}
        onCancel={() => setAsking(false)}
      >
        <p>
          {w.body} {wasPublished ? w.wasPublished : w.stays}
        </p>
      </ConfirmDialog>
    </div>
  );
}
