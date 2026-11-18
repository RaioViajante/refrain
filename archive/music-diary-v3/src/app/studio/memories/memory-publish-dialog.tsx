"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { ConfirmDialog } from "@/app/studio/form-kit";
import {
  Notice,
  ReviewedText,
  ReviewSection,
} from "@/app/studio/journals/review-parts";
import { publishMemoryVersionAction } from "@/app/studio/memories/actions";
import { previewMemoryPublicationAction } from "@/app/studio/memories/preview-publication-action";
import { failureMessage } from "@/app/studio/messages";
import type { ActionResult } from "@/app/studio/results";
import { useStudio } from "@/app/studio/studio-locale";
import type { StudioDictionary } from "@/i18n/studio";
import type {
  MemoryPublicationPreview,
  ReviewedMemoryMusic,
} from "@/modules/journals";

type Language = "en" | "pt-BR";
type Failure = Extract<ActionResult<unknown>, { ok: false }>;

type Stage =
  // Asking the server what publishing would show.
  | { name: "loading" }
  // The disclosure is on screen. Only the confirm control sends its token.
  | { name: "ready"; preview: MemoryPublicationPreview }
  // The server refused: what readers would see changed, or the review ran out.
  // Nothing was published. The author asks for a new review on purpose.
  | { name: "changed" }
  // Anything else the server said, in words.
  | { name: "failed"; failure: Failure };

/**
 * Publishing a memory (M3.7; ADR 0006 §§ 3 and 4): the same dialog as an
 * album journal's, with what a memory shows. It exists only while it is open:
 * closing it drops its state, including the token.
 */
export function MemoryPublishDialog({
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
    <OpenMemoryPublishDialog
      entryId={entryId}
      locale={locale}
      onClose={onClose}
      onPublished={onPublished}
    />
  ) : null;
}

/** A song's line in the review: its artists and album, and where they link. */
function songFacts(t: StudioDictionary, song: ReviewedMemoryMusic): string {
  const w = t.memoryPublish;
  const artists = song.artists.map((artist) =>
    artist.address ? w.linksToArtist(artist.name) : artist.name,
  );
  const album =
    song.kind === "recording" && song.album
      ? w.onAlbum(song.album.title, Boolean(song.album.journalSlug))
      : song.kind === "album" && song.album?.journalSlug
        ? w.linksToJournal
        : null;
  return [artists.join(", "), album].filter(Boolean).join(" · ");
}

/**
 * It opens with a preview request, shows everything that would become public,
 * and publishes only when the author presses its confirm control.
 *
 * The confirmation token lives only in this component's state. It is sent by
 * `confirm`, which only that control calls, and by nothing else: no effect,
 * timer, or retry sends it. When the server refuses, the token is dropped and
 * the dialog says so; the author asks for a new review, which is a separate
 * request that shows the current state, and presses confirm again. The dialog
 * never claims success before the server has committed the publication.
 */
function OpenMemoryPublishDialog({
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
  const { locale: ui, words: t } = useStudio();
  const w = t.memoryPublish;
  const [stage, setStage] = useState<Stage>({ name: "loading" });
  // Guards against a second click before React has re-rendered.
  const busy = useRef(false);
  // `locale` is the memory's language; `ui` is the interface's. Only labels
  // follow `ui`: nothing sent depends on it.
  const language = t.languageInSentence[locale];
  const loading = stage.name === "loading";
  // Only a running confirmation locks the dialog; reading can be abandoned.
  const [submitting, setSubmitting] = useState(false);

  const fetchPreview = useCallback(async (): Promise<Stage> => {
    let result: ActionResult<MemoryPublicationPreview>;
    try {
      result = await previewMemoryPublicationAction({ entryId, locale });
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
      result = await publishMemoryVersionAction({
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
  const unreadable = ready !== undefined && ready.text === null;
  const status =
    ready?.status === "draft"
      ? t.publish.statusDraft
      : ready?.status === "private"
        ? t.publish.statusPrivate
        : t.publish.statusPublished;

  return (
    <ConfirmDialog
      open
      review
      title={w.title}
      confirmLabel={w.confirmLabel}
      pending={submitting}
      focusKey={stage.name}
      regionLabel={t.publish.region}
      hideConfirm={stage.name !== "ready" || unreadable}
      onConfirm={confirm}
      onCancel={onClose}
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
        <div role="status">{loading ? t.publish.reading : null}</div>

        {stage.name === "changed" ? (
          <Notice problem>{t.publish.changed}</Notice>
        ) : null}

        {stage.name === "failed" ? (
          <Notice problem>{failureMessage(t, stage.failure, "memory")}</Notice>
        ) : null}

        {ready ? (
          <>
            {unreadable ? (
              <p className="studio-problem">{t.publish.unreadable}</p>
            ) : null}
            <p>{w.everything(language)}</p>
            <p className="studio-hint">
              {w.statusNow(status, t.publicPageNote)}
            </p>

            <ReviewSection title={t.memoryEditor.title}>
              <p lang={ready.locale} className="studio-row-title">
                {ready.title}
              </p>
            </ReviewSection>

            <ReviewSection title={t.memoryEditor.when}>
              {ready.rememberedWhen ? (
                <p lang={ready.locale}>{ready.rememberedWhen}</p>
              ) : (
                <p lang={ui}>{w.noWhen}</p>
              )}
            </ReviewSection>

            <ReviewSection title={t.memoryEditor.body}>
              <ReviewedText text={ready.text} lang={ready.locale} />
            </ReviewSection>

            <ReviewSection title={w.music(ready.music.length)}>
              {ready.music.length === 0 ? (
                <p lang={ui}>{w.noSongs}</p>
              ) : (
                <ol className="studio-review-list">
                  {ready.music.map((song) => (
                    <li key={song.number}>
                      <p className="studio-label">
                        {song.kind === "album" ? w.albumPrefix : ""}
                        {song.title}
                      </p>
                      {songFacts(t, song) ? (
                        <p className="studio-hint" lang={ui}>
                          {songFacts(t, song)}
                        </p>
                      ) : null}
                    </li>
                  ))}
                </ol>
              )}
              <p className="studio-hint" lang={ui}>
                {w.musicHint}
              </p>
            </ReviewSection>

            <ReviewSection title={t.publish.address}>
              <p>
                /memories/{ready.address.slug}
                {ready.address.wasPublic ? t.publish.wasPublic : ""}
              </p>
            </ReviewSection>

            <ReviewSection title={t.publish.staysPrivate}>
              <p lang={ui}>{w.othersStay}</p>
            </ReviewSection>
          </>
        ) : null}
      </div>
    </ConfirmDialog>
  );
}
