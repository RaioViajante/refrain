"use client";

import { useId, useState } from "react";

import { Icon } from "@/app/studio/icons";
import { RatingField } from "@/app/studio/journals/rating-field";
import { useStudio } from "@/app/studio/studio-locale";
import type { StudioDictionary } from "@/i18n/studio";
import type { TrackByTrackItem, VisibilityStatus } from "@/modules/journals";

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
function visibilityWord(
  item: TrackByTrackItem,
  locale: Language,
): "public" | "included" | "private" | null {
  const saved = item.reflection;
  if (!saved) {
    return null;
  }
  if (saved.publicIn.length > 0) {
    return "public";
  }
  if (saved.isPublished && saved.texts[locale] !== undefined) {
    return "included";
  }
  return "private";
}

// What is true of this reflection, in a lead word and the rest of the sentence:
// the lead says which of the three it is. The saved row decides what is
// public; the draft only says what saving will do. The mark alone is never
// described as enough.
function visibilitySentence(
  t: StudioDictionary,
  item: TrackByTrackItem,
  draft: TrackDraft,
  locale: Language,
  status: VisibilityStatus,
): { lead: string; rest: string } {
  const saved = item.reflection;
  const w = t.trackByTrack.sentence;
  const language = t.languageInSentence[locale];
  if (!draft.isPublished) {
    if (!saved) {
      return w.nothingSaved;
    }
    return saved.isPublished ? w.privateOnSave : w.private;
  }
  if (!saved?.isPublished) {
    return w.includedOnSave(language);
  }
  if (saved.publicIn.includes(locale)) {
    return w.public(language, t.publicPageNote);
  }
  if (draft.text.trim() === "" || saved.texts[locale] === undefined) {
    return w.noText(language);
  }
  return w.notPublished(language, t.statusInSentence[status]);
}

interface TrackByTrackProps {
  tracks: TrackByTrackItem[];
  drafts: Record<string, TrackDraft>;
  baseline: Record<string, TrackDraft>;
  onEdit: (trackId: string, patch: Partial<TrackDraft>) => void;
  /** The language the journal is written in: the language edited here. */
  locale: Language;
  /** The status of that language version, for the sentence about visibility. */
  status: VisibilityStatus;
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
  const { words: t } = useStudio();
  const w = t.trackByTrack;
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
        {w.title}
      </h2>
      <p className="studio-hint">{w.hint}</p>
      {problem ? (
        <p className="studio-problem" role="alert">
          {problem}
        </p>
      ) : null}
      {tracks.length === 0 ? (
        <p className="studio-hint">{w.empty}</p>
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
                      {w.trackLabel(item.number)}
                    </span>
                    {item.title}
                    {item.archived ? (
                      <span className="studio-track-note">{w.archived}</span>
                    ) : null}
                    {item.inReferenceEdition ? null : (
                      <span className="studio-track-note">
                        {w.notInEdition}
                      </span>
                    )}
                  </span>
                  <span className="studio-track-state">
                    {w.states[state]}
                    {state !== "empty" && visibility
                      ? ` · ${w.visibility[visibility]}`
                      : ""}
                    {edited ? w.edited : ""}
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
  status: VisibilityStatus;
  unreadable: boolean;
  onEdit: (patch: Partial<TrackDraft>) => void;
}) {
  const { locale: ui, words: t } = useStudio();
  const w = t.trackByTrack;
  const id = useId();
  const sentence = visibilitySentence(t, item, draft, locale, status);
  const otherLocales = (
    Object.keys(item.reflection?.texts ?? {}) as Language[]
  ).filter((other) => other !== locale);
  return (
    <div className="studio-track-fields">
      {unreadable ? (
        <p className="studio-panel" lang={ui}>
          {w.unreadable}
        </p>
      ) : (
        <div className="studio-field-group">
          <label htmlFor={`${id}-text`} className="studio-sr-only">
            {w.textLabel(item.title, t.languageInSentence[locale])}
          </label>
          <textarea
            id={`${id}-text`}
            className="studio-textarea"
            rows={7}
            lang={locale}
            spellCheck
            value={draft.text}
            placeholder={w.placeholder}
            onChange={(event) => onEdit({ text: event.target.value })}
          />
        </div>
      )}
      {otherLocales.length > 0 ? (
        <p className="studio-hint">
          {w.alsoWritten(
            otherLocales.map((other) => t.languageInSentence[other]).join(", "),
          )}
        </p>
      ) : null}

      <RatingField
        label={w.rating}
        compact
        value={draft.rating}
        onChange={(rating) => onEdit({ rating })}
      />

      <div className="studio-checks">
        <Check
          label={w.favourite}
          hint={w.favouriteHint}
          checked={draft.isFavourite}
          onChange={(isFavourite) => onEdit({ isFavourite })}
        />
        <Check
          label={w.stillWriting}
          hint={w.stillWritingHint}
          checked={draft.isStillWriting}
          onChange={(isStillWriting) => onEdit({ isStillWriting })}
        />
        <Check
          label={w.include}
          hint={w.includeHint}
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
