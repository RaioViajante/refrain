"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";

import { ConfirmDialog, useSubmission } from "@/app/studio/form-kit";
import { Icon } from "@/app/studio/icons";
import {
  deleteMemoryAction,
  setMemoryPrivacyAction,
} from "@/app/studio/memories/actions";
import { failureMessage } from "@/app/studio/messages";
import type { VisibilityStatus } from "@/modules/journals";

const VISIBILITY_WORDS: Record<VisibilityStatus, string> = {
  draft: "Draft. Unfinished and private.",
  private: "Private. Only you can see it.",
  published:
    "Published in your records. Saving is paused until you make it private.",
};

/**
 * Who can see a memory, and moving it to Recently deleted. Draft and Private
 * are the only states offered: publishing a memory is not built yet (M3.7),
 * and the studio says so instead of showing a control that cannot work. A
 * version that is published anyway (only a write outside the studio could do
 * it) can be made private, which only takes it away from readers.
 */
export function MemoryControls({
  entryId,
  title,
  status,
  dirty,
}: {
  entryId: string;
  /** For accessible names only. */
  title: string;
  status: VisibilityStatus;
  /** Unsaved changes in the editor: deleting waits until they are saved. */
  dirty: boolean;
}) {
  const router = useRouter();
  const visibilityId = useId();
  const { pending, failure, run, clearFailure } = useSubmission();
  const [asking, setAsking] = useState<"delete" | "unpublish" | undefined>();
  const [message, setMessage] = useState("");

  async function setStatus(next: "draft" | "private") {
    setMessage("");
    const result = await run(() =>
      setMemoryPrivacyAction({
        entryId,
        locale: "en",
        status: next,
        expectedStatus: status,
      }),
    );
    setAsking(undefined);
    if (result.ok) {
      setMessage(next === "private" ? "Now private." : "Back to a draft.");
    }
    if (result.ok || result.code === "status_changed") {
      router.refresh();
    }
  }

  async function remove() {
    const result = await run(() => deleteMemoryAction(entryId));
    setAsking(undefined);
    if (result.ok) {
      router.push("/studio/memories?deleted=1");
    }
  }

  return (
    <>
      <section aria-labelledby={visibilityId} className="space-y-2">
        <h2 id={visibilityId} className="studio-label">
          Visibility
        </h2>
        <p className="studio-hint">{VISIBILITY_WORDS[status]}</p>
        {status === "published" ? (
          <div className="studio-actions">
            <button
              type="button"
              className="studio-button"
              disabled={pending}
              onClick={() => {
                clearFailure();
                setAsking("unpublish");
              }}
            >
              Make private…
            </button>
          </div>
        ) : (
          <div
            className="studio-actions"
            role="group"
            aria-label="Private state of this memory"
          >
            <button
              type="button"
              className={`studio-button ${status === "draft" ? "studio-button-primary" : ""}`}
              aria-pressed={status === "draft"}
              disabled={pending}
              onClick={() => {
                clearFailure();
                if (status !== "draft") {
                  void setStatus("draft");
                }
              }}
            >
              Draft
            </button>
            <button
              type="button"
              className={`studio-button ${status === "private" ? "studio-button-primary" : ""}`}
              aria-pressed={status === "private"}
              disabled={pending}
              onClick={() => {
                clearFailure();
                if (status !== "private") {
                  void setStatus("private");
                }
              }}
            >
              Private
            </button>
          </div>
        )}
        <p className="studio-hint">
          Publishing memories isn’t available yet, so a memory stays yours
          alone. Saving never changes who can see it.
        </p>
        <p role="status" className="studio-hint">
          {message}
        </p>
      </section>

      <hr className="studio-rule" />

      <div className="space-y-2">
        <button
          type="button"
          className="studio-button"
          disabled={pending}
          // While there are unsaved changes it stays focusable, so the hint
          // under it is reached, and does nothing.
          aria-disabled={dirty || undefined}
          aria-describedby={`${visibilityId}-delete`}
          onClick={() => {
            if (dirty) {
              return;
            }
            clearFailure();
            setAsking("delete");
          }}
        >
          <Icon name="trash" size={17} />
          Delete…
        </button>
        <p id={`${visibilityId}-delete`} className="studio-hint">
          {dirty
            ? "Save your changes first, or they would be lost."
            : "Its songs stay in your catalog."}
        </p>
      </div>

      {failure ? (
        <p role="alert" className="studio-problem" style={{ maxWidth: "52ch" }}>
          {failureMessage(failure, "memory")}
        </p>
      ) : null}

      <ConfirmDialog
        open={asking === "delete"}
        title="Delete this memory?"
        confirmLabel="Delete memory"
        pending={pending}
        onConfirm={remove}
        onCancel={() => setAsking(undefined)}
      >
        <p>
          “{title}” moves to Recently deleted. Its writing is kept there, and
          nothing removes it automatically: you can restore it whenever you
          want. Its songs stay in your catalog.
        </p>
      </ConfirmDialog>
      <ConfirmDialog
        open={asking === "unpublish"}
        title="Make this memory private?"
        confirmLabel="Make private"
        pending={pending}
        onConfirm={() => void setStatus("private")}
        onCancel={() => setAsking(undefined)}
      >
        <p>
          It stops being marked as published and becomes private. Nothing is
          deleted.
        </p>
      </ConfirmDialog>
    </>
  );
}
