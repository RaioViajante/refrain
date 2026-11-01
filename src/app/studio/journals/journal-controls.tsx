"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { ConfirmDialog, useSubmission } from "@/app/studio/form-kit";
import {
  deleteJournalAction,
  setJournalPrivacyAction,
} from "@/app/studio/journals/actions";
import { failureMessage } from "@/app/studio/messages";
import type { VisibilityStatus } from "@/modules/journals";

type PrivateStatus = "draft" | "private";

/**
 * Who can see this journal, and moving it to Recently deleted. Only the two
 * private states can be chosen here: publishing is not offered yet, and the
 * server would refuse it anyway. Deleting asks first, and keeps the writing.
 */
export function JournalControls({
  entryId,
  locale,
  status,
}: {
  entryId: string;
  locale: "en" | "pt-BR";
  status: VisibilityStatus;
}) {
  const router = useRouter();
  const { pending, failure, run, clearFailure } = useSubmission();
  const [asking, setAsking] = useState<PrivateStatus | "delete" | undefined>();
  const [message, setMessage] = useState("");

  async function setStatus(next: PrivateStatus) {
    setMessage("");
    const result = await run(() =>
      setJournalPrivacyAction({ entryId, locale, status: next }),
    );
    setAsking(undefined);
    if (result.ok) {
      setMessage(next === "private" ? "Now private." : "Back to a draft.");
      router.refresh();
    }
  }

  function choose(next: PrivateStatus) {
    clearFailure();
    if (status === "published") {
      setAsking(next);
    } else {
      void setStatus(next);
    }
  }

  async function remove() {
    const result = await run(() => deleteJournalAction(entryId));
    setAsking(undefined);
    if (result.ok) {
      router.push("/studio/journals");
    }
  }

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <p className="studio-label" id="privacy-label">
          Who can see this
        </p>
        <div
          className="studio-actions"
          role="group"
          aria-labelledby="privacy-label"
        >
          <button
            type="button"
            className={`studio-button ${status === "draft" ? "studio-button-primary" : ""}`}
            aria-pressed={status === "draft"}
            disabled={pending}
            onClick={() => choose("draft")}
          >
            Draft
          </button>
          <button
            type="button"
            className={`studio-button ${status === "private" ? "studio-button-primary" : ""}`}
            aria-pressed={status === "private"}
            disabled={pending}
            onClick={() => choose("private")}
          >
            Private
          </button>
        </div>
        <p className="studio-hint" style={{ maxWidth: "52ch" }}>
          A draft is still being written; private is finished for now. Both are
          only yours. Publishing is not available yet, so nothing you write here
          is public.
        </p>
      </div>

      <div>
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
          Move to Recently deleted…
        </button>
      </div>

      <p
        role={failure ? "alert" : "status"}
        className={failure ? "studio-problem" : "studio-hint"}
        style={{ maxWidth: "62ch" }}
      >
        {failure ? failureMessage(failure) : message}
      </p>

      <ConfirmDialog
        open={asking === "draft" || asking === "private"}
        title="Make this version unpublished?"
        confirmLabel={asking === "private" ? "Make private" : "Make a draft"}
        pending={pending}
        onConfirm={() => asking && asking !== "delete" && setStatus(asking)}
        onCancel={() => setAsking(undefined)}
      >
        <p>
          This version is published. Readers will no longer see it. Nothing is
          deleted, and you can change it back later.
        </p>
      </ConfirmDialog>

      <ConfirmDialog
        open={asking === "delete"}
        title="Move this journal to Recently deleted?"
        confirmLabel="Move to Recently deleted"
        pending={pending}
        onConfirm={remove}
        onCancel={() => setAsking(undefined)}
      >
        <p>
          This does not erase the writing. It stays in your database, and
          nothing removes it automatically. The journal leaves your lists, and
          it cannot be edited while it is in Recently deleted. The studio cannot
          restore a journal, or delete one permanently, yet. Albums, artists and
          tracks stay in your catalog.
        </p>
      </ConfirmDialog>
    </div>
  );
}
