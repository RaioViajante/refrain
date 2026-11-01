"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { ConfirmDialog, useSubmission } from "@/app/studio/form-kit";
import { restoreJournalAction } from "@/app/studio/journals/actions";
import { failureMessage } from "@/app/studio/messages";

/**
 * Restores a journal from Recently deleted, after asking. It says what the
 * restore does under the owner-accepted policy: the writing returns whole, a
 * version that was published returns as private, and nothing is published.
 * Afterwards it opens the restored journal, which names the outcome.
 */
export function RestoreJournalButton({
  entryId,
  albumTitle,
  wasPublished,
}: {
  entryId: string;
  /** For the accessible name only: the album the journal is about. */
  albumTitle: string;
  /** Whether any language version was published when the journal was deleted. */
  wasPublished: boolean;
}) {
  const router = useRouter();
  const { pending, failure, run, clearFailure } = useSubmission();
  const [asking, setAsking] = useState(false);

  async function restore() {
    const result = await run(() => restoreJournalAction(entryId));
    setAsking(false);
    if (result.ok) {
      router.push(
        `/studio/journals/${entryId}?restored=${result.data.madePrivate.length > 0 ? "private" : "1"}`,
      );
    }
    // A refusal (already restored somewhere else, or gone) is said in words
    // right here. The list is not refreshed: the row would vanish and take the
    // explanation with it. The message tells the author to reload.
  }

  return (
    <div>
      <button
        type="button"
        className="studio-button"
        disabled={pending}
        aria-label={`Restore the journal about ${albumTitle}`}
        onClick={() => {
          clearFailure();
          setAsking(true);
        }}
      >
        Restore…
      </button>
      {failure ? (
        <p role="alert" className="studio-problem" style={{ maxWidth: "62ch" }}>
          {failureMessage(failure)}
        </p>
      ) : null}
      <ConfirmDialog
        open={asking}
        title="Restore this journal?"
        confirmLabel="Restore journal"
        pending={pending}
        onConfirm={restore}
        onCancel={() => setAsking(false)}
      >
        <p>
          The journal returns to your journals with its writing exactly as you
          left it.{" "}
          {wasPublished
            ? "Part of it was published when it was deleted. That part comes back as private, and nothing is published again until you choose to publish it."
            : "Drafts stay drafts and private stays private."}
        </p>
      </ConfirmDialog>
    </div>
  );
}
