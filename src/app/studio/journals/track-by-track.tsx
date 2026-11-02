"use client";

import { useId, useState } from "react";

import { Icon } from "@/app/studio/icons";
import { RatingField } from "@/app/studio/journals/rating-field";
import type { TrackByTrackItem } from "@/modules/journals";

// Track by track (docs/design-system.md, AlbumEditor): each track of the
// album, in the reference edition's order, opens to a reflection, a rating,
// and three marks. A reflection saved privately, one included when published,
// and one that is actually published are three different things, and this
// screen says which it is in words (ADR 0002, D5.2): the mark alone never
// publishes anything, a published version of the journal does that for the
// language it is in.

/** What the author can change on one track's reflection. */
export interface TrackDraft {
  text: string;
  isFavourite: boolean;
  isStillWriting: boolean;
  isPublished: boolean;
  /** Half steps, 1 to 10, or `null`. */
  rating: number | null;
}

type Language = "en" | "pt-BR";

const LANGUAGE_NAMES: Record<Language, string> = {
  en: "English",
  "pt-BR": "Português (Brasil)",
};

export function draftOf(item: TrackByTrackItem, locale: Language): TrackDraft {
  const saved = item.reflection;
  return {
    // Text the plain editor cannot show is `null`: it is never loaded, and
    // never sent back, so it stays exactly as it is.
    text: saved?.texts[locale] ?? "",
    isFavourite: saved?.isFavourite ?? false,
    isStillWriting: saved?.isStillWriting ?? false,
    isPublished: saved?.isPublished ?? false,
    rating: saved?.ratingHalfSteps ?? null,
  };
}

export function sameDraft(a: TrackDraft, b: TrackDraft): boolean {
  return (
    a.text === b.text &&
    a.isFavourite === b.isFavourite &&
    a.isStillWriting === b.isStillWriting &&
    a.isPublished === b.isPublished &&
    a.rating === b.rating
  );
}

// The writing state is derived (docs/data-model.md): empty, still writing, or
// written. It is never stored as a status, and it never decides visibility.
function writingState(
  draft: TrackDraft,
): "empty" | "still writing" | "written" {
  if (draft.text.trim() === "") {
    return "empty";
  }
  return draft.isStillWriting ? "still writing" : "written";
}

// What is true of this reflection now, as saved: public, included when
// published but not public yet, or private. The mark alone is never described as enough.
function visibilityWord(item: TrackByTrackItem, locale: Language) {
  const saved = item.reflection;
  if (!saved) {
    return null;
  }
  if (saved.publicIn.length > 0) {
    return "public";
  }
  if (saved.isPublished && saved.texts[locale] !== undefined) {
    return "included when published";
  }
  return "private";
}

// What is true of this reflection, in a lead word and the rest of the sentence:
// the lead says which of the three it is. The saved row decides what is
// public; the draft only says what saving will do. The mark alone is never
// described as enough.
function visibilitySentence(
  item: TrackByTrackItem,
  draft: TrackDraft,
  locale: Language,
  status: string,
): { lead: string; rest: string } {
  const saved = item.reflection;
  const language = LANGUAGE_NAMES[locale];
  if (!draft.isPublished) {
    if (!saved) {
      return {
        lead: "Nothing saved yet",
        rest: ". Once you save it, it stays private: only you can see it.",
      };
    }
    return {
      lead: "Private",
      rest: saved.isPublished
        ? ". Saving stops it being included when published. Only you can see it."
        : ". It is not included when published. Only you can see it.",
    };
  }
  if (!saved?.isPublished) {
    return {
      lead: "Included when published, once you save",
      rest: `. That publishes nothing by itself: the ${language} version of the journal has to be published too.`,
    };
  }
  if (saved.publicIn.includes(locale)) {
    return {
      lead: "Public",
      rest: `. It is part of the ${language} version that is marked as published in your records. No public page exists yet, so nothing opens on the web.`,
    };
  }
  if (draft.text.trim() === "" || saved.texts[locale] === undefined) {
    return {
      lead: "Included when published",
      rest: `, but there is no text in ${language} yet, so there is nothing to publish.`,
    };
  }
  return {
    lead: "Included when published, not published yet",
    rest: `: the ${language} version of this journal is not published (it is ${status === "draft" ? "a draft" : status}). It is published only with that version.`,
  };
}

interface TrackByTrackProps {
  tracks: TrackByTrackItem[];
  drafts: Record<string, TrackDraft>;
  baseline: Record<string, TrackDraft>;
  onEdit: (trackId: string, patch: Partial<TrackDraft>) => void;
  /** The language the journal is written in: the language edited here. */
  locale: Language;
  /** The status of that language version, for the sentence about visibility. */
  status: string;
  /** The saved album rating is edited in the page, above; shown, not edited. */
  problem?: string;
}

export function TrackByTrack({
  tracks,
  drafts,
  baseline,
  onEdit,
  locale,
  status,
  problem,
}: TrackByTrackProps) {
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const heading = useId();

  function toggle(trackId: string) {
    setOpen((current) => {
      const next = new Set(current);
      if (!next.delete(trackId)) {
        next.add(trackId);
      }
      return next;
    });
  }

  return (
    <section aria-labelledby={heading} className="studio-tracks">
      <h2 id={heading} className="studio-section-title">
        Track by track
      </h2>
      <p className="studio-hint">
        Write about the tracks you want to. Empty tracks show as “not written
        yet”.
      </p>
      {problem ? (
        <p className="studio-problem" role="alert">
          {problem}
        </p>
      ) : null}
      {tracks.length === 0 ? (
        <p className="studio-hint">
          This album has no tracks yet. Add them in the catalog, and they appear
          here.
        </p>
      ) : (
        <ol className="studio-list studio-tracklist">
          {tracks.map((item) => {
            const draft = drafts[item.trackId]!;
            const edited = !sameDraft(draft, baseline[item.trackId]!);
            const isOpen = open.has(item.trackId);
            const state = writingState(draft);
            const visibility = visibilityWord(item, locale);
            const panelId = `${heading}-${item.trackId}`;
            const unreadable = item.reflection?.texts[locale] === null;
            return (
              <li key={item.trackId} className="studio-row studio-track">
                <button
                  type="button"
                  className="studio-track-head"
                  aria-expanded={isOpen}
                  aria-controls={isOpen ? panelId : undefined}
                  onClick={() => toggle(item.trackId)}
                >
                  <span className="studio-track-number" aria-hidden="true">
                    {String(item.number).padStart(2, "0")}
                  </span>
                  <span className="studio-track-title" data-state={state}>
                    <span className="studio-sr-only">
                      Track {item.number}:{" "}
                    </span>
                    {item.title}
                    {item.archived ? (
                      <span className="studio-track-note">
                        {" "}
                        · archived in the catalog
                      </span>
                    ) : null}
                    {item.inReferenceEdition ? null : (
                      <span className="studio-track-note">
                        {" "}
                        · not on the reference edition
                      </span>
                    )}
                  </span>
                  <span className="studio-track-state">
                    {state}
                    {state !== "empty" && visibility ? ` · ${visibility}` : ""}
                    {edited ? " · edited" : ""}
                  </span>
                  <span
                    className="studio-track-chevron"
                    data-open={isOpen ? "" : undefined}
                  >
                    <Icon name="chevron" size={17} />
                  </span>
                </button>

                {isOpen ? (
                  <div id={panelId} className="studio-track-panel">
                    <TrackPanel
                      item={item}
                      draft={draft}
                      locale={locale}
                      status={status}
                      unreadable={unreadable}
                      onEdit={(patch) => onEdit(item.trackId, patch)}
                    />
                  </div>
                ) : null}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

function TrackPanel({
  item,
  draft,
  locale,
  status,
  unreadable,
  onEdit,
}: {
  item: TrackByTrackItem;
  draft: TrackDraft;
  locale: Language;
  status: string;
  unreadable: boolean;
  onEdit: (patch: Partial<TrackDraft>) => void;
}) {
  const id = useId();
  const sentence = visibilitySentence(item, draft, locale, status);
  const otherLocales = (
    Object.keys(item.reflection?.texts ?? {}) as Language[]
  ).filter((other) => other !== locale);
  return (
    <div className="studio-track-fields">
      {unreadable ? (
        <p className="studio-panel" lang="en">
          This reflection has formatting that the plain editor can’t show
          without losing it, so it can’t be edited here. It is untouched.
        </p>
      ) : (
        <div className="studio-field-group">
          <label htmlFor={`${id}-text`} className="studio-sr-only">
            Your reflection on {item.title}, in {LANGUAGE_NAMES[locale]}
          </label>
          <textarea
            id={`${id}-text`}
            className="studio-textarea"
            rows={7}
            lang={locale}
            spellCheck
            value={draft.text}
            placeholder="What you noticed in this track…"
            onChange={(event) => onEdit({ text: event.target.value })}
          />
        </div>
      )}
      {otherLocales.length > 0 ? (
        <p className="studio-hint">
          Also written in{" "}
          {otherLocales.map((other) => LANGUAGE_NAMES[other]).join(", ")}. It is
          kept as it is, and stays private unless it is included when published
          and that version is published.
        </p>
      ) : null}

      <RatingField
        label="Rating for this track"
        compact
        value={draft.rating}
        onChange={(rating) => onEdit({ rating })}
      />

      <div className="studio-checks">
        <Check
          label="Mark as favourite"
          hint="Shown as a small circle once published."
          checked={draft.isFavourite}
          onChange={(isFavourite) => onEdit({ isFavourite })}
        />
        <Check
          label="Still writing"
          hint="Shown as “still writing” until you clear it."
          checked={draft.isStillWriting}
          onChange={(isStillWriting) => onEdit({ isStillWriting })}
        />
        <Check
          label="Include when published"
          hint="Publishes nothing by itself: it counts once this language version is published. Public web pages are not available yet."
          checked={draft.isPublished}
          onChange={(isPublished) => onEdit({ isPublished })}
        />
      </div>
      <p className="studio-track-visibility" aria-live="polite">
        <span className="studio-track-lead">{sentence.lead}</span>
        {sentence.rest}
      </p>
    </div>
  );
}

function Check({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  const id = useId();
  return (
    <div className="studio-check">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        aria-describedby={`${id}-hint`}
        onChange={(event) => onChange(event.target.checked)}
      />
      <label htmlFor={id}>{label}</label>
      <p id={`${id}-hint`} className="studio-hint">
        {hint}
      </p>
    </div>
  );
}
