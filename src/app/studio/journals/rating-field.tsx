"use client";

import { useId, useRef } from "react";

import { StarInk } from "@/app/studio/journals/star-ink";
import { useStudio } from "@/app/studio/studio-locale";
import type { StudioDictionary } from "@/i18n/studio";

// A half-step rating: five hand-drawn stars, each in two halves (docs/design-system.md
// § Components, Rating). Optional, with "No rating" by default, and it is
// never calculated from anything else. It is one radio group: the arrow keys
// move through the half steps, and the row is 44px tall. The ten halves and
// "No rating" are real radio inputs, so the value is announced in words.

function words(t: StudioDictionary, halfSteps: number | null): string {
  return halfSteps === null ? t.rating.none : t.rating.stars(halfSteps);
}

interface RatingFieldProps {
  label: string;
  /** Half steps, 1 to 10, or `null` for no rating. */
  value: number | null;
  onChange: (value: number | null) => void;
  hint?: string;
  /** Marks the label as secondary, as the track panel does. */
  compact?: boolean;
  disabled?: boolean;
}

export function RatingField({
  label,
  value,
  onChange,
  hint,
  compact,
  disabled,
}: RatingFieldProps) {
  const { words: t } = useStudio();
  const name = useId();
  const noteId = `${name}-note`;
  const noRating = useRef<HTMLInputElement>(null);
  return (
    <fieldset
      className="studio-rating"
      data-compact={compact ? "" : undefined}
      disabled={disabled}
      aria-describedby={hint ? noteId : undefined}
    >
      <legend className="studio-label">
        {label} <span className="studio-optional">({t.common.optional})</span>
      </legend>
      <div className="studio-rating-row">
        <div className="studio-stars">
          {[1, 2, 3, 4, 5].map((star) => (
            <span key={star} className="studio-star">
              {[star * 2 - 1, star * 2].map((half) => (
                <span
                  key={half}
                  className="studio-star-half"
                  data-side={half % 2 === 1 ? "left" : "right"}
                >
                  <input
                    type="radio"
                    id={`${name}-${half}`}
                    name={name}
                    className="studio-sr-only"
                    checked={value === half}
                    onChange={() => onChange(half)}
                  />
                  <label htmlFor={`${name}-${half}`}>
                    <span className="studio-sr-only">{words(t, half)}</span>
                    <svg
                      viewBox={half % 2 === 1 ? "0 0 12 24" : "12 0 12 24"}
                      width="14"
                      height="28"
                      aria-hidden="true"
                      focusable="false"
                    >
                      <StarInk
                        fill={
                          value !== null && value >= half ? "full" : "empty"
                        }
                      />
                    </svg>
                  </label>
                </span>
              ))}
            </span>
          ))}
        </div>
        <input
          ref={noRating}
          type="radio"
          id={`${name}-none`}
          name={name}
          className="studio-sr-only"
          checked={value === null}
          onChange={() => onChange(null)}
        />
        <label htmlFor={`${name}-none`} className="studio-sr-only">
          {t.rating.none}
        </label>
        {/* The value in words, for the eye. The radios carry it for assistive
            technology, so this is not read twice. */}
        <span className="studio-rating-words" aria-hidden="true">
          {words(t, value)}
        </span>
        {/* Always in the row, so that choosing a first rating moves nothing.
            Without a rating it is invisible and out of the tab order, so
            Clear hands focus to "No rating", the value it chose, in the same
            group: focus never stays on a hidden button or falls to the page.
            Only Clear does this; a rating changed any other way moves no
            focus. */}
        <button
          type="button"
          className="studio-button-quiet"
          data-unset={value === null ? "" : undefined}
          onClick={() => {
            onChange(null);
            noRating.current?.focus();
          }}
        >
          {t.rating.clear}
        </button>
      </div>
      {hint ? (
        <p id={noteId} className="studio-hint">
          {hint}
        </p>
      ) : null}
    </fieldset>
  );
}
