"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { ConfirmDialog } from "@/app/studio/form-kit";
import { publishJournalVersionAction } from "@/app/studio/journals/actions";
import { previewPublicationAction } from "@/app/studio/journals/preview-publication-action";
import {
  Notice,
  ReviewedText,
  ReviewSection,
  starsInWords,
} from "@/app/studio/journals/review-parts";
import { failureMessage } from "@/app/studio/messages";
import type { ActionResult } from "@/app/studio/results";
import { useStudio } from "@/app/studio/studio-locale";
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
  const { locale: ui, words: t, href } = useStudio();
  const w = t.publish;
  const [stage, setStage] = useState<Stage>({ name: "loading" });
  // Guards against a second click before React has re-rendered.
  const busy = useRef(false);
  // `locale` is the language of the version being published; `ui` is the
  // interface's. Only labels follow `ui`: nothing sent depends on it.
  const language = t.languageInSentence[locale];
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
      result = { ok: false, code: "unreachable" };
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
  // Text the plain view cannot show cannot be reviewed, so it is not published
  // from here: the author could not have read what they would confirm.
  const unreadable =
    ready !== undefined &&
    (ready.text === null ||
      ready.reflections.some((reflection) => reflection.text === null));
  const status =
    ready?.status === "draft"
      ? w.statusDraft
      : ready?.status === "private"
        ? w.statusPrivate
        : w.statusPublished;

  return (
    <ConfirmDialog
      open
      review
      title={w.title(language)}
      confirmLabel={w.confirmLabel(language)}
      pending={submitting}
      focusKey={stage.name}
      regionLabel={w.region}
      hideConfirm={stage.name !== "ready" || unreadable}
      onConfirm={confirm}
      onCancel={onClose}
      cancelLabel={stage.name === "ready" ? t.common.cancel : w.close}
      extraActions={
        stage.name === "changed" ? (
          <button
            type="button"
            className="studio-button studio-button-primary"
            onClick={() => void reviewAgain()}
          >
            {w.reviewAgain}
          </button>
        ) : null
      }
    >
      <div className="studio-review">
        <div role="status">{loading ? w.reading : null}</div>

        {stage.name === "changed" ? <Notice problem>{w.changed}</Notice> : null}

        {stage.name === "failed" ? (
          <Notice problem>{failureMessage(t, stage.failure)}</Notice>
        ) : null}

        {ready ? (
          <>
            {unreadable ? (
              <p className="studio-problem">{w.unreadable}</p>
            ) : null}
            <p>{w.everything(language)}</p>
            <p className="studio-hint">
              {w.statusNow(status, t.publicPageNote)}
            </p>

            <ReviewSection title={w.opening}>
              {ready.opening ? (
                <p lang={ready.locale} className="studio-opening">
                  {ready.opening}
                </p>
              ) : (
                <p lang={ui}>{w.none}</p>
              )}
            </ReviewSection>

            <ReviewSection title={w.reflection}>
              <ReviewedText
                text={ready.text}
                lang={ready.locale}
                empty={w.none}
              />
            </ReviewSection>

            <ReviewSection title={w.address}>
              <p>
                {ready.address.slug}
                {ready.address.wasPublic ? w.wasPublic : ""}
              </p>
            </ReviewSection>

            {ready.artistPages.length > 0 ? (
              <ReviewSection title={w.artistPages(ready.artistPages.length)}>
                <ul className="studio-review-list">
                  {ready.artistPages.map((page, index) => (
                    // Two artists can share a name and, rarely, have no
                    // address: the position keeps the key unique.
                    <li key={`${index}:${page.name}`}>
                      <p className="studio-label">{page.name}</p>
                      <p lang={ui}>
                        {page.address
                          ? `/artists/${page.address}`
                          : w.noArtistAddress}
                      </p>
                      <p className="studio-hint" lang={ui}>
                        {page.photo
                          ? w.withPhoto(
                              page.photo.title,
                              page.photo.credit,
                              page.photo.license,
                            )
                          : w.withoutPhoto}
                      </p>
                    </li>
                  ))}
                </ul>
                <p className="studio-hint" lang={ui}>
                  {w.artistPagesHint}
                </p>
              </ReviewSection>
            ) : null}

            {ready.artistAddressChanges.length > 0 ? (
              <ReviewSection title={w.addressChanges}>
                <ul className="studio-review-list">
                  {ready.artistAddressChanges.map((change) => (
                    <li key={change.from}>
                      <p lang={ui}>
                        {w.addressChange(
                          change.name,
                          `/artists/${change.from}`,
                          change.to ? `/artists/${change.to}` : null,
                        )}
                      </p>
                    </li>
                  ))}
                </ul>
              </ReviewSection>
            ) : null}

            {ready.albumRating ? (
              <ReviewSection title={t.editor.albumRating}>
                <p lang={ui}>
                  {starsInWords(t, ready.albumRating.halfSteps)}
                  {ready.albumRating.alreadyPublic ? w.alreadyPublic : ""}
                </p>
              </ReviewSection>
            ) : null}

            <ReviewSection
              title={w.reflections(language, ready.reflections.length)}
            >
              {ready.reflections.length === 0 ? (
                <p lang={ui}>{w.noReflections}</p>
              ) : (
                <ul className="studio-review-list">
                  {ready.reflections.map((reflection) => (
                    <li key={reflection.trackId}>
                      <p className="studio-label">
                        {reflection.trackTitle} · {language}
                      </p>
                      <ReviewedText
                        text={reflection.text}
                        lang={ready.locale}
                      />
                      <p className="studio-hint" lang={ui}>
                        {[
                          reflection.isFavourite ? w.favourite : "",
                          reflection.ratingHalfSteps !== null
                            ? w.rated(
                                starsInWords(t, reflection.ratingHalfSteps),
                              )
                            : "",
                          reflection.isStillWriting ? w.stillWriting : "",
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
              <p className="studio-hint">{w.selectionHint}</p>
              <p>
                <Link
                  href={href(`/studio/journals/${entryId}/edit`)}
                  className="studio-button"
                >
                  {w.changeSelection}
                </Link>
              </p>
            </ReviewSection>

            <ReviewSection title={w.staysPrivate}>
              <p lang={ui}>
                {ready.stayingPrivate.length === 0
                  ? w.allIncluded
                  : w.notIncluded(
                      language,
                      ready.stayingPrivate.length,
                      ready.stayingPrivate
                        .map((item) => item.trackTitle)
                        .join(", "),
                    )}
              </p>
              {ready.flaggedWithoutText > 0 ? (
                <p lang={ui}>
                  {w.flaggedWithoutText(ready.flaggedWithoutText, language)}
                </p>
              ) : null}
              <p lang={ui}>{w.othersStay}</p>
            </ReviewSection>
          </>
        ) : null}
      </div>
    </ConfirmDialog>
  );
}
