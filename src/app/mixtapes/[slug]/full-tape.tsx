"use client";

import { useId, useState } from "react";

import { Sparkle } from "@/components/marks";
import { cx } from "@/lib/cx";

import styles from "./mixtape.module.css";

export type FullTapeRow = {
  n: number;
  title: string;
  artist: string;
  note: string;
  url: string;
  label: string;
};

/** Rows shown while the list is collapsed (12 of them on a phone, in CSS). */
const COLLAPSED = 30;
const COLLAPSED_NARROW = 12;

/**
 * "a fita inteira": tracks 21 onwards in three columns. As in the
 * reference, the first 30 show until the list is opened, and the notes
 * filter shows every annotated track.
 */
export function FullTape({
  rows,
  trackCount,
}: {
  rows: FullTapeRow[];
  trackCount: number;
}) {
  const [open, setOpen] = useState(false);
  const [notesOnly, setNotesOnly] = useState(false);
  const listId = useId();

  const source = notesOnly ? rows.filter((r) => r.note) : rows;
  const list = open || notesOnly ? source : source.slice(0, COLLAPSED);
  const collapsed = !(open || notesOnly);
  // Opening only matters when rows are hidden: beyond 12 on a phone, beyond
  // 30 on a wider screen.
  const canOpen = rows.length > COLLAPSED_NARROW;
  const narrowOnly = rows.length <= COLLAPSED;
  const hasNotes = rows.some((r) => r.note);

  return (
    <>
      <div className={styles.fullBox}>
        <ol
          id={listId}
          className={cx(styles.fullList, collapsed && styles.fullCollapsed)}
        >
          {list.map((r) => (
            <li key={r.n} className={styles.fullRow}>
              <span className={styles.fullNumber}>{r.n}</span>
              <span className={styles.fullText}>
                <span className={styles.fullTitle}>{r.title}</span>{" "}
                <span className={styles.fullArtist}>— {r.artist}</span>
                {r.note ? (
                  <span className={styles.fullNote}>
                    <span className={styles.fullStar}>
                      <Sparkle kind={3} delay="-3.59s" sizes="12px" />
                    </span>
                    <i>{r.note}</i>
                  </span>
                ) : null}
              </span>
              <a
                href={r.url}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={r.label}
                className={styles.fullListen}
              >
                ↗
              </a>
            </li>
          ))}
        </ol>
        {collapsed && canOpen ? (
          <div
            aria-hidden="true"
            className={cx(styles.fullFade, narrowOnly && styles.narrowOnly)}
          />
        ) : null}
      </div>
      {canOpen || hasNotes ? (
        <div className={styles.fullButtons}>
          {canOpen ? (
            <button
              type="button"
              className={cx(styles.expand, narrowOnly && styles.narrowOnly)}
              aria-expanded={open}
              aria-controls={listId}
              onClick={() => {
                setOpen(!open);
                setNotesOnly(false);
              }}
            >
              {open ? "recolher ↑" : `ver as ${trackCount} faixas ↓`}
            </button>
          ) : null}
          {hasNotes ? (
            <button
              type="button"
              className={styles.notesToggle}
              aria-pressed={notesOnly}
              aria-controls={listId}
              onClick={() => setNotesOnly(!notesOnly)}
            >
              <span className={styles.notesStar}>
                <Sparkle kind={3} delay="-4.96s" sizes="12px" />
              </span>
              {notesOnly ? "mostrar todas" : "só as que têm anotação"}
            </button>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
