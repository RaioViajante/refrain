"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { ConfirmDialog } from "@/app/studio/form-kit";
import { publishJournalVersionAction } from "@/app/studio/journals/actions";
import { previewPublicationAction } from "@/app/studio/journals/preview-publication-action";
import {
  LANGUAGE_NAMES,
  ReviewedText,
  ReviewSection,
  starsInWords,
} from "@/app/studio/journals/review-parts";
import { failureMessage } from "@/app/studio/messages";
import type { ActionResult } from "@/app/studio/results";
import type { PublicationPreview } from "@/modules/journals";

type Language = "en" | "pt-BR";
type Failure = Extract<ActionResult<unknown>, { ok: false }>;

type Stage =
  // Asking the server what publishing would show.
  | { name: "loading" }
  // The disclosure is on screen. Only the confirm control sends its token.
  | { name: "ready"; preview: PublicationPreview }
  // The server refused: what readers would see changed, or the review ran out.
  // Nothing was published. The author asks for a new review on purpose.
  | { name: "changed" }
  // Anything else the server said, in words.
  | { name: "failed"; failure: Failure };

/**
 * Publishing one language version (ADR 0006 §§ 3 and 4). The dialog exists
 * only while it is open: closing it drops its state, including the token.
 */
export function PublishDialog({
  entryId,
  locale,
  open,
  onClose,
  onPublished,
}: {
  entryId: string;
  locale: Language;
  open: boolean;
  onClose: () => void;
  /** Called after the server confirmed the publication. */
  onPublished: () => void;
}) {
  return open ? (
    <OpenPublishDialog
      entryId={entryId}
      locale={locale}
      onClose={onClose}
      onPublished={onPublished}
    />
  ) : null;
}

/**
 * It opens with a preview request, shows everything that would become public
 * and what stays private, and publishes only when the author presses its
 * confirm control.
 *
 * The confirmation token lives only in this component's state. It is sent by
 * `confirm`, which only that control calls, and by nothing else: no effect,
 * timer, or retry sends it. When the server refuses, the token is dropped and
 * the dialog says so; the author asks for a new review, which is a separate
 * request that shows the current state, and presses confirm again. The dialog
 * never claims success before the server has committed the publication.
 */
function OpenPublishDialog({
  entryId,
  locale,
  onClose,
  onPublished,
}: {
  entryId: string;
  locale: Language;
  onClose: () => void;
  onPublished: () => void;
}) {
  const [stage, setStage] = useState<Stage>({ name: "loading" });
  // Guards against a second click before React has re-rendered.
  const busy = useRef(false);
  const language = LANGUAGE_NAMES[locale];
  const loading = stage.name === "loading";
  // Only a running confirmation locks the dialog; reading can be abandoned.
  const [submitting, setSubmitting] = useState(false);

  const fetchPreview = useCallback(async (): Promise<Stage> => {
    let result: ActionResult<PublicationPreview>;
    try {
      result = await previewPublicationAction({ entryId, locale });
    } catch {
      result = { ok: false, code: "failed" };
    }
    return result.ok
      ? { name: "ready", preview: result.data }
      : { name: "failed", failure: result };
  }, [entryId, locale]);

  // Opening the dialog asks for the review.
  useEffect(() => {
    let current = true;
    void fetchPreview().then((next) => {
      if (current) {
        setStage(next);
      }
    });
    return () => {
      current = false;
    };
  }, [fetchPreview]);

  async function reviewAgain() {
    setStage({ name: "loading" });
    setStage(await fetchPreview());
  }

  async function confirm() {
    if (busy.current || stage.name !== "ready") {
      return;
    }
    busy.current = true;
    setSubmitting(true);
    const { preview } = stage;
    // The token leaves this component's state before the request: whatever
    // happens next, a used token is never offered again.
    setStage({ name: "loading" });
    let result: ActionResult<{ changed: boolean }>;
    try {
      result = await publishJournalVersionAction({
        entryId,
        locale,
        expectedVersion: preview.review.entryVersion,
        confirmation: preview.confirmation,
      });
    } catch {
      result = { ok: false, code: "failed" };
    }
    busy.current = false;
    setSubmitting(false);
    if (result.ok) {
      onPublished();
      return;
    }
    if (
      result.code === "confirmation_required" ||
      result.code === "confirmation_invalid" ||
      result.code === "confirmation_expired" ||
      result.code === "confirmation_stale" ||
      result.code === "conflict"
    ) {
      setStage({ name: "changed" });
    } else {
      setStage({ name: "failed", failure: result });
    }
  }

  const ready = stage.name === "ready" ? stage.preview.review : undefined;
  const status =
    ready?.status === "draft"
      ? "a draft"
      : ready?.status === "private"
        ? "private"
        : "already published";

  return (
    <ConfirmDialog
      open
      review
      title={`Publish the ${language} version?`}
      confirmLabel={`Publish the ${language} version`}
      pending={submitting}
      hideConfirm={stage.name !== "ready"}
      onConfirm={confirm}
      onCancel={onClose}
      cancelLabel={stage.name === "ready" ? "Cancel" : "Close"}
      extraActions={
        stage.name === "changed" ? (
          <button
            type="button"
            className="studio-button studio-button-primary"
            onClick={() => void reviewAgain()}
          >
            Review it again
          </button>
        ) : null
      }
    >
      <div className="studio-review" aria-busy={loading}>
        {stage.name === "loading" ? (
          <p role="status">Reading what readers would see…</p>
        ) : null}

        {stage.name === "changed" ? (
          <p role="alert" className="studio-problem">
            What readers would see has changed since you looked, or this review
            ran out. Nothing was published. Review it again to see how it stands
            now.
          </p>
        ) : null}

        {stage.name === "failed" ? (
          <p role="alert" className="studio-problem">
            {failureMessage(stage.failure)}
          </p>
        ) : null}

        {ready ? (
          <>
            <p>
              This is everything the {language} version will show once you
              publish it. Nothing is published until you press the button below,
              and nothing you wrote is changed or deleted.
            </p>
            <p className="studio-hint">
              This version is {status} now. A page address for readers is not
              built yet, so publishing marks the version as published in your
              records and nothing opens on the web.
            </p>

            <ReviewSection title="Opening sentence">
              {ready.opening ? (
                <p lang={ready.locale} className="studio-opening">
                  {ready.opening}
                </p>
              ) : (
                <p lang="en">None.</p>
              )}
            </ReviewSection>

            <ReviewSection title="Your reflection">
              <ReviewedText
                text={ready.text}
                lang={ready.locale}
                empty="None."
              />
            </ReviewSection>

            <ReviewSection title="Its address">
              <p lang="en">
                {ready.address.slug}
                {ready.address.wasPublic
                  ? " (this address has been public before)"
                  : ""}
              </p>
            </ReviewSection>

            {ready.albumRating ? (
              <ReviewSection title="Your rating for the album">
                <p lang="en">
                  {starsInWords(ready.albumRating.halfSteps)}
                  {ready.albumRating.alreadyPublic
                    ? " (already public through another language version)"
                    : ""}
                </p>
              </ReviewSection>
            ) : null}

            <ReviewSection
              title={`Track reflections that will be public in ${language} (${ready.reflections.length})`}
            >
              {ready.reflections.length === 0 ? (
                <p lang="en">
                  No track reflection will be shown. Publishing never sets a
                  track to show; you do that on each track.
                </p>
              ) : (
                <ul className="studio-review-list">
                  {ready.reflections.map((reflection) => (
                    <li key={reflection.trackId}>
                      <p lang="en" className="studio-label">
                        {reflection.trackTitle} · {language}
                      </p>
                      <ReviewedText
                        text={reflection.text}
                        lang={ready.locale}
                      />
                      <p className="studio-hint" lang="en">
                        {[
                          reflection.isFavourite ? "Marked as a favourite" : "",
                          reflection.ratingHalfSteps !== null
                            ? `Rated ${starsInWords(reflection.ratingHalfSteps)}`
                            : "",
                          reflection.isStillWriting
                            ? "Labelled “still writing”"
                            : "",
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </ReviewSection>

            <ReviewSection title="What stays private">
              <p lang="en">
                {ready.stayingPrivate.length === 0
                  ? "Every track reflection you wrote in this language is set to show, or you haven’t written any."
                  : `Track reflections you wrote in ${language} that are not set to show (${ready.stayingPrivate.length}): ${ready.stayingPrivate
                      .map((item) => item.trackTitle)
                      .join(", ")}. They stay private.`}
              </p>
              {ready.flaggedWithoutText > 0 ? (
                <p lang="en">
                  {ready.flaggedWithoutText}{" "}
                  {ready.flaggedWithoutText === 1
                    ? "track is set to show but has"
                    : "tracks are set to show but have"}{" "}
                  no text in {language}, so nothing of{" "}
                  {ready.flaggedWithoutText === 1 ? "it" : "them"} is public in
                  this language.
                </p>
              ) : null}
              <p lang="en">
                Other language versions, your drafts, and everything in Recently
                deleted stay as they are.
              </p>
            </ReviewSection>
          </>
        ) : null}
      </div>
    </ConfirmDialog>
  );
}
