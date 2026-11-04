"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { ConfirmDialog, useSubmission } from "@/app/studio/form-kit";
import { restoreMemoryAction } from "@/app/studio/memories/actions";
import { failureMessage } from "@/app/studio/messages";

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
  const { pending, failure, run, clearFailure } = useSubmission();
  const [asking, setAsking] = useState(false);

  async function restore() {
    const result = await run(() => restoreMemoryAction(entryId));
    setAsking(false);
    if (result.ok) {
      router.push(
        `/studio/memories/${entryId}?restored=${result.data.madePrivate.length > 0 ? "private" : "1"}`,
      );
    }
  }

  return (
    <div>
      <button
        type="button"
        className="studio-button"
        disabled={pending}
        aria-label={`Restore the memory “${title}”`}
        onClick={() => {
          clearFailure();
          setAsking(true);
        }}
      >
        Restore…
      </button>
      {failure ? (
        <p role="alert" className="studio-problem" style={{ maxWidth: "62ch" }}>
          {failureMessage(failure, "memory")}
        </p>
      ) : null}
      <ConfirmDialog
        open={asking}
        title="Restore this memory?"
        confirmLabel="Restore memory"
        pending={pending}
        onConfirm={restore}
        onCancel={() => setAsking(false)}
      >
        <p>
          The memory returns to your memories with its writing and its songs
          exactly as you left them.{" "}
          {wasPublished
            ? "It was marked as published when it was deleted, and it comes back as private. Restoring publishes nothing."
            : "A draft stays a draft and private stays private."}
        </p>
      </ConfirmDialog>
    </div>
  );
}
