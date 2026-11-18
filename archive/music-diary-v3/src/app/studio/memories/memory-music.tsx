"use client";

import Link from "next/link";
import { useEffect, useId, useMemo, useRef, useState } from "react";

import { Icon } from "@/app/studio/icons";
import {
  MAX_MATCHES,
  matchRecordings,
  moveRecording,
  recordingFacts,
  type Recording,
} from "@/app/studio/memories/recordings";
import { useStudio } from "@/app/studio/studio-locale";

type Focus =
  | { trackId: string; control: "up" | "down" | "remove" }
  | { control: "search" };

/**
 * "The music" of the V4.4 memory editor: the memory's recordings in order,
 * each with Move up, Move down, and Remove, and a field that finds a
 * recording in the author's catalog to add. Nothing is searched outside the
 * catalog, and removing a recording only unlinks it.
 *
 * Keyboard: every control is a real button with a name that says which
 * recording it acts on. Focus stays with the recording that moved, goes to
 * the search field after a removal, and stays in the field after an addition;
 * each change is also said in a polite status line.
 */
export function MemoryMusic({
  recordings,
  choices,
  onChange,
  albumLinks = [],
  problem,
}: {
  recordings: Recording[];
  choices: Recording[];
  onChange: (next: Recording[]) => void;
  /** Album links the editor cannot change; while there is one, it is read-only. */
  albumLinks?: string[];
  problem?: string;
}) {
  const { words: t, href } = useStudio();
  const w = t.memoryMusic;
  const headingId = useId();
  const searchId = useId();
  const resultsId = useId();
  const [query, setQuery] = useState("");
  const [announcement, setAnnouncement] = useState("");
  // Where focus goes once the list has re-rendered after a change.
  const pendingFocus = useRef<Focus | undefined>(undefined);
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const search = useRef<HTMLInputElement>(null);
  const readOnly = albumLinks.length > 0;

  const linked = useMemo(
    () => new Set(recordings.map((recording) => recording.trackId)),
    [recordings],
  );
  const matches = useMemo(
    () => matchRecordings(choices, query, linked),
    [choices, query, linked],
  );

  useEffect(() => {
    const focus = pendingFocus.current;
    if (!focus) {
      return;
    }
    pendingFocus.current = undefined;
    if (focus.control === "search") {
      search.current?.focus();
      return;
    }
    const wanted = buttons.current.get(`${focus.trackId}:${focus.control}`);
    // At an end of the list the button it was is disabled; the other one
    // keeps the place.
    const other = buttons.current.get(
      `${focus.trackId}:${focus.control === "up" ? "down" : "up"}`,
    );
    (wanted && !wanted.disabled ? wanted : other)?.focus();
  });

  function register(key: string) {
    return (element: HTMLButtonElement | null) => {
      if (element) {
        buttons.current.set(key, element);
      } else {
        buttons.current.delete(key);
      }
    };
  }

  function move(index: number, direction: "up" | "down") {
    const recording = recordings[index]!;
    onChange(moveRecording(recordings, index, direction));
    const place = direction === "up" ? index : index + 2;
    setAnnouncement(
      w.moved(recording.title, direction, place, recordings.length),
    );
    pendingFocus.current = { trackId: recording.trackId, control: direction };
  }

  function remove(index: number) {
    const recording = recordings[index]!;
    onChange(recordings.filter((_, at) => at !== index));
    setAnnouncement(w.removed(recording.title));
    pendingFocus.current = { control: "search" };
  }

  function add(recording: Recording) {
    onChange([...recordings, recording]);
    setQuery("");
    setAnnouncement(w.added(recording.title));
    pendingFocus.current = { control: "search" };
  }

  return (
    <section aria-labelledby={headingId} className="studio-memory-music">
      <h2 id={headingId} className="studio-label">
        {t.memory.music}
      </h2>

      {recordings.length === 0 && albumLinks.length === 0 ? (
        <p className="studio-hint">{w.empty}</p>
      ) : (
        <ol className="studio-memory-songs" aria-label={w.listLabel}>
          {recordings.map((recording, index) => (
            <li key={recording.trackId} className="studio-memory-song">
              <span className="studio-memory-thumb" aria-hidden="true">
                <Icon name="note" size={20} />
              </span>
              <span className="studio-memory-song-body">
                <span className="studio-memory-song-title">
                  {recording.title}
                </span>
                <span className="studio-memory-song-facts">
                  {recordingFacts(t, recording)}
                </span>
              </span>
              {readOnly ? null : (
                <span className="studio-memory-song-controls">
                  <button
                    type="button"
                    ref={register(`${recording.trackId}:up`)}
                    className="studio-icon-button"
                    aria-label={w.moveUp(
                      recording.title,
                      index + 1,
                      recordings.length,
                    )}
                    disabled={index === 0}
                    onClick={() => move(index, "up")}
                  >
                    <Icon name="up" size={18} />
                  </button>
                  <button
                    type="button"
                    ref={register(`${recording.trackId}:down`)}
                    className="studio-icon-button"
                    aria-label={w.moveDown(
                      recording.title,
                      index + 1,
                      recordings.length,
                    )}
                    disabled={index === recordings.length - 1}
                    onClick={() => move(index, "down")}
                  >
                    <Icon name="down" size={18} />
                  </button>
                  <button
                    type="button"
                    ref={register(`${recording.trackId}:remove`)}
                    className="studio-icon-button"
                    aria-label={w.remove(
                      recording.title,
                      index + 1,
                      recordings.length,
                    )}
                    onClick={() => remove(index)}
                  >
                    <Icon name="close" size={18} />
                  </button>
                </span>
              )}
            </li>
          ))}
          {albumLinks.map((title, index) => (
            <li key={`album-${index}`} className="studio-memory-song">
              <span className="studio-memory-thumb" aria-hidden="true">
                <Icon name="album" size={20} />
              </span>
              <span className="studio-memory-song-body">
                <span className="studio-memory-song-title">{title}</span>
                <span className="studio-memory-song-facts">{w.album}</span>
              </span>
            </li>
          ))}
        </ol>
      )}

      {problem ? (
        <p className="studio-problem" role="alert">
          {problem}
        </p>
      ) : null}

      {readOnly ? (
        <p className="studio-hint">{w.readOnly}</p>
      ) : (
        <>
          <div className="studio-memory-add">
            <label htmlFor={searchId} className="studio-sr-only">
              {w.addLabel}
            </label>
            <span className="studio-memory-add-field">
              <Icon name="plus" size={18} />
              <input
                id={searchId}
                ref={search}
                type="search"
                className="studio-field"
                placeholder={w.addPlaceholder}
                autoComplete="off"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                aria-controls={query.trim() ? resultsId : undefined}
                onKeyDown={(event) => {
                  // Enter in this field never saves the whole memory.
                  if (event.key === "Enter") {
                    event.preventDefault();
                  }
                  if (event.key === "Escape" && query) {
                    event.preventDefault();
                    setQuery("");
                  }
                }}
              />
            </span>
            {query.trim() ? (
              <div
                id={resultsId}
                className="studio-memory-results"
                role="region"
                aria-label={w.resultsLabel}
              >
                <p className="studio-memory-results-label">{w.inCatalog}</p>
                {matches.length === 0 ? (
                  <p className="studio-hint">
                    {w.noMatch(query.trim())}{" "}
                    <Link
                      href={href("/studio/tracks/new")}
                      className="studio-link"
                    >
                      {w.addTrack}
                    </Link>
                    .
                  </p>
                ) : (
                  <ul className="studio-memory-choices">
                    {matches.map((choice) => (
                      <li key={choice.trackId} className="studio-memory-song">
                        <span
                          className="studio-memory-thumb"
                          aria-hidden="true"
                        >
                          <Icon name="note" size={20} />
                        </span>
                        <span className="studio-memory-song-body">
                          <span className="studio-memory-choice-title">
                            {choice.title}
                          </span>
                          <span className="studio-memory-song-facts">
                            {recordingFacts(t, choice)}
                          </span>
                        </span>
                        <span className="studio-memory-song-controls">
                          <button
                            type="button"
                            className="studio-icon-button"
                            aria-label={w.add(
                              choice.title,
                              recordingFacts(t, choice),
                            )}
                            onClick={() => add(choice)}
                          >
                            <Icon name="plus" size={18} />
                          </button>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ) : null}
          </div>
          <p className="studio-hint">{w.removeHint}</p>
        </>
      )}

      {/* Two live regions, so a change to the list is said even while the
          search field holds a query. */}
      <p role="status" className="studio-sr-only">
        {announcement}
      </p>
      <p role="status" className="studio-sr-only">
        {query.trim()
          ? matches.length === MAX_MATCHES
            ? w.firstFound(MAX_MATCHES)
            : w.found(matches.length)
          : ""}
      </p>
    </section>
  );
}
