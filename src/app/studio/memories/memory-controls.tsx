"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";

import {
  ConfirmDialog,
  SelectField,
  useSubmission,
} from "@/app/studio/form-kit";
import { Icon } from "@/app/studio/icons";
import {
  deleteMemoryAction,
  setMemoryPrivacyAction,
} from "@/app/studio/memories/actions";
import { MemoryPublishDialog } from "@/app/studio/memories/memory-publish-dialog";
import { failureMessage, PUBLIC_PAGE_NOTE } from "@/app/studio/messages";
import type { VisibilityStatus } from "@/modules/journals";

type PrivateStatus = "draft" | "private";

const VISIBILITY_WORDS: Record<VisibilityStatus, string> = {
  draft: "Draft. Unfinished and private.",
  private: "Private. Only you can see it.",
  published:
    "Published. Saving a change readers would see shows you what changes, and asks first.",
};

/**
 * Who can see a memory, and moving it to Recently deleted (M3.6, M3.7).
 * Draft and Private are the private states. Publish… shows the author exactly
 * what readers would see and publishes only on their confirmation (the same
 * review and token as an album journal's); Unpublish… asks first, takes the
 * memory away from readers, and deletes nothing. Publishing and deleting wait
 * until the editor's changes are saved, so what is reviewed is what is saved.
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
  /** Unsaved changes in the editor: publishing and deleting wait for a save. */
  dirty: boolean;
}) {
  const router = useRouter();
  const visibilityId = useId();
  const { pending, failure, run, clearFailure } = useSubmission();
  const [asking, setAsking] = useState<
    "delete" | "unpublish" | "publish" | undefined
  >();
  const [after, setAfter] = useState<PrivateStatus>("private");
  const [message, setMessage] = useState("");

  async function setStatus(next: PrivateStatus) {
    const unpublishing = status === "published";
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
      setMessage(
        unpublishing
          ? `This memory is no longer published. It is ${next === "private" ? "private" : "a draft"} now. Nothing was deleted.`
          : next === "private"
            ? "Now private."
            : "Back to a draft.",
      );
    }
    if (result.ok || result.code === "status_changed") {
      router.refresh();
    }
  }

  function published() {
    setAsking(undefined);
    setMessage(`This memory is now published. ${PUBLIC_PAGE_NOTE}`);
    router.refresh();
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
                setMessage("");
                setAfter("private");
                setAsking("unpublish");
              }}
            >
              Unpublish…
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
            <button
              type="button"
              className="studio-button"
              disabled={pending}
              // While there are unsaved changes it stays focusable, so the
              // hint under it is reached, and does nothing: a review shows
              // what is saved, never what is only in the editor.
              aria-disabled={dirty || undefined}
              aria-describedby={`${visibilityId}-publish`}
              onClick={() => {
                if (dirty) {
                  setMessage(
                    "Save your changes first: Publish… shows you what is saved.",
                  );
                  return;
                }
                clearFailure();
                setMessage("");
                setAsking("publish");
              }}
            >
              Publish…
            </button>
          </div>
        )}
        <p id={`${visibilityId}-publish`} className="studio-hint">
          {status === "published"
            ? `Saving never changes who can see it. ${PUBLIC_PAGE_NOTE}`
            : dirty
              ? "Save your changes first: Publish… shows you what is saved."
              : "A draft is still being written; private is finished for now. Both are only yours. Publish… shows you exactly what will be published before anything changes."}
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
      <MemoryPublishDialog
        entryId={entryId}
        locale="en"
        open={asking === "publish"}
        onClose={() => setAsking(undefined)}
        onPublished={published}
      />

      <ConfirmDialog
        open={asking === "unpublish"}
        title="Unpublish this memory?"
        confirmLabel="Unpublish"
        pending={pending}
        onConfirm={() => void setStatus(after)}
        onCancel={() => setAsking(undefined)}
      >
        <div className="space-y-3">
          <p>
            It will no longer be published, so no reader can see it. Nothing is
            deleted: the writing, its songs, and its address stay as they are.
            You can publish it again later; that will show you what would be
            published first.
          </p>
          <SelectField
            label="After unpublishing, it is"
            value={after}
            onChange={(value) => setAfter(value as PrivateStatus)}
            options={[
              { value: "private", label: "Private (finished for now)" },
              { value: "draft", label: "A draft (still being written)" },
            ]}
          />
        </div>
      </ConfirmDialog>
    </>
  );
}
