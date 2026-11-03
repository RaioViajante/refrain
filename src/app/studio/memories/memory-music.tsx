"use client";

import Link from "next/link";
import { useEffect, useId, useMemo, useRef, useState } from "react";

import { Icon } from "@/app/studio/icons";
import {
  matchRecordings,
  moveRecording,
  recordingFacts,
  type Recording,
} from "@/app/studio/memories/recordings";

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
      `${recording.title} moved ${direction}, to ${place} of ${recordings.length}.`,
    );
    pendingFocus.current = { trackId: recording.trackId, control: direction };
  }

  function remove(index: number) {
    const recording = recordings[index]!;
    onChange(recordings.filter((_, at) => at !== index));
    setAnnouncement(
      `${recording.title} removed from this memory. It is still in your catalog.`,
    );
    pendingFocus.current = { control: "search" };
  }

  function add(recording: Recording) {
    onChange([...recordings, recording]);
    setQuery("");
    setAnnouncement(`${recording.title} added to this memory.`);
    pendingFocus.current = { control: "search" };
  }

  return (
    <section aria-labelledby={headingId} className="studio-memory-music">
      <h2 id={headingId} className="studio-label">
        The music
      </h2>

      {recordings.length === 0 && albumLinks.length === 0 ? (
        <p className="studio-hint">
          No songs yet. Add the songs this memory belongs to; they come from
          your catalog.
        </p>
      ) : (
        <ol className="studio-memory-songs" aria-label="Songs in this memory">
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
                  {recordingFacts(recording)}
                </span>
              </span>
              {readOnly ? null : (
                <span className="studio-memory-song-controls">
                  <button
                    type="button"
                    ref={register(`${recording.trackId}:up`)}
                    className="studio-icon-button"
                    aria-label={`Move ${recording.title} up (song ${index + 1} of ${recordings.length})`}
                    disabled={index === 0}
                    onClick={() => move(index, "up")}
                  >
                    <Icon name="up" size={18} />
                  </button>
                  <button
                    type="button"
                    ref={register(`${recording.trackId}:down`)}
                    className="studio-icon-button"
                    aria-label={`Move ${recording.title} down (song ${index + 1} of ${recordings.length})`}
                    disabled={index === recordings.length - 1}
                    onClick={() => move(index, "down")}
                  >
                    <Icon name="down" size={18} />
                  </button>
                  <button
                    type="button"
                    ref={register(`${recording.trackId}:remove`)}
                    className="studio-icon-button"
                    aria-label={`Remove ${recording.title} from this memory (song ${index + 1} of ${recordings.length})`}
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
                <span className="studio-memory-song-facts">Album</span>
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
        <p className="studio-hint">
          This memory also belongs to an album, which this editor can’t change
          yet, so its music stays as it is. Its title and writing can still be
          saved.
        </p>
      ) : (
        <>
          <div className="studio-memory-add">
            <label htmlFor={searchId} className="studio-sr-only">
              Add a song from your catalog
            </label>
            <span className="studio-memory-add-field">
              <Icon name="plus" size={18} />
              <input
                id={searchId}
                ref={search}
                type="search"
                className="studio-field"
                placeholder="Add a song"
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
                aria-label="Songs in your catalog"
              >
                <p className="studio-memory-results-label">In your catalog</p>
                {matches.length === 0 ? (
                  <p className="studio-hint">
                    No song in your catalog matches “{query.trim()}”.{" "}
                    <Link href="/studio/tracks/new" className="studio-link">
                      Add a track to your catalog
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
                            {recordingFacts(choice)}
                          </span>
                        </span>
                        <span className="studio-memory-song-controls">
                          <button
                            type="button"
                            className="studio-icon-button"
                            aria-label={`Add ${choice.title}, ${recordingFacts(choice)}, to this memory`}
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
          <p className="studio-hint">
            Removing a song from this memory never deletes it from your catalog.
          </p>
        </>
      )}

      <p role="status" className="studio-sr-only">
        {query.trim()
          ? `${matches.length} ${matches.length === 1 ? "song" : "songs"} found.`
          : announcement}
      </p>
    </section>
  );
}
