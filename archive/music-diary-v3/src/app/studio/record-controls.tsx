"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import type { RecordKind } from "@/i18n/studio/en";

import { ConfirmDialog, useSubmission } from "./form-kit";
import { failureMessage } from "./messages";
import type { ActionResult } from "./results";
import { useStudio } from "./studio-locale";

type RecordAction = (id: string) => Promise<ActionResult>;

interface RecordControlsProps {
  id: string;
  /** What the record is, for the words about it. */
  kind: RecordKind;
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
  kind,
  archived,
  archive,
  restore,
  remove,
  archiveNote,
  afterDelete,
}: RecordControlsProps) {
  const router = useRouter();
  const { words } = useStudio();
  const w = words.records;
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
            {w.restore[kind]}
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
            {w.archive[kind]}
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
          {w.remove[kind]}
        </button>
      </div>

      <p role="status" className={failure ? "studio-problem" : "studio-hint"}>
        {failure ? failureMessage(words, failure) : ""}
      </p>

      <ConfirmDialog
        open={asking === "archive"}
        title={w.archiveQuestion[kind]}
        confirmLabel={w.archiveConfirm}
        pending={pending}
        onConfirm={() => perform(archive, () => router.refresh())}
        onCancel={() => setAsking(undefined)}
      >
        <p>{archiveNote}</p>
      </ConfirmDialog>

      <ConfirmDialog
        open={asking === "delete"}
        title={w.removeQuestion[kind]}
        confirmLabel={w.removeConfirm}
        pending={pending}
        onConfirm={() => perform(remove, () => router.push(afterDelete))}
        onCancel={() => setAsking(undefined)}
      >
        <p>{w.removeBody[kind]}</p>
      </ConfirmDialog>
    </div>
  );
}
