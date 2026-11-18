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
import { failureMessage } from "@/app/studio/messages";
import { useStudio } from "@/app/studio/studio-locale";
import type { VisibilityStatus } from "@/modules/journals";

type PrivateStatus = "draft" | "private";

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
  locale,
  title,
  status,
  dirty,
}: {
  entryId: string;
  /**
   * The language the memory is written in: its one language version, the one
   * these controls act on. Content, never the interface's language.
   */
  locale: "en" | "pt-BR";
  /** For accessible names only. */
  title: string;
  status: VisibilityStatus;
  /** Unsaved changes in the editor: publishing and deleting wait for a save. */
  dirty: boolean;
}) {
  const router = useRouter();
  const { words: t, href } = useStudio();
  const w = t.memoryControls;
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
        locale,
        status: next,
        expectedStatus: status,
      }),
    );
    setAsking(undefined);
    if (result.ok) {
      setMessage(
        unpublishing
          ? w.unpublished(next)
          : next === "private"
            ? w.nowPrivate
            : w.backToDraft,
      );
    }
    if (result.ok || result.code === "status_changed") {
      router.refresh();
    }
  }

  function published() {
    setAsking(undefined);
    setMessage(w.published(t.publicPageNote));
    router.refresh();
  }

  async function remove() {
    const result = await run(() => deleteMemoryAction(entryId));
    setAsking(undefined);
    if (result.ok) {
      router.push(href("/studio/memories?deleted=1"));
    }
  }

  return (
    <>
      <section aria-labelledby={visibilityId} className="space-y-2">
        <h2 id={visibilityId} className="studio-label">
          {w.visibility}
        </h2>
        <p className="studio-hint">{w.states[status]}</p>
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
              {t.visibility.unpublish}
            </button>
          </div>
        ) : (
          <div
            className="studio-actions"
            role="group"
            aria-label={w.privateState}
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
              {t.memoryStatus.draft}
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
              {t.memoryStatus.private}
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
                  setMessage(w.saveFirst);
                  return;
                }
                clearFailure();
                setMessage("");
                setAsking("publish");
              }}
            >
              {t.visibility.publish}
            </button>
          </div>
        )}
        <p id={`${visibilityId}-publish`} className="studio-hint">
          {status === "published"
            ? w.publishedHint(t.publicPageNote)
            : dirty
              ? w.saveFirst
              : t.visibility.privateHint}
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
          {w.remove}
        </button>
        <p id={`${visibilityId}-delete`} className="studio-hint">
          {dirty ? w.saveBeforeDelete : w.songsStay}
        </p>
      </div>

      {failure ? (
        <p role="alert" className="studio-problem" style={{ maxWidth: "52ch" }}>
          {failureMessage(t, failure, "memory")}
        </p>
      ) : null}

      <ConfirmDialog
        open={asking === "delete"}
        title={w.removeQuestion}
        confirmLabel={w.removeConfirm}
        pending={pending}
        onConfirm={remove}
        onCancel={() => setAsking(undefined)}
      >
        <p>{w.removeBody(title)}</p>
      </ConfirmDialog>
      <MemoryPublishDialog
        entryId={entryId}
        locale={locale}
        open={asking === "publish"}
        onClose={() => setAsking(undefined)}
        onPublished={published}
      />

      <ConfirmDialog
        open={asking === "unpublish"}
        title={w.unpublishQuestion}
        confirmLabel={t.visibility.unpublishConfirm}
        pending={pending}
        onConfirm={() => void setStatus(after)}
        onCancel={() => setAsking(undefined)}
      >
        <div className="space-y-3">
          <p>{w.unpublishBody}</p>
          <SelectField
            label={t.visibility.after}
            value={after}
            onChange={(value) => setAfter(value as PrivateStatus)}
            options={[
              { value: "private", label: t.visibility.afterPrivate },
              { value: "draft", label: t.visibility.afterDraft },
            ]}
          />
        </div>
      </ConfirmDialog>
    </>
  );
}
