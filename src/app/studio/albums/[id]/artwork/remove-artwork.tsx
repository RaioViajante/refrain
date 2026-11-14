"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { removeAlbumArtworkAction } from "@/app/studio/albums/actions";
import { ConfirmDialog, useSubmission } from "@/app/studio/form-kit";
import { failureMessage } from "@/app/studio/messages";
import { useStudio } from "@/app/studio/studio-locale";

// Removing an album's cover, after a confirmation: the cover takedown (ADR
// 0006 A8). It is offered whenever a cover is stored, in every state of the
// artwork page: while a published journal shows the album, for an archived
// album, for an album not linked to MusicBrainz, while the Cover Art Archive
// is unreachable, and while the cover display switch is off. It sends a
// fingerprint of the cover the author is looking at (`expectedCover`, never
// its address), so a cover chosen elsewhere meanwhile is never removed
// unseen. Cancelling sends nothing.
//
// The component stays mounted when there is nothing (left) to remove, so its
// status line survives the page's refresh: after a removal it says so, and
// focus moves to the page's heading (`focusId`) instead of being lost with
// the button.

export function RemoveArtwork({
  albumId,
  expectedCover,
  hasArtwork,
  focusId,
}: {
  albumId: string;
  /** The stored cover's fingerprint, or null when none is stored. */
  expectedCover: string | null;
  /** Whether a cover is stored, shown or not. */
  hasArtwork: boolean;
  focusId: string;
}) {
  const router = useRouter();
  const { words } = useStudio();
  const w = words.artworkPage;
  const { pending, failure, run, clearFailure } = useSubmission();
  const [open, setOpen] = useState(false);
  const [removed, setRemoved] = useState(false);

  async function remove() {
    const result = await run(() =>
      removeAlbumArtworkAction({ albumId, expectedCover }),
    );
    setOpen(false);
    if (result.ok) {
      setRemoved(true);
      router.refresh();
    }
  }

  // Once the refreshed page shows no cover (and the dialog has given focus
  // back to the button that is now gone), focus the page's heading.
  useEffect(() => {
    if (removed && !hasArtwork) {
      document.getElementById(focusId)?.focus();
    }
  }, [removed, hasArtwork, focusId]);

  return (
    <>
      {hasArtwork ? (
        <div className="studio-actions">
          <button
            type="button"
            className="studio-button"
            disabled={pending}
            onClick={() => {
              clearFailure();
              setRemoved(false);
              setOpen(true);
            }}
          >
            {w.remove}
          </button>
        </div>
      ) : null}
      <p
        role={failure ? "alert" : "status"}
        className={failure ? "studio-problem" : "studio-hint"}
        style={{ maxWidth: "62ch" }}
      >
        {pending
          ? w.removePending
          : failure
            ? failureMessage(words, failure)
            : removed
              ? w.removed
              : ""}
      </p>
      <ConfirmDialog
        open={open}
        title={w.removeQuestion}
        confirmLabel={w.removeConfirm}
        pending={pending}
        onConfirm={remove}
        onCancel={() => setOpen(false)}
      >
        <p>{w.removeBody}</p>
      </ConfirmDialog>
    </>
  );
}
