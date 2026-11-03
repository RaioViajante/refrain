"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { removeArtistPhotoAction } from "@/app/studio/artists/actions";
import { ConfirmDialog, useSubmission } from "@/app/studio/form-kit";
import { failureMessage } from "@/app/studio/messages";

// Removing an artist's photograph (M3.3), after a confirmation. It sends the
// photograph the author is looking at (`expectedPhoto`), so a change made
// elsewhere meanwhile is never removed unseen. Cancelling sends nothing.
//
// The component stays mounted when there is nothing (left) to remove, so its
// status line survives the page's refresh: after a removal it says so, and
// focus moves to the section's heading (`focusId`) instead of being lost
// with the button.

export function RemovePhoto({
  artistId,
  name,
  expectedPhoto,
  focusId,
}: {
  artistId: string;
  name: string;
  /** The photograph on file, or null when there is none. */
  expectedPhoto: string | null;
  focusId: string;
}) {
  const router = useRouter();
  const { pending, failure, run, clearFailure } = useSubmission();
  const [open, setOpen] = useState(false);
  const [removed, setRemoved] = useState(false);

  async function remove() {
    if (expectedPhoto === null) {
      return;
    }
    const result = await run(() =>
      removeArtistPhotoAction({ artistId, expectedPhoto }),
    );
    setOpen(false);
    if (result.ok) {
      setRemoved(true);
      router.refresh();
    }
  }

  // Once the refreshed page shows no photograph (and the dialog has given
  // focus back to the button that is now gone), focus the section heading.
  useEffect(() => {
    if (removed && expectedPhoto === null) {
      document.getElementById(focusId)?.focus();
    }
  }, [removed, expectedPhoto, focusId]);

  return (
    <>
      {expectedPhoto !== null ? (
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
            Remove the photograph…
          </button>
        </div>
      ) : null}
      <p
        role={failure ? "alert" : "status"}
        className={failure ? "studio-problem" : "studio-hint"}
        style={{ maxWidth: "62ch" }}
      >
        {pending
          ? "Removing…"
          : failure
            ? failureMessage(failure)
            : removed
              ? "Photograph removed, with its credit and record."
              : ""}
      </p>
      <ConfirmDialog
        open={open}
        title={`Remove the photograph of ${name}?`}
        confirmLabel="Remove"
        pending={pending}
        onConfirm={remove}
        onCancel={() => setOpen(false)}
      >
        <p>
          The artist shows the “no photograph yet” frame again, and the
          photograph’s credit and record are removed with it. You can choose a
          photograph again at any time.
        </p>
      </ConfirmDialog>
    </>
  );
}
