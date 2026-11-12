"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";

import {
  ConfirmDialog,
  FormStatus,
  SelectField,
  TextAreaField,
  TextField,
  useSubmission,
  useUnsavedGuard,
} from "@/app/studio/form-kit";
import {
  createJournalAction,
  saveJournalAction,
} from "@/app/studio/journals/actions";
import { RatingField } from "@/app/studio/journals/rating-field";
import {
  draftOf,
  sameDraft,
  TrackByTrack,
  type TrackDraft,
} from "@/app/studio/journals/track-by-track";
import { ChangeDialog } from "@/app/studio/journals/change-dialog";
import { RemovalView } from "@/app/studio/journals/review-parts";
import {
  journalRemovals,
  type JournalRemoval,
} from "@/app/studio/journals/removals";
import { problemWith } from "@/app/studio/messages";
import { StatusMark } from "@/app/studio/status-mark";
import { useStudio } from "@/app/studio/studio-locale";
import type { TrackByTrackItem, VisibilityStatus } from "@/modules/journals";

type Language = "en" | "pt-BR";

const LANGUAGES: Language[] = ["en", "pt-BR"];

interface Snapshot {
  opening: string;
  body: string;
  albumRating: number | null;
  drafts: Record<string, TrackDraft>;
}

function wordCount(text: string): number {
  return text.trim() === "" ? 0 : text.trim().split(/\s+/).length;
}

/** A save waiting for the author, and what it would take away from readers. */
interface Waiting {
  payload: Record<string, unknown>;
  sent: Snapshot;
  removals: JournalRemoval[];
}

interface JournalEditorProps {
  /** Writing a new journal about this album. */
  create?: { albumId: string };
  /** Editing an existing journal. */
  edit?: {
    entryId: string;
    version: number;
    locale: Language;
    /** The journal's visibility, shown beside the save state. */
    status: VisibilityStatus;
    /**
     * The language versions that are published. When there is any, a save
     * first asks the server what would change for readers, and asks the
     * author before it takes anything away from them (issue #54). The save
     * carries this list, so a stale tab is refused instead of writing.
     */
    published: Language[];
  };
  initial: { opening: string; body: string };
  /**
   * The album's tracks with the author's reflections, and the album rating, for
   * editing a journal. A new journal has none: it starts as a private draft.
   */
  tracks?: TrackByTrackItem[];
  albumRating?: number | null;
  /** Where "back" goes, and what it is called. */
  back: { href: string; label: string };
  /** The page's heading, shown under the action bar. */
  heading?: ReactNode;
  /** Catalog facts for the settings margin, rendered by the page. */
  catalog?: ReactNode;
}

/**
 * A plain, comfortable place to write. The text stays in the box whatever
 * happens to a save: a conflict, an expired session, or a network error
 * leaves it where it is, and leaving the page asks first. Saving is explicit.
 */
export function JournalEditor({
  create,
  edit,
  initial,
  tracks = [],
  albumRating: initialAlbumRating = null,
  back,
  heading,
  catalog,
}: JournalEditorProps) {
  const router = useRouter();
  // `locale` below is the language of the writing, which is content; the
  // interface's own language is `ui`, from the page's route.
  const { locale: ui, words: t, href } = useStudio();
  const w = t.editor;
  const languageNote = useId();
  const [opening, setOpening] = useState(initial.opening);
  const [body, setBody] = useState(initial.body);
  // A new journal starts in the page's language; the author can choose the
  // other one before the first save. It is recorded as the original.
  const [locale, setLocale] = useState<Language>(edit?.locale ?? ui);
  const [version, setVersion] = useState(edit?.version ?? 1);
  const [albumRating, setAlbumRating] = useState<number | null>(
    initialAlbumRating,
  );
  const [drafts, setDrafts] = useState<Record<string, TrackDraft>>(() =>
    Object.fromEntries(
      tracks.map((item) => [item.trackId, draftOf(item, edit?.locale ?? "en")]),
    ),
  );
  // What was last saved, or loaded. Dirty means "differs from this", so an edit
  // made while a save is running is still unsaved when that save returns.
  const [base, setBase] = useState({
    opening: initial.opening,
    body: initial.body,
    albumRating: initialAlbumRating,
    drafts,
  });
  const [created, setCreated] = useState(false);
  const [saved, setSaved] = useState(false);
  const [flagDirty, setFlagDirty] = useState(false);
  const { pending, failure, run, clearFailure, report } = useSubmission();
  // A save waiting for the author's confirmation of what readers would see.
  // The change dialog owns the confirmation token; this holds only the save.
  const [review, setReview] = useState<Waiting | undefined>();
  // A save that only takes something away from a published page needs no
  // token, but the interface asks first (ADR 0006 § 5; issue #54).
  const [removal, setRemoval] = useState<Waiting | undefined>();
  // Stops a second save from starting before React has re-rendered.
  const saving = useRef(false);

  // A track added in the catalog while this page is open has no draft yet:
  // it starts from what is stored.
  const draftLocale = edit?.locale ?? "en";
  const currentDrafts = Object.fromEntries(
    tracks.map((item) => [
      item.trackId,
      drafts[item.trackId] ?? draftOf(item, draftLocale),
    ]),
  );
  const baseDrafts = Object.fromEntries(
    tracks.map((item) => [
      item.trackId,
      base.drafts[item.trackId] ?? draftOf(item, draftLocale),
    ]),
  );
  const tracksDirty = tracks.some(
    (item) =>
      !sameDraft(currentDrafts[item.trackId]!, baseDrafts[item.trackId]!),
  );
  const dirty = edit
    ? opening !== base.opening ||
      body !== base.body ||
      albumRating !== base.albumRating ||
      tracksDirty
    : flagDirty;
  useUnsavedGuard(dirty);

  function adopt(next: number, sent: Snapshot) {
    setVersion(next);
    setBase(sent);
    setSaved(true);
    router.refresh();
  }

  // Sends the save with no confirmation. When the journal turns out to be
  // public (it was published in another tab), the server refuses and the
  // change dialog takes over; `reviewed` stops that from looping.
  async function commit(
    payload: Record<string, unknown>,
    sent: Snapshot,
    reviewed = false,
  ) {
    const result = await run(() => saveJournalAction(payload));
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
      setReview({ payload, sent, removals: [] });
    }
    if (result.code === "status_changed") {
      // Another tab published or unpublished a version: show how it stands
      // now. The text stays in the editor, and the next save asks.
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
    if (edit) {
      // Only what changed is sent, so a save never rewrites writing the author
      // did not touch, and one language never overwrites another.
      const payload: Record<string, unknown> = {
        entryId: edit.entryId,
        expectedVersion: version,
      };
      // Which versions this editor showed as published: if another tab
      // changed that, the save is refused and the page refreshed, so nothing
      // is taken away from readers without asking.
      const shownPublished = edit.published;
      if (opening !== base.opening) {
        payload.opening = opening;
      }
      if (body !== base.body) {
        payload.body = body;
      }
      if (albumRating !== base.albumRating) {
        payload.albumRating = albumRating;
      }
      const reflections = tracks.flatMap((item) => {
        const now = currentDrafts[item.trackId]!;
        const before = baseDrafts[item.trackId]!;
        if (sameDraft(now, before)) {
          return [];
        }
        const change: Record<string, unknown> = { trackId: item.trackId };
        if (now.text !== before.text) {
          change.texts = { [edit.locale]: now.text };
        }
        if (now.isFavourite !== before.isFavourite) {
          change.isFavourite = now.isFavourite;
        }
        if (now.isStillWriting !== before.isStillWriting) {
          change.isStillWriting = now.isStillWriting;
        }
        if (now.isPublished !== before.isPublished) {
          change.isPublished = now.isPublished;
        }
        if (now.rating !== before.rating) {
          change.ratingHalfSteps = now.rating;
        }
        return [change];
      });
      if (reflections.length > 0) {
        payload.reflections = reflections;
      }
      if (Object.keys(payload).length === 2) {
        setSaved(true);
        return;
      }
      payload.expectedPublished = shownPublished;
      const sent = {
        opening,
        body,
        albumRating,
        drafts: currentDrafts,
      };
      if (shownPublished.length > 0) {
        // Something is public: ask what would change for readers before
        // anything is written, and name what the save takes away from them.
        // The dialogs save only if the author confirms.
        const removals = journalRemovals({
          published: shownPublished,
          editing: edit.locale,
          tracks,
          base: { albumRating: base.albumRating, drafts: baseDrafts },
          sent,
        });
        clearFailure();
        setReview({ payload, sent, removals });
        return;
      }
      await commit(payload, sent);
      return;
    }
    const result = await run(() =>
      createJournalAction({
        albumId: create?.albumId,
        locale,
        opening,
        body,
      }),
    );
    if (result.ok) {
      setCreated(true);
      setFlagDirty(false);
      setSaved(true);
      router.push(href(`/studio/journals/${result.data.entryId}`));
    }
  }

  // Cmd or Ctrl + S saves, without leaving the keyboard. The latest `save` is
  // kept in a ref so the listener is attached once.
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

  // Hydration rewrites a textarea's value, which collapses a selection made
  // while it runs. This mark says it is over; browser tests wait for it before
  // they type, so `fill` cannot insert beside the stored text (issue #69).
  const formElement = useRef<HTMLFormElement>(null);
  useEffect(() => {
    formElement.current?.setAttribute("data-editor-ready", "");
  }, []);

  function edited(update: () => void) {
    update();
    setFlagDirty(true);
    setSaved(false);
  }

  function editTrack(trackId: string, patch: Partial<TrackDraft>) {
    setDrafts((current) => {
      const item = tracks.find((candidate) => candidate.trackId === trackId);
      const from =
        current[trackId] ?? (item ? draftOf(item, draftLocale) : undefined);
      return from ? { ...current, [trackId]: { ...from, ...patch } } : current;
    });
    setSaved(false);
  }

  const reflectionProblem = Object.keys(failure?.fields ?? {}).some((field) =>
    field.startsWith("reflections"),
  )
    ? w.reflectionProblem
    : undefined;

  return (
    <form
      ref={formElement}
      onSubmit={save}
      className="studio-editor"
      noValidate
    >
      <div className="studio-editorbar" data-mode={create ? "create" : "edit"}>
        <div className="studio-editorbar-start">
          <Link href={back.href} className="studio-crumb">
            ← {back.label}
          </Link>
          {create ? (
            <SelectField
              label={w.writtenIn}
              variant="inline"
              value={locale}
              onChange={(value) => edited(() => setLocale(value as Language))}
              options={LANGUAGES.map((value) => ({
                value,
                label: t.languageNames[value],
              }))}
              describedById={languageNote}
              problem={problemWith(t, failure, "locale")}
            />
          ) : null}
        </div>
        <div className="studio-editorbar-end">
          <FormStatus
            pending={pending}
            failure={failure}
            saved={saved}
            dirty={dirty}
          />
          <button
            type="submit"
            className={`studio-button ${dirty ? "studio-button-primary" : ""}`}
            disabled={pending || review !== undefined || removal !== undefined}
          >
            {create ? w.saveDraft : w.save}
          </button>
        </div>
      </div>

      {heading}

      {edit?.status === "published" ? (
        <p className="studio-panel" role="note">
          {w.published}
        </p>
      ) : edit && edit.published.length > 0 ? (
        <p className="studio-panel" role="note">
          {w.otherPublished}
        </p>
      ) : null}

      <div className="studio-columns">
        <div className="studio-writing-column">
          <TextField
            label={w.opening}
            value={opening}
            onChange={(value) => edited(() => setOpening(value))}
            maxLength={300}
            lang={locale}
            variant="opening"
            hint={w.openingHint}
            problem={problemWith(t, failure, "opening")}
          />
          <div className="grid gap-2">
            <TextAreaField
              label={w.reflection}
              value={body}
              onChange={(value) => edited(() => setBody(value))}
              rows={18}
              lang={locale}
              hint={w.reflectionHint}
              problem={problemWith(t, failure, "body")}
            />
            <p className="studio-count" aria-live="off">
              {t.counts.words(wordCount(body))}
            </p>
          </div>
          {edit ? (
            <>
              <RatingField
                label={w.albumRating}
                value={albumRating}
                onChange={(value) => {
                  setAlbumRating(value);
                  setSaved(false);
                }}
                hint={w.albumRatingHint}
              />
              <TrackByTrack
                tracks={tracks}
                drafts={currentDrafts}
                baseline={baseDrafts}
                onEdit={editTrack}
                locale={edit.locale}
                status={edit.status}
                problem={reflectionProblem}
              />
            </>
          ) : null}
        </div>

        <div className="studio-margin">
          {edit ? (
            <>
              <p className="studio-meta studio-editor-state">
                <StatusMark locale={ui} status={edit.status} />
              </p>
              <p className="studio-meta">{w.writtenInLanguage(locale)}</p>
            </>
          ) : (
            <p className="studio-hint" id={languageNote}>
              {w.languageNote}
            </p>
          )}
          <p className="studio-hint">{create ? w.createNote : w.editNote}</p>
          {catalog}
        </div>
      </div>

      <ChangeDialog
        payload={review?.payload}
        removals={review?.removals ?? []}
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
          // Nothing a reader sees is added or changed. If the save takes
          // something away, the author is asked first; otherwise it saves.
          if (waiting.removals.length > 0) {
            setRemoval(waiting);
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
            {removal?.removals.map((item, index) => (
              <li key={index}>
                <RemovalView removal={item} />
              </li>
            ))}
          </ul>
        </div>
      </ConfirmDialog>
    </form>
  );
}
