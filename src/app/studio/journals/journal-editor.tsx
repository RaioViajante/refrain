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
import { problemWith } from "@/app/studio/messages";
import { StatusMark } from "@/app/studio/status-mark";
import type { VisibilityStatus } from "@/modules/journals";

const LANGUAGES = [
  { value: "en", label: "English" },
  { value: "pt-BR", label: "Português (Brasil)" },
];

type Language = "en" | "pt-BR";

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
  };
  initial: { opening: string; body: string };
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
  back,
  heading,
}: JournalEditorProps) {
  const router = useRouter();
  const languageNote = useId();
  const [opening, setOpening] = useState(initial.opening);
  const [body, setBody] = useState(initial.body);
  const [locale, setLocale] = useState<Language>(edit?.locale ?? "en");
  const [version, setVersion] = useState(edit?.version ?? 1);
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);
  // A new journal is created once: after it succeeds, a second save (a double
  // Cmd+S before the redirect) must not create another.
  const [created, setCreated] = useState(false);
  const { pending, failure, run } = useSubmission();
  useUnsavedGuard(dirty);

  async function save(event?: FormEvent) {
    event?.preventDefault();
    if (pending || created) {
      return;
    }
    if (edit) {
      const result = await run(() =>
        saveJournalAction({
          entryId: edit.entryId,
          expectedVersion: version,
          opening,
          body,
        }),
      );
      if (result.ok) {
        setVersion(result.data.version);
        setDirty(false);
        setSaved(true);
        router.refresh();
      }
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
      setDirty(false);
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
    setDirty(true);
    setSaved(false);
  }

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
            disabled={pending}
          >
            {create ? "Save as draft" : "Save"}
          </button>
        </div>
      </div>

      {heading}

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
    </form>
  );
}
