"use client";

import { useStudio } from "./studio-locale";

export interface CreditRow {
  artistId: string;
  creditedAs: string;
}

interface ArtistRowsProps {
  /** What the rows are, for example "Credited artists". */
  legend: string;
  rows: CreditRow[];
  onChange: (rows: CreditRow[]) => void;
  options: { value: string; label: string }[];
  /** Rows that cannot be removed. */
  minimum: number;
  /** Offer a "credited as" name for each row (albums). */
  withCreditedAs?: boolean;
  problem?: string;
  emptyHint?: string;
}

/**
 * An ordered list of artists to credit: one select per artist, with buttons
 * to reorder and remove, and a button to add another. Order is the credit
 * order. The buttons are labelled with the row they act on.
 */
export function ArtistRows({
  legend,
  rows,
  onChange,
  options,
  minimum,
  withCreditedAs = false,
  problem,
  emptyHint,
}: ArtistRowsProps) {
  const w = useStudio().words.artistRows;
  function update(index: number, patch: Partial<CreditRow>) {
    onChange(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }
  function move(index: number, by: -1 | 1) {
    const target = index + by;
    if (target < 0 || target >= rows.length) {
      return;
    }
    const next = [...rows];
    [next[index], next[target]] = [next[target]!, next[index]!];
    onChange(next);
  }

  return (
    <fieldset className="space-y-4 border-0 p-0 mx-0 mt-0 min-w-0">
      <legend className="studio-label mb-3">{legend}</legend>
      {rows.length === 0 && emptyHint ? (
        <p className="studio-hint">{emptyHint}</p>
      ) : null}
      {rows.map((row, index) => (
        <div key={index} className="studio-credit-row">
          <select
            className="studio-field"
            aria-label={w.artist(legend, index + 1)}
            value={row.artistId}
            onChange={(event) =>
              update(index, { artistId: event.target.value })
            }
          >
            <option value="">{w.choose}</option>
            {options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          {withCreditedAs ? (
            <input
              className="studio-field"
              aria-label={w.creditedAs(legend, index + 1)}
              placeholder={w.creditedAsPlaceholder}
              maxLength={200}
              autoComplete="off"
              value={row.creditedAs}
              onChange={(event) =>
                update(index, { creditedAs: event.target.value })
              }
            />
          ) : (
            <span />
          )}
          <div className="studio-actions" style={{ gap: 4 }}>
            <button
              type="button"
              className="studio-button-quiet"
              onClick={() => move(index, -1)}
              disabled={index === 0}
              aria-label={w.moveUp(index + 1)}
            >
              ↑
            </button>
            <button
              type="button"
              className="studio-button-quiet"
              onClick={() => move(index, 1)}
              disabled={index === rows.length - 1}
              aria-label={w.moveDown(index + 1)}
            >
              ↓
            </button>
            <button
              type="button"
              className="studio-button-quiet"
              onClick={() => onChange(rows.filter((_, i) => i !== index))}
              disabled={rows.length <= minimum}
              aria-label={w.remove(index + 1)}
            >
              {w.removeShort}
            </button>
          </div>
        </div>
      ))}
      {problem ? (
        <p className="studio-problem" role="alert">
          {problem}
        </p>
      ) : null}
      <button
        type="button"
        className="studio-button"
        onClick={() => onChange([...rows, { artistId: "", creditedAs: "" }])}
      >
        {rows.length === 0 ? w.addFirst : w.addAnother}
      </button>
    </fieldset>
  );
}
