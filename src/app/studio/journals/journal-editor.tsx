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
import { problemWith } from "@/app/studio/messages";
import { StatusMark } from "@/app/studio/status-mark";
import type { TrackByTrackItem, VisibilityStatus } from "@/modules/journals";

const LANGUAGES = [
  { value: "en", label: "English" },
  { value: "pt-BR", label: "Português (Brasil)" },
];

type Language = "en" | "pt-BR";

interface Snapshot {
  opening: string;
  body: string;
  albumRating: number | null;
  drafts: Record<string, TrackDraft>;
}

function words(text: string): number {
  return text.trim() === "" ? 0 : text.trim().split(/\s+/).length;
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
     * Whether any language version is published. A save then asks the server
     * what would change for readers before it writes anything.
     */
    anyPublished: boolean;
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
}: JournalEditorProps) {
  const router = useRouter();
  const languageNote = useId();
  const [opening, setOpening] = useState(initial.opening);
  const [body, setBody] = useState(initial.body);
  const [locale, setLocale] = useState<Language>(edit?.locale ?? "en");
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
  const [review, setReview] = useState<
    { payload: Record<string, unknown>; sent: Snapshot } | undefined
  >();
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
      setReview({ payload, sent });
    }
  }

  async function save(event?: FormEvent) {
    event?.preventDefault();
    if (pending || created || review || saving.current) {
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
      const sent = {
        opening,
        body,
        albumRating,
        drafts: currentDrafts,
      };
      if (edit.anyPublished) {
        // Something is public: ask what would change for readers before
        // anything is written. The dialog saves only if the author confirms.
        clearFailure();
        setReview({ payload, sent });
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
      router.push(`/studio/journals/${result.data.entryId}`);
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
    ? "A reflection is too long or isn’t valid, so nothing was saved. Your text is still here."
    : undefined;

  return (
    <form onSubmit={save} className="studio-editor" noValidate>
      <div className="studio-editorbar" data-mode={create ? "create" : "edit"}>
        <div className="studio-editorbar-start">
          <Link href={back.href} className="studio-crumb">
            ← {back.label}
          </Link>
          {create ? (
            <SelectField
              label="Written in"
              variant="inline"
              value={locale}
              onChange={(value) => edited(() => setLocale(value as Language))}
              options={LANGUAGES}
              describedById={languageNote}
              problem={problemWith(failure, "locale")}
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
            disabled={pending || review !== undefined}
          >
            {create ? "Save as draft" : "Save"}
          </button>
        </div>
      </div>

      {heading}

      {edit?.status === "published" ? (
        <p className="studio-panel" role="note">
          This version is published. Saving changes the public page. Before a
          change that alters what readers see is saved, you will see exactly
          what changes and confirm it. Nothing is saved without that.
        </p>
      ) : edit?.anyPublished ? (
        <p className="studio-panel" role="note">
          Another language version of this journal is published. A change that
          alters what readers see will show you what changes and ask you first.
        </p>
      ) : null}

      <div className="studio-columns">
        <div className="studio-writing-column">
          <TextField
            label="Opening sentence (optional)"
            value={opening}
            onChange={(value) => edited(() => setOpening(value))}
            maxLength={300}
            lang={locale}
            variant="opening"
            hint="One line that opens the journal, in your words."
            problem={problemWith(failure, "opening")}
          />
          <div className="grid gap-2">
            <TextAreaField
              label="Your reflection"
              value={body}
              onChange={(value) => edited(() => setBody(value))}
              rows={18}
              lang={locale}
              hint="A blank line starts a new paragraph. Your writing is kept as plain text."
              problem={problemWith(failure, "body")}
            />
            <p className="studio-count" aria-live="off">
              {words(body)} {words(body) === 1 ? "word" : "words"}
            </p>
          </div>
          {edit ? (
            <>
              <RatingField
                label="Your rating for the album"
                value={albumRating}
                onChange={(value) => {
                  setAlbumRating(value);
                  setSaved(false);
                }}
                hint="Set on its own. It is never calculated from the track ratings."
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
                <StatusMark status={edit.status} />
              </p>
              <p className="studio-meta">
                Written in {LANGUAGES.find((l) => l.value === locale)?.label}
              </p>
            </>
          ) : (
            <p className="studio-hint" id={languageNote}>
              The language you write this journal in. It is recorded with the
              journal, and nothing is translated for you.
            </p>
          )}
          <p className="studio-hint">
            {create
              ? "A new journal starts as a private draft. Nothing here is published."
              : "Saving never changes who can see this journal."}
          </p>
        </div>
      </div>

      <ChangeDialog
        payload={review?.payload}
        onSaved={(next) => {
          if (review) {
            adopt(next, review.sent);
          }
          setReview(undefined);
        }}
        onNothingToConfirm={() => {
          const waiting = review;
          setReview(undefined);
          if (waiting) {
            void commit(waiting.payload, waiting.sent, true);
          }
        }}
        onRefused={(refused) => {
          setReview(undefined);
          report(refused);
        }}
        onCancel={() => setReview(undefined)}
      />
    </form>
  );
}
