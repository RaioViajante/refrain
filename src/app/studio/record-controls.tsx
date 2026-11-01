"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { ConfirmDialog, useSubmission } from "./form-kit";
import { failureMessage } from "./messages";
import type { ActionResult } from "./results";

type RecordAction = (id: string) => Promise<ActionResult>;

interface RecordControlsProps {
  id: string;
  /** "artist", "album", or "track". */
  noun: string;
  archived: boolean;
  archive: RecordAction;
  restore: RecordAction;
  remove: RecordAction;
  /** What archiving leaves in place, and how much writing it touches. */
  archiveNote: string;
  /** Where to go once the record is deleted. */
  afterDelete: string;
}

/**
 * Archive, restore, and delete for a catalog record. Archiving hides the
 * record from pickers and deletes nothing. Delete only works when nothing
 * refers to the record; otherwise the studio says what does and offers the
 * archive instead. Both ask first.
 */
export function RecordControls({
  id,
  noun,
  archived,
  archive,
  restore,
  remove,
  archiveNote,
  afterDelete,
}: RecordControlsProps) {
  const router = useRouter();
  const { pending, failure, run, clearFailure } = useSubmission();
  const [asking, setAsking] = useState<"archive" | "delete" | undefined>();

  async function perform(
    action: RecordAction,
    then: () => void,
  ): Promise<void> {
    const result = await run(() => action(id));
    setAsking(undefined);
    if (result.ok) {
      then();
    }
  }

  return (
    <div className="space-y-4">
      <div className="studio-actions">
        {archived ? (
          <button
            type="button"
            className="studio-button"
            disabled={pending}
            onClick={() => perform(restore, () => router.refresh())}
          >
            Restore {noun}
          </button>
        ) : (
          <button
            type="button"
            className="studio-button"
            disabled={pending}
            onClick={() => {
              clearFailure();
              setAsking("archive");
            }}
          >
            Archive {noun}…
          </button>
        )}
        <button
          type="button"
          className="studio-button"
          disabled={pending}
          onClick={() => {
            clearFailure();
            setAsking("delete");
          }}
        >
          <svg
            aria-hidden
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            style={{ display: "inline", marginRight: 8, verticalAlign: "-2px" }}
          >
            <path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5M7 7v4M9 7v4" />
          </svg>
          Delete {noun}…
        </button>
      </div>

      <p role="status" className={failure ? "studio-problem" : "studio-hint"}>
        {failure ? failureMessage(failure) : ""}
      </p>

      <ConfirmDialog
        open={asking === "archive"}
        title={`Archive this ${noun}?`}
        confirmLabel="Archive"
        pending={pending}
        onConfirm={() => perform(archive, () => router.refresh())}
        onCancel={() => setAsking(undefined)}
      >
        <p>{archiveNote}</p>
      </ConfirmDialog>

      <ConfirmDialog
        open={asking === "delete"}
        title={`Delete this ${noun}?`}
        confirmLabel="Delete"
        pending={pending}
        onConfirm={() => perform(remove, () => router.push(afterDelete))}
        onCancel={() => setAsking(undefined)}
      >
        <p>
          This removes the {noun} from your catalog for good. It only works when
          nothing refers to it: if anything does, nothing is deleted, and you
          can archive it instead. Your writing is never deleted by this.
        </p>
      </ConfirmDialog>
    </div>
  );
}
