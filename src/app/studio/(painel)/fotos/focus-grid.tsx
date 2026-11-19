"use client";

import styles from "./page.module.css";
import { FOCUS_LABELS } from "./photo-types";

/** The editor's 3 × 3 focal point grid; its value goes in `focus`. */
export function FocusGrid({
  id,
  value,
  onChange,
}: {
  id: string;
  value: number;
  onChange: (focus: number) => void;
}) {
  return (
    <div className={styles.focus}>
      <input type="hidden" name="focus" value={value} />
      <div role="group" aria-labelledby={`${id}-l`} className={styles.grid}>
        {FOCUS_LABELS.map((label, i) => (
          <button
            key={i}
            type="button"
            aria-pressed={value === i}
            aria-label={label}
            onClick={() => onChange(i)}
            className={styles.cell}
          >
            <span aria-hidden="true" className={styles.cellDot} />
          </button>
        ))}
      </div>
      <div>
        <p id={`${id}-l`} className={styles.label}>
          ponto de foco
        </p>
        <p className={styles.focusName}>{FOCUS_LABELS[value] ?? "centro"}</p>
        <p className={styles.help}>o que nunca pode ser cortado</p>
      </div>
    </div>
  );
}
