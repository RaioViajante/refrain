"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { updateAlbumAction } from "@/app/studio/albums/actions";
import { updateArtistAction } from "@/app/studio/artists/actions";
import {
  previewCatalogChangeAction,
  type CatalogChangeReviewResult,
} from "@/app/studio/catalog/preview-catalog-change-action";
import { ConfirmDialog } from "@/app/studio/form-kit";
import { Notice } from "@/app/studio/journals/review-parts";
import { failureMessage } from "@/app/studio/messages";
import type { ActionResult } from "@/app/studio/results";
import { useStudio } from "@/app/studio/studio-locale";
import { updateTrackAction } from "@/app/studio/tracks/actions";
import type { StudioDictionary } from "@/i18n/studio/en";
import { localizedHref } from "@/i18n/paths";

type Failure = Extract<ActionResult<unknown>, { ok: false }>;

export type CatalogRecordKind = "artist" | "album" | "track";

type Stage =
  | { name: "loading" }
  // The pages are on screen. Only the confirm control sends the token.
  | { name: "ready"; preview: CatalogChangeReviewResult }
  // Refused: what readers would see changed, or the review ran out. Nothing
  // was saved. The author asks for a new review on purpose.
  | { name: "changed" };

/**
 * "Update the published pages?" (ADR 0013 § 2, step 3): a catalog edit that
 * would change the wording of a published page. It opens with a review of
 * exactly the edit the form is about to save: every published page that
 * changes, in each interface language, with each changed piece of wording
 * before and after, and every artist address that moves. The edit is saved
 * only when the author presses its confirm control, with the token the review
 * returned.
 *
 * - The token lives only in this dialog's state and is sent only by `confirm`.
 *   The form never sees it.
 * - An edit that changes no published page has no token: the dialog hands
 *   control back (`onNothingToConfirm`), and the form saves as before.
 * - If the server refuses (the review ran out, or something changed), the
 *   dialog says so and drops the token. The author asks for a new review.
 * - Any other refusal closes the dialog and goes back to the form, which
 *   still holds every edit (`onRefused`).
 */
export function CatalogChangeDialog({
  kind,
  recordId,
  payload,
  onSaved,
  onNothingToConfirm,
  onRefused,
  onCancel,
}: {
  kind: CatalogRecordKind;
  recordId: string;
  /** The edit, exactly as the form would send it, without a token. */
  payload: Record<string, unknown> | undefined;
  onSaved: () => void;
  onNothingToConfirm: () => void;
  onRefused: (failure: Failure) => void;
  onCancel: () => void;
}) {
  // It exists only while an edit waits: closing drops its state and token.
  return payload ? (
    <OpenCatalogChangeDialog
      kind={kind}
      recordId={recordId}
      payload={payload}
      onSaved={onSaved}
      onNothingToConfirm={onNothingToConfirm}
      onRefused={onRefused}
      onCancel={onCancel}
    />
  ) : null;
}

/** "credits.1.name" → "credit 1 · name", in the interface's language. */
export function atomLabel(
  words: StudioDictionary["catalogChange"],
  atom: string,
): string {
  const parts: string[] = [];
  for (const segment of atom.split(".")) {
    if (/^\d+$/.test(segment) && parts.length > 0) {
      parts[parts.length - 1] = `${parts[parts.length - 1]} ${segment}`;
    } else {
      parts.push(words.segments[segment] ?? segment);
    }
  }
  return parts.join(" · ");
}

function OpenCatalogChangeDialog({
  kind,
  recordId,
  payload,
  onSaved,
  onNothingToConfirm,
  onRefused,
  onCancel,
}: {
  kind: CatalogRecordKind;
  recordId: string;
  payload: Record<string, unknown>;
  onSaved: () => void;
  onNothingToConfirm: () => void;
  onRefused: (failure: Failure) => void;
  onCancel: () => void;
}) {
  const { words: t } = useStudio();
  const w = t.catalogChange;
  const [stage, setStage] = useState<Stage>({ name: "loading" });
  const busy = useRef(false);
  const loading = stage.name === "loading";
  const [submitting, setSubmitting] = useState(false);

  const fetchPreview = useCallback(async (): Promise<
    ActionResult<CatalogChangeReviewResult>
  > => {
    try {
      return await previewCatalogChangeAction(kind, recordId, payload);
    } catch {
      return { ok: false, code: "failed" };
    }
  }, [kind, recordId, payload]);

  const show = useCallback(
    (result: ActionResult<CatalogChangeReviewResult>) => {
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
    let result: ActionResult;
    try {
      result =
        kind === "artist"
          ? await updateArtistAction(recordId, { ...payload, confirmation })
          : kind === "album"
            ? await updateAlbumAction(recordId, { ...payload, confirmation })
            : await updateTrackAction(recordId, { ...payload, confirmation });
    } catch {
      result = { ok: false, code: "unreachable" };
    }
    busy.current = false;
    setSubmitting(false);
    if (result.ok) {
      onSaved();
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
    onRefused(result);
  }

  const review = stage.name === "ready" ? stage.preview.review : undefined;
  const oldAddressLost =
    review?.addresses.some(
      (address) => address.before !== null && address.before !== address.after,
    ) ?? false;
  const shown = (value: string | null) => value ?? w.nothing;

  return (
    <ConfirmDialog
      open
      review
      title={w.title}
      confirmLabel={w.confirmLabel}
      pending={submitting}
      focusKey={stage.name}
      regionLabel={w.region}
      hideConfirm={stage.name !== "ready"}
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
            {w.editKept}
          </Notice>
        ) : null}

        {review ? (
          <>
            <p>{w.lead}</p>
            {review.addresses.length > 0 ? (
              <div>
                <h3 className="studio-label">{w.addresses}</h3>
                <ul className="studio-review-list">
                  {review.addresses.map((address, index) => (
                    <li key={index}>
                      {address.before !== null && address.after !== null
                        ? w.addressMoves(
                            `/artists/${address.before}`,
                            `/artists/${address.after}`,
                          )
                        : address.before !== null
                          ? w.addressCloses(`/artists/${address.before}`)
                          : w.addressOpens(`/artists/${address.after}`)}
                    </li>
                  ))}
                </ul>
                {oldAddressLost ? (
                  <Notice problem>{w.oldAddressGone}</Notice>
                ) : null}
              </div>
            ) : null}
            <ul className="studio-review-list">
              {review.pages.map((page, index) => {
                const href = (path: string) =>
                  page.locale === null
                    ? path
                    : localizedHref(page.locale, path);
                return (
                  <li key={index}>
                    <h3 className="studio-label">
                      {w.pageKinds[page.surface]}
                      {page.locale ? ` · ${w.inLanguage[page.locale]}` : ""}
                      {" · "}
                      <code>{href(page.path)}</code>
                    </h3>
                    {page.pathAfter !== null ? (
                      <p className="studio-hint">
                        {w.pageMoves(href(page.path), href(page.pathAfter))}
                      </p>
                    ) : null}
                    <dl className="studio-catalog-changes">
                      {page.changes.map((change) => (
                        <div key={change.atom}>
                          <dt className="studio-hint">
                            {atomLabel(w, change.atom)}
                          </dt>
                          <dd>
                            <span className="studio-hint">{w.now}: </span>
                            <del>{shown(change.before)}</del>
                          </dd>
                          <dd>
                            <span className="studio-hint">{w.after}: </span>
                            <ins>{shown(change.after)}</ins>
                          </dd>
                        </div>
                      ))}
                    </dl>
                  </li>
                );
              })}
            </ul>
            <p className="studio-hint">{w.unchanged}</p>
          </>
        ) : null}
      </div>
    </ConfirmDialog>
  );
}
