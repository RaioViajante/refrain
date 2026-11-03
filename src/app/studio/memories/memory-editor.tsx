"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";

import {
  FormStatus,
  TextAreaField,
  TextField,
  useSubmission,
  useUnsavedGuard,
} from "@/app/studio/form-kit";
import {
  createMemoryAction,
  saveMemoryAction,
} from "@/app/studio/memories/actions";
import { MemoryControls } from "@/app/studio/memories/memory-controls";
import { MemoryMusic } from "@/app/studio/memories/memory-music";
import {
  derivedArtists,
  type Recording,
} from "@/app/studio/memories/recordings";
import { problemWith } from "@/app/studio/messages";
import { StatusMark } from "@/app/studio/status-mark";
import type { VisibilityStatus } from "@/modules/journals";

// The limits the server enforces (src/modules/journals/input.ts), so the
// fields stop where the command would refuse.
const MAX_TITLE = 200;
const MAX_WHEN = 200;

function words(text: string): number {
  return text.trim() === "" ? 0 : text.trim().split(/\s+/).length;
}

interface Draft {
  title: string;
  rememberedWhen: string;
  body: string;
  recordings: Recording[];
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
 * changes asks first. Nothing here publishes.
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
    status: VisibilityStatus;
    /** Album links the editor cannot change (written outside the studio). */
    albumLinks: string[];
  };
  initial: Draft;
  /** Recordings in the catalog that are not archived. */
  choices: Recording[];
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft>(initial);
  const [base, setBase] = useState<Draft>(initial);
  const [version, setVersion] = useState(edit?.version ?? 1);
  const [saved, setSaved] = useState(false);
  const [created, setCreated] = useState(false);
  const { pending, failure, run } = useSubmission();
  const saving = useRef(false);

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

  async function save(event?: FormEvent) {
    event?.preventDefault();
    if (pending || created || saving.current) {
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
          title: sent.title,
          rememberedWhen: sent.rememberedWhen,
          body: sent.body,
          trackIds: sent.recordings.map((recording) => recording.trackId),
        }),
      );
      if (result.ok) {
        setCreated(true);
        setSaved(true);
        router.push(`/studio/memories/${result.data.entryId}`);
      }
      return;
    }
    // Only what changed is sent, so a save never rewrites what the author did
    // not touch.
    const payload: Record<string, unknown> = {
      entryId: edit.entryId,
      expectedVersion: version,
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
    if (Object.keys(payload).length === 2) {
      setSaved(true);
      return;
    }
    const result = await run(() => saveMemoryAction(payload));
    if (result.ok) {
      setVersion(result.data.version);
      setBase(sent);
      setSaved(true);
      router.refresh();
    }
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
  const musicProblem = failure?.fields?.trackIds
    ? "A song appears twice, or there are too many songs, so nothing was saved."
    : undefined;

  return (
    <form onSubmit={save} className="studio-editor" noValidate>
      <div className="studio-editorbar" data-mode={create ? "create" : "edit"}>
        <div className="studio-editorbar-start">
          <Link href="/studio/memories" className="studio-crumb">
            ← Memories
          </Link>
          <span className="studio-crumb-sep" aria-hidden="true">
            /
          </span>
          <span className="studio-crumb-current">
            {create ? "New memory" : "Memory"}
          </span>
          <StatusMark status={status} />
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
            {create ? "Save as draft" : "Save"}
          </button>
        </div>
      </div>

      <h1 className="studio-sr-only">
        {create ? "Write a memory" : "Edit a memory"}
      </h1>

      {status === "published" ? (
        <p className="studio-panel" role="note">
          This memory is marked as published. Saving changes to a published
          memory isn’t built yet, so saving is refused until you make it
          private. Your text stays here.
        </p>
      ) : null}

      <div className="studio-columns">
        <div className="studio-writing-column">
          <TextField
            label="Title"
            hideLabel
            placeholder="A title for this memory"
            value={draft.title}
            onChange={(value) => edited({ title: value })}
            maxLength={MAX_TITLE}
            lang="en"
            variant="title"
            problem={problemWith(failure, "title")}
          />
          <TextField
            label="When"
            placeholder="a date, a season, a year"
            value={draft.rememberedWhen}
            onChange={(value) => edited({ rememberedWhen: value })}
            maxLength={MAX_WHEN}
            lang="en"
            width="480px"
            hint="However you remember it. It doesn’t need to be exact."
            problem={problemWith(failure, "rememberedWhen")}
          />
          <div className="grid gap-2">
            <TextAreaField
              label="The memory"
              placeholder="Write what you remember…"
              value={draft.body}
              onChange={(value) => edited({ body: value })}
              rows={18}
              lang="en"
              problem={problemWith(failure, "body")}
            />
            <p className="studio-count" aria-live="off">
              {words(draft.body)} {words(draft.body) === 1 ? "word" : "words"}
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
              Artists, from the music
            </h2>
            <p className="studio-meta">
              {artists.length > 0
                ? artists.join(", ")
                : "None yet. They come from the songs you add."}
            </p>
          </section>

          <section aria-labelledby="memory-language" className="space-y-1">
            <h2 id="memory-language" className="studio-label">
              Written in
            </h2>
            <p className="studio-meta">English</p>
            <p className="studio-hint">
              Memories are written in English for now. Nothing is translated for
              you.
            </p>
          </section>

          {edit ? (
            <MemoryControls
              entryId={edit.entryId}
              title={base.title}
              status={edit.status}
              dirty={dirty}
            />
          ) : (
            <p className="studio-hint">
              A new memory starts as a private draft. Nothing here is published.
            </p>
          )}
        </div>
      </div>
    </form>
  );
}
