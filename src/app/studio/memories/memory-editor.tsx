"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";

import {
  ConfirmDialog,
  FormStatus,
  SelectField,
  TextAreaField,
  TextField,
  TitleField,
  useSubmission,
  useUnsavedGuard,
} from "@/app/studio/form-kit";
import {
  createMemoryAction,
  saveMemoryAction,
} from "@/app/studio/memories/actions";
import { MemoryChangeDialog } from "@/app/studio/memories/memory-change-dialog";
import { MemoryControls } from "@/app/studio/memories/memory-controls";
import { MemoryMusic } from "@/app/studio/memories/memory-music";
import {
  derivedArtists,
  type Recording,
} from "@/app/studio/memories/recordings";
import { problemWith } from "@/app/studio/messages";
import { StatusMark } from "@/app/studio/status-mark";
import { useStudio } from "@/app/studio/studio-locale";
import type { StudioDictionary } from "@/i18n/studio";
import type { VisibilityStatus } from "@/modules/journals";

type Language = "en" | "pt-BR";

const LANGUAGES: Language[] = ["en", "pt-BR"];

// The limits the server enforces (src/modules/journals/input.ts), so the
// fields stop where the command would refuse.
const MAX_TITLE = 200;
const MAX_WHEN = 200;

function wordCount(text: string): number {
  return text.trim() === "" ? 0 : text.trim().split(/\s+/).length;
}

interface Draft {
  title: string;
  rememberedWhen: string;
  body: string;
  recordings: Recording[];
}

/**
 * What a save takes away from what readers see of a published memory: the
 * songs the saved list no longer has, and a "when" that is cleared. Derived
 * from the editor's saved state, never from the server's change, which lists
 * additions and edits only (ADR 0006 § 5).
 */
function removalsOf(t: StudioDictionary, base: Draft, sent: Draft): string[] {
  const kept = new Set(sent.recordings.map((recording) => recording.trackId));
  const songs = base.recordings
    .filter((recording) => !kept.has(recording.trackId))
    .map((recording) => recording.title);
  const when =
    base.rememberedWhen.trim() !== "" && sent.rememberedWhen.trim() === "";
  return [...(when ? [t.memoryEditor.whenRemoved] : []), ...songs];
}

function sameOrder(a: readonly Recording[], b: readonly Recording[]) {
  return (
    a.length === b.length &&
    a.every((recording, index) => recording.trackId === b[index]!.trackId)
  );
}

/**
 * The V4.4 memory editor: a title, "when", the memory itself with its word
 * count, and in the margin its music, the artists derived from it, who can see
 * it, and Delete. Saving is explicit (the Save button or Cmd/Ctrl+S), the text
 * stays in the fields whatever happens to a save, and leaving with unsaved
 * changes asks first. A save never publishes; saving a published memory first
 * shows what would change for readers, and saves only on the author's
 * confirmation (M3.7; ADR 0006 § 5).
 */
export function MemoryEditor({
  create,
  edit,
  initial,
  choices,
}: {
  /** Writing a new memory. */
  create?: true;
  /** Editing an existing memory. */
  edit?: {
    entryId: string;
    version: number;
    /** The language the memory was written in: its original, never changed. */
    locale: Language;
    status: VisibilityStatus;
    /** Album links the editor cannot change (written outside the studio). */
    albumLinks: string[];
  };
  initial: Draft;
  /** Recordings in the catalog that are not archived. */
  choices: Recording[];
}) {
  const router = useRouter();
  // `locale` is the language of the writing, which is content (ADR 0008 §§ 1
  // and 9): chosen once, when the memory is created, and recorded as its
  // original. The interface's own language is `ui`, from the page's route.
  const { locale: ui, words: t, href } = useStudio();
  const w = t.memoryEditor;
  const [locale, setLocale] = useState<Language>(edit?.locale ?? ui);
  const [draft, setDraft] = useState<Draft>(initial);
  const [base, setBase] = useState<Draft>(initial);
  const [version, setVersion] = useState(edit?.version ?? 1);
  const [saved, setSaved] = useState(false);
  const [created, setCreated] = useState(false);
  const { pending, failure, run, clearFailure, report } = useSubmission();
  const saving = useRef(false);
  // A save waiting for the author's confirmation of what readers would see.
  // The change dialog owns the confirmation token; this holds only the save.
  const [review, setReview] = useState<
    { payload: Record<string, unknown>; sent: Draft } | undefined
  >();
  // A removal from a published memory (a song, the "when") needs no token,
  // but the interface asks first (ADR 0006 § 5): what would be taken away.
  const [removal, setRemoval] = useState<
    | {
        payload: Record<string, unknown>;
        sent: Draft;
        items: string[];
      }
    | undefined
  >();

  const dirty = created
    ? false
    : draft.title !== base.title ||
      draft.rememberedWhen !== base.rememberedWhen ||
      draft.body !== base.body ||
      !sameOrder(draft.recordings, base.recordings);
  useUnsavedGuard(dirty);

  function edited(patch: Partial<Draft>) {
    setDraft((current) => ({ ...current, ...patch }));
    setSaved(false);
  }

  function adopt(next: number, sent: Draft) {
    setVersion(next);
    setBase(sent);
    setSaved(true);
    router.refresh();
  }

  // Sends the save with no confirmation. When the memory turns out to be
  // public (it was published in another tab), the server refuses and the
  // change dialog takes over; `reviewed` stops that from looping.
  async function commit(
    payload: Record<string, unknown>,
    sent: Draft,
    reviewed = false,
  ) {
    const result = await run(() => saveMemoryAction(payload));
    if (result.ok) {
      adopt(result.data.version, sent);
      return;
    }
    if (
      !reviewed &&
      (result.code === "confirmation_required" ||
        result.code === "confirmation_stale" ||
        result.code === "confirmation_expired" ||
        result.code === "confirmation_invalid")
    ) {
      clearFailure();
      setReview({ payload, sent });
    }
    if (result.code === "status_changed") {
      // Another tab published or unpublished it: show how it stands now. The
      // text stays in the editor.
      router.refresh();
    }
  }

  async function save(event?: FormEvent) {
    event?.preventDefault();
    if (pending || created || review || removal || saving.current) {
      return;
    }
    saving.current = true;
    try {
      await saveNow();
    } finally {
      saving.current = false;
    }
  }

  async function saveNow() {
    const sent = draft;
    if (!edit) {
      const result = await run(() =>
        createMemoryAction({
          locale,
          title: sent.title,
          rememberedWhen: sent.rememberedWhen,
          body: sent.body,
          trackIds: sent.recordings.map((recording) => recording.trackId),
        }),
      );
      if (result.ok) {
        setCreated(true);
        setSaved(true);
        router.push(href(`/studio/memories/${result.data.entryId}`));
      }
      return;
    }
    // Only what changed is sent, so a save never rewrites what the author did
    // not touch.
    const payload: Record<string, unknown> = {
      entryId: edit.entryId,
      expectedVersion: version,
      // The status this editor showed: if another tab published or
      // unpublished the memory, the save is refused and the page refreshed,
      // so a removal is never saved to a public page without asking.
      expectedStatus: edit.status,
    };
    if (sent.title !== base.title) {
      payload.title = sent.title;
    }
    if (sent.rememberedWhen !== base.rememberedWhen) {
      payload.rememberedWhen = sent.rememberedWhen;
    }
    if (sent.body !== base.body) {
      payload.body = sent.body;
    }
    if (!sameOrder(sent.recordings, base.recordings)) {
      payload.trackIds = sent.recordings.map((recording) => recording.trackId);
    }
    if (Object.keys(payload).length === 3) {
      setSaved(true);
      return;
    }
    if (edit.status === "published") {
      // Readers can see it: ask what would change for them before anything
      // is written. The dialog saves only if the author confirms.
      clearFailure();
      setReview({ payload, sent });
      return;
    }
    await commit(payload, sent);
  }

  // Cmd or Ctrl + S saves. The latest `save` is kept in a ref so the listener
  // is attached once.
  const latestSave = useRef(save);
  useEffect(() => {
    latestSave.current = save;
  });
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void latestSave.current();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const artists = derivedArtists(draft.recordings);
  const status = edit?.status ?? "draft";
  const musicProblem = failure?.fields?.trackIds ? w.musicProblem : undefined;

  return (
    <form onSubmit={save} className="studio-editor" noValidate>
      <div
        className="studio-editorbar"
        data-mode={create ? "create" : "edit"}
        data-subject="memory"
      >
        <div className="studio-editorbar-start">
          <Link href={href("/studio/memories")} className="studio-crumb">
            {t.memory.back}
          </Link>
          <span className="studio-crumb-sep" aria-hidden="true">
            /
          </span>
          <span className="studio-crumb-current">
            {create ? w.newMemory : t.memories.kind}
          </span>
          <StatusMark locale={ui} status={status} subject="memory" />
        </div>
        <div className="studio-editorbar-end">
          <FormStatus
            pending={pending}
            failure={failure}
            saved={saved}
            dirty={dirty}
            subject="memory"
          />
          <button
            type="submit"
            className={`studio-button ${dirty ? "studio-button-primary" : ""}`}
            disabled={pending || created}
          >
            {create ? t.editor.saveDraft : t.editor.save}
          </button>
        </div>
      </div>

      <h1 className="studio-sr-only">{create ? w.writeTitle : w.editTitle}</h1>

      {status === "published" ? (
        <p className="studio-panel" role="note">
          {w.published}
        </p>
      ) : null}

      <div className="studio-columns">
        <div className="studio-writing-column">
          <TitleField
            label={w.title}
            placeholder={w.titlePlaceholder}
            value={draft.title}
            onChange={(value) => edited({ title: value })}
            maxLength={MAX_TITLE}
            lang={locale}
            problem={problemWith(t, failure, "title")}
          />
          <TextField
            label={w.when}
            placeholder={w.whenPlaceholder}
            value={draft.rememberedWhen}
            onChange={(value) => edited({ rememberedWhen: value })}
            maxLength={MAX_WHEN}
            lang={locale}
            width="480px"
            hint={w.whenHint}
            problem={problemWith(t, failure, "rememberedWhen")}
          />
          <div className="grid gap-2">
            <TextAreaField
              label={w.body}
              placeholder={w.bodyPlaceholder}
              value={draft.body}
              onChange={(value) => edited({ body: value })}
              rows={18}
              lang={locale}
              problem={problemWith(t, failure, "body")}
            />
            <p className="studio-count" aria-live="off">
              {t.counts.words(wordCount(draft.body))}
            </p>
          </div>
        </div>

        <div className="studio-margin">
          <MemoryMusic
            recordings={draft.recordings}
            choices={choices}
            onChange={(recordings) => edited({ recordings })}
            albumLinks={edit?.albumLinks}
            problem={musicProblem}
          />

          <section aria-labelledby="memory-artists" className="space-y-1">
            <h2 id="memory-artists" className="studio-label">
              {w.artists}
            </h2>
            <p className="studio-meta">
              {artists.length > 0 ? artists.join(", ") : w.noArtists}
            </p>
          </section>

          <section
            aria-labelledby={create ? undefined : "memory-language"}
            className="space-y-1"
          >
            {create ? (
              <>
                {/* The select's own label names the choice. */}
                <SelectField
                  label={t.editor.writtenIn}
                  value={locale}
                  onChange={(value) => {
                    setLocale(value as Language);
                    setSaved(false);
                  }}
                  options={LANGUAGES.map((value) => ({
                    value,
                    label: t.languageNames[value],
                  }))}
                  hint={w.languageHint}
                  problem={problemWith(t, failure, "locale")}
                />
              </>
            ) : (
              <>
                <h2 id="memory-language" className="studio-label">
                  {t.editor.writtenIn}
                </h2>
                <p className="studio-meta">{t.languageNames[locale]}</p>
                <p className="studio-hint">{w.languageFixed}</p>
              </>
            )}
          </section>

          {edit ? (
            <MemoryControls
              entryId={edit.entryId}
              locale={edit.locale}
              title={base.title}
              status={edit.status}
              dirty={dirty}
            />
          ) : (
            <p className="studio-hint">{w.createNote}</p>
          )}
        </div>
      </div>

      <MemoryChangeDialog
        payload={review?.payload}
        removals={review ? removalsOf(t, base, review.sent) : []}
        onSaved={(next) => {
          if (review) {
            adopt(next, review.sent);
          }
          setReview(undefined);
        }}
        onNothingToConfirm={() => {
          const waiting = review;
          setReview(undefined);
          if (!waiting) {
            return;
          }
          const items = removalsOf(t, base, waiting.sent);
          if (items.length > 0) {
            setRemoval({ ...waiting, items });
          } else {
            void commit(waiting.payload, waiting.sent, true);
          }
        }}
        onRefused={(refused) => {
          setReview(undefined);
          report(refused);
          if (refused.code === "status_changed") {
            router.refresh();
          }
        }}
        onCancel={() => setReview(undefined)}
      />

      <ConfirmDialog
        open={removal !== undefined}
        title={w.removalQuestion}
        confirmLabel={w.removalConfirm}
        pending={pending}
        onConfirm={() => {
          const waiting = removal;
          setRemoval(undefined);
          if (waiting) {
            void commit(waiting.payload, waiting.sent, true);
          }
        }}
        onCancel={() => setRemoval(undefined)}
      >
        <div className="space-y-3">
          <p>{w.removalBody}</p>
          <ul className="studio-review-list">
            {removal?.items.map((item, index) => (
              <li key={index}>{item}</li>
            ))}
          </ul>
        </div>
      </ConfirmDialog>
    </form>
  );
}
