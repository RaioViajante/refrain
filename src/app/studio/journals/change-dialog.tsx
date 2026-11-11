"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { ConfirmDialog } from "@/app/studio/form-kit";
import { saveJournalAction } from "@/app/studio/journals/actions";
import { previewPublicChangeAction } from "@/app/studio/journals/preview-change-action";
import {
  changePlace,
  Notice,
  ReviewedValueView,
} from "@/app/studio/journals/review-parts";
import { failureMessage } from "@/app/studio/messages";
import type { ActionResult } from "@/app/studio/results";
import { useStudio } from "@/app/studio/studio-locale";
import type { PublicChangePreviewReview } from "@/modules/journals";

type Failure = Extract<ActionResult<unknown>, { ok: false }>;

type Stage =
  | { name: "loading" }
  // The changes are on screen. Only the confirm control sends the token.
  | { name: "ready"; preview: PublicChangePreviewReview }
  // Refused: what readers would see changed, or the review ran out. Nothing was
  // saved. The author asks for a new review on purpose.
  | { name: "changed" };

/**
 * A save that would change a page that is public (ADR 0006 § 5). It opens
 * with a preview request of exactly the save the editor is about to make, and
 * shows what readers would see added or changed, before and after. The save
 * happens only when the author presses its confirm control, with the token
 * that the preview returned.
 *
 * - The token lives only in this dialog's state and is sent only by `confirm`.
 *   The editor never sees it.
 * - A save that changes nothing a reader sees has no token: the dialog hands
 *   control back (`onNothingToConfirm`) and the editor saves as it always has.
 * - If the server refuses (the review ran out, or something changed), the
 *   dialog says so and drops the token. The author asks for a new review.
 * - Any other refusal closes the dialog and goes back to the editor, which
 *   still holds every word (`onRefused`).
 */
export function ChangeDialog({
  payload,
  onSaved,
  onNothingToConfirm,
  onRefused,
  onCancel,
}: {
  /** The save, exactly as the editor would send it, without a token. */
  payload: Record<string, unknown> | undefined;
  onSaved: (version: number) => void;
  onNothingToConfirm: () => void;
  onRefused: (failure: Failure) => void;
  onCancel: () => void;
}) {
  // It exists only while a save waits: closing drops its state, and the token.
  return payload ? (
    <OpenChangeDialog
      payload={payload}
      onSaved={onSaved}
      onNothingToConfirm={onNothingToConfirm}
      onRefused={onRefused}
      onCancel={onCancel}
    />
  ) : null;
}

function OpenChangeDialog({
  payload,
  onSaved,
  onNothingToConfirm,
  onRefused,
  onCancel,
}: {
  payload: Record<string, unknown>;
  onSaved: (version: number) => void;
  onNothingToConfirm: () => void;
  onRefused: (failure: Failure) => void;
  onCancel: () => void;
}) {
  const { locale: ui, words: t } = useStudio();
  const w = t.change;
  const [stage, setStage] = useState<Stage>({ name: "loading" });
  const busy = useRef(false);
  const loading = stage.name === "loading";
  // Only a running confirmation locks the dialog; reading can be abandoned.
  const [submitting, setSubmitting] = useState(false);

  const fetchPreview = useCallback(async (): Promise<
    ActionResult<PublicChangePreviewReview>
  > => {
    try {
      return await previewPublicChangeAction(payload);
    } catch {
      return { ok: false, code: "failed" };
    }
  }, [payload]);

  const show = useCallback(
    (result: ActionResult<PublicChangePreviewReview>) => {
      if (!result.ok) {
        onRefused(result);
      } else if (result.data.confirmation === null) {
        onNothingToConfirm();
      } else {
        setStage({ name: "ready", preview: result.data });
      }
    },
    [onNothingToConfirm, onRefused],
  );

  // Opening the dialog asks for the review.
  useEffect(() => {
    let current = true;
    void fetchPreview().then((result) => {
      if (current) {
        show(result);
      }
    });
    return () => {
      current = false;
    };
    // One review per opening: later changes to the callbacks must not ask again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchPreview]);

  async function reviewAgain() {
    setStage({ name: "loading" });
    show(await fetchPreview());
  }

  async function confirm() {
    if (busy.current || stage.name !== "ready") {
      return;
    }
    const { confirmation } = stage.preview;
    if (confirmation === null) {
      return;
    }
    busy.current = true;
    setSubmitting(true);
    // A used token is never offered again, whatever happens next.
    setStage({ name: "loading" });
    let result: ActionResult<{ version: number }>;
    try {
      result = await saveJournalAction({ ...payload, confirmation });
    } catch {
      result = { ok: false, code: "unreachable" };
    }
    busy.current = false;
    setSubmitting(false);
    if (result.ok) {
      onSaved(result.data.version);
      return;
    }
    if (
      result.code === "confirmation_required" ||
      result.code === "confirmation_invalid" ||
      result.code === "confirmation_expired" ||
      result.code === "confirmation_stale"
    ) {
      setStage({ name: "changed" });
      return;
    }
    // A conflict, a deleted journal, a session that ended: back to the editor,
    // where the text still is.
    onRefused(result);
  }

  const review = stage.name === "ready" ? stage.preview.review : undefined;
  // A change whose text the plain view cannot show cannot be read here, so it
  // is not confirmed from here.
  const unreadable =
    review !== undefined &&
    review.changes.some((change) =>
      [change.before, change.after].some(
        (value) => value?.type === "text" && value.text === null,
      ),
    );

  return (
    <ConfirmDialog
      open
      review
      title={w.title}
      confirmLabel={w.confirmLabel}
      pending={submitting}
      focusKey={stage.name}
      regionLabel={w.region}
      hideConfirm={stage.name !== "ready" || unreadable}
      onConfirm={confirm}
      onCancel={onCancel}
      cancelLabel={stage.name === "ready" ? t.common.cancel : t.publish.close}
      extraActions={
        stage.name === "changed" ? (
          <button
            type="button"
            className="studio-button studio-button-primary"
            disabled={submitting}
            onClick={() => void reviewAgain()}
          >
            {t.publish.reviewAgain}
          </button>
        ) : null
      }
    >
      <div className="studio-review">
        <div role="status">{loading ? w.reading : null}</div>

        {stage.name === "changed" ? (
          <Notice problem>
            {failureMessage(t, { ok: false, code: "confirmation_stale" })}{" "}
            {w.textKept}
          </Notice>
        ) : null}

        {review ? (
          <>
            {unreadable ? (
              <p className="studio-problem">{w.unreadable}</p>
            ) : null}
            <p>{w.lead(t.publicPageNote)}</p>
            <ul className="studio-review-list">
              {review.changes.map((change, index) => {
                // The language of the writing that changed; a change with
                // none (the album rating) is said in the interface's.
                const lang = change.locale ?? ui;
                const place = changePlace(t, ui, change.label);
                const rest = [
                  change.trackTitle,
                  change.locale
                    ? t.languageInSentence[change.locale]
                    : undefined,
                ].filter(Boolean);
                return (
                  <li key={index}>
                    <h3 className="studio-label">
                      {change.kind === "added" ? w.added : w.changed}
                      {": "}
                      <span lang={place.lang}>{place.text}</span>
                      {rest.length > 0 ? ` · ${rest.join(" · ")}` : ""}
                    </h3>
                    {change.before !== undefined ? (
                      <div>
                        <p className="studio-hint">{w.publishedNow}</p>
                        <ReviewedValueView
                          value={change.before}
                          lang={lang}
                          side="before"
                        />
                      </div>
                    ) : null}
                    <div>
                      <p className="studio-hint">
                        {change.before !== undefined
                          ? w.publishedAfter
                          : w.publishedAfterNew}
                      </p>
                      <ReviewedValueView value={change.after} lang={lang} />
                    </div>
                  </li>
                );
              })}
            </ul>
            <p className="studio-hint">{w.removals}</p>
          </>
        ) : null}
      </div>
    </ConfirmDialog>
  );
}
