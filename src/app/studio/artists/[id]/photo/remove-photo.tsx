"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { removeArtistPhotoAction } from "@/app/studio/artists/actions";
import { ConfirmDialog, useSubmission } from "@/app/studio/form-kit";
import { failureMessage } from "@/app/studio/messages";

// Removing an artist's photograph (M3.3), after a confirmation. It sends the
// photograph the author is looking at (`expectedPhoto`), so a change made
// elsewhere meanwhile is never removed unseen. Cancelling sends nothing.

export function RemovePhoto({
  artistId,
  name,
  expectedPhoto,
}: {
  artistId: string;
  name: string;
  expectedPhoto: string;
}) {
  const router = useRouter();
  const { pending, failure, run, clearFailure } = useSubmission();
  const [open, setOpen] = useState(false);

  async function remove() {
    const result = await run(() =>
      removeArtistPhotoAction({ artistId, expectedPhoto }),
    );
    setOpen(false);
    if (result.ok) {
      router.refresh();
    }
  }

  return (
    <>
      <div className="studio-actions">
        <button
          type="button"
          className="studio-button"
          disabled={pending}
          onClick={() => {
            clearFailure();
            setOpen(true);
          }}
        >
          Remove the photograph…
        </button>
      </div>
      <p
        role={failure ? "alert" : "status"}
        className={failure ? "studio-problem" : "studio-hint"}
        style={{ maxWidth: "62ch" }}
      >
        {pending ? "Removing…" : failure ? failureMessage(failure) : ""}
      </p>
      <ConfirmDialog
        open={open}
        title={`Remove ${name}’s photograph?`}
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
