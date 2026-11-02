"use client";

import { useId } from "react";

// A half-step rating: five ink stars, each in two halves (docs/design-system.md
// § Components, Rating). Optional, with "No rating" by default, and it is
// never calculated from anything else. It is one radio group: the arrow keys
// move through the half steps, and the row is 44px tall. The ten halves and
// "No rating" are real radio inputs, so the value is announced in words.

const STAR =
  "M12 3.2l2.6 5.5 6 .8-4.4 4.2 1.1 6-5.3-2.9-5.3 2.9 1.1-6L3.4 9.5l6-.8z";

function words(halfSteps: number | null): string {
  if (halfSteps === null) {
    return "No rating";
  }
  const stars = halfSteps / 2;
  return `${stars} ${stars === 1 ? "star" : "stars"}`;
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
  const name = useId();
  const noteId = `${name}-note`;
  return (
    <fieldset
      className="studio-rating"
      data-compact={compact ? "" : undefined}
      disabled={disabled}
      aria-describedby={hint ? noteId : undefined}
    >
      <legend className="studio-label">
        {label} <span className="studio-optional">(optional)</span>
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
                    <span className="studio-sr-only">{words(half)}</span>
                    <svg
                      viewBox={half % 2 === 1 ? "0 0 12 24" : "12 0 12 24"}
                      width="14"
                      height="28"
                      aria-hidden="true"
                      focusable="false"
                      data-on={value !== null && value >= half ? "" : undefined}
                    >
                      <path d={STAR} />
                    </svg>
                  </label>
                </span>
              ))}
            </span>
          ))}
        </div>
        <input
          type="radio"
          id={`${name}-none`}
          name={name}
          className="studio-sr-only"
          checked={value === null}
          onChange={() => onChange(null)}
        />
        <label htmlFor={`${name}-none`} className="studio-sr-only">
          No rating
        </label>
        {/* The value in words, for the eye. The radios carry it for assistive
            technology, so this is not read twice. */}
        <span className="studio-rating-words" aria-hidden="true">
          {words(value)}
        </span>
        {value !== null ? (
          <button
            type="button"
            className="studio-button-quiet"
            onClick={() => onChange(null)}
          >
            Clear
          </button>
        ) : null}
      </div>
      {hint ? (
        <p id={noteId} className="studio-hint">
          {hint}
        </p>
      ) : null}
    </fieldset>
  );
}
