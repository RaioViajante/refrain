"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import {
  addTrackToAlbumAction,
  moveTrackInAlbumAction,
  removeTrackFromAlbumAction,
} from "@/app/studio/albums/actions";
import { ConfirmDialog, useSubmission } from "@/app/studio/form-kit";
import { formatDuration, parseDuration } from "@/app/studio/format";
import { failureMessage } from "@/app/studio/messages";
import type { ActionResult } from "@/app/studio/results";
import { createTrackAction } from "@/app/studio/tracks/actions";

export interface TracklistRow {
  trackId: string;
  title: string;
  lengthMs: number | null;
  artistNames: string;
  archived: boolean;
  hasReflection: boolean;
}

interface TracklistEditorProps {
  albumId: string;
  tracklist: TracklistRow[];
  /** Existing tracks that are not on this album yet. */
  addable: { value: string; label: string }[];
  /** The album's credited artists, offered as credits for a new track. */
  albumArtistIds: string[];
  /** Archived albums keep their tracklist as it is. */
  readOnly: boolean;
}

/**
 * The album's tracks in order. Each change is saved at once by a server
 * action, which rewrites the album's order in one transaction and refuses to
 * remove a track that writing refers to. A recording is never copied: adding
 * an existing track links it, and a new track is created once.
 */
export function TracklistEditor({
  albumId,
  tracklist,
  addable,
  albumArtistIds,
  readOnly,
}: TracklistEditorProps) {
  const router = useRouter();
  const { pending, failure, run, clearFailure } = useSubmission();
  const [message, setMessage] = useState("");
  const [existing, setExisting] = useState("");
  const [title, setTitle] = useState("");
  const [length, setLength] = useState("");
  const [creditAlbumArtists, setCreditAlbumArtists] = useState(true);
  const [lengthProblem, setLengthProblem] = useState<string | undefined>();
  const [removing, setRemoving] = useState<TracklistRow | undefined>();

  async function change(
    work: () => Promise<ActionResult<unknown>>,
    done: string,
  ): Promise<boolean> {
    setMessage("");
    const result = await run(work);
    if (result.ok) {
      setMessage(done);
      router.refresh();
    }
    return result.ok;
  }

  async function addExisting(event: FormEvent) {
    event.preventDefault();
    if (existing === "") {
      return;
    }
    if (
      await change(
        () => addTrackToAlbumAction(albumId, existing),
        "Added to the end of the tracklist.",
      )
    ) {
      setExisting("");
    }
  }

  async function createNew(event: FormEvent) {
    event.preventDefault();
    const lengthMs = parseDuration(length);
    if (lengthMs === undefined) {
      setLengthProblem("Write the length as minutes and seconds, like 3:42.");
      return;
    }
    setLengthProblem(undefined);
    if (
      await change(
        () =>
          createTrackAction({
            title,
            lengthMs,
            artistIds: creditAlbumArtists ? albumArtistIds : [],
            albumId,
          }),
        "Track created and added to the end of the tracklist.",
      )
    ) {
      setTitle("");
      setLength("");
    }
  }

  return (
    <div className="space-y-8">
      {tracklist.length === 0 ? (
        <p className="studio-hint">
          No tracks yet. Add ones you already have, or create the first one
          below.
        </p>
      ) : (
        <ol className="studio-list" aria-label="Tracklist">
          {tracklist.map((track, index) => (
            <li key={track.trackId} className="studio-row">
              <span
                className="studio-row-title"
                style={{ minWidth: "2ch", textAlign: "right" }}
              >
                {index + 1}.
              </span>
              <span className="studio-row-title" style={{ flex: "1 1 200px" }}>
                <Link href={`/studio/tracks/${track.trackId}`}>
                  {track.title}
                </Link>
              </span>
              <span className="studio-meta">
                {[
                  track.artistNames,
                  formatDuration(track.lengthMs),
                  track.archived ? "archived" : "",
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
              {readOnly ? null : (
                <span className="studio-actions" style={{ gap: 4 }}>
                  <button
                    type="button"
                    className="studio-button-quiet"
                    disabled={pending || index === 0}
                    aria-label={`Move “${track.title}” up`}
                    onClick={() =>
                      change(
                        () =>
                          moveTrackInAlbumAction(albumId, track.trackId, "up"),
                        `Moved “${track.title}” up.`,
                      )
                    }
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="studio-button-quiet"
                    disabled={pending || index === tracklist.length - 1}
                    aria-label={`Move “${track.title}” down`}
                    onClick={() =>
                      change(
                        () =>
                          moveTrackInAlbumAction(
                            albumId,
                            track.trackId,
                            "down",
                          ),
                        `Moved “${track.title}” down.`,
                      )
                    }
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    className="studio-button-quiet"
                    disabled={pending || track.hasReflection}
                    aria-label={`Remove “${track.title}” from this album`}
                    onClick={() => {
                      clearFailure();
                      setRemoving(track);
                    }}
                  >
                    Remove
                  </button>
                </span>
              )}
              {track.hasReflection ? (
                <span className="studio-hint" style={{ flexBasis: "100%" }}>
                  A reflection is written about this track, so it stays on the
                  album.
                </span>
              ) : null}
            </li>
          ))}
        </ol>
      )}

      <p
        role={failure ? "alert" : "status"}
        className={failure ? "studio-problem" : "studio-hint"}
        style={{ maxWidth: "62ch" }}
      >
        {failure ? failureMessage(failure) : message}
      </p>

      {readOnly ? null : (
        <div className="space-y-8">
          {addable.length > 0 ? (
            <form onSubmit={addExisting} className="space-y-3 max-w-[620px]">
              <label htmlFor="add-existing-track" className="studio-label">
                Add a track you already have
              </label>
              <div className="studio-actions">
                <select
                  id="add-existing-track"
                  className="studio-field"
                  style={{ flex: "1 1 260px", width: "auto" }}
                  value={existing}
                  onChange={(event) => setExisting(event.target.value)}
                >
                  <option value="">Choose a track</option>
                  {addable.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <button
                  type="submit"
                  className="studio-button"
                  disabled={pending || existing === ""}
                >
                  Add to album
                </button>
              </div>
            </form>
          ) : null}

          <form
            onSubmit={createNew}
            className="space-y-4 max-w-[620px]"
            noValidate
          >
            <p className="studio-label">Create a new track on this album</p>
            <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_140px]">
              <div className="studio-field-group">
                <label htmlFor="new-track-title" className="studio-hint">
                  Title
                </label>
                <input
                  id="new-track-title"
                  className="studio-field"
                  value={title}
                  maxLength={300}
                  autoComplete="off"
                  onChange={(event) => setTitle(event.target.value)}
                />
              </div>
              <div className="studio-field-group">
                <label htmlFor="new-track-length" className="studio-hint">
                  Length (3:42)
                </label>
                <input
                  id="new-track-length"
                  className="studio-field"
                  value={length}
                  maxLength={12}
                  autoComplete="off"
                  aria-invalid={lengthProblem ? true : undefined}
                  onChange={(event) => {
                    setLength(event.target.value);
                    setLengthProblem(undefined);
                  }}
                />
              </div>
            </div>
            {lengthProblem ? (
              <p className="studio-problem" role="alert">
                {lengthProblem}
              </p>
            ) : null}
            <label
              className="flex items-center gap-3"
              style={{ minHeight: 44 }}
            >
              <input
                type="checkbox"
                checked={creditAlbumArtists}
                onChange={(event) =>
                  setCreditAlbumArtists(event.target.checked)
                }
                style={{ width: 20, height: 20 }}
              />
              <span>Credit the album’s artists on this track</span>
            </label>
            <button
              type="submit"
              className="studio-button"
              disabled={pending || title.trim() === ""}
            >
              Create and add
            </button>
          </form>
        </div>
      )}

      <ConfirmDialog
        open={removing !== undefined}
        title="Remove this track from the album?"
        confirmLabel="Remove from album"
        pending={pending}
        onConfirm={async () => {
          const track = removing;
          if (!track) {
            return;
          }
          await change(
            () => removeTrackFromAlbumAction(albumId, track.trackId),
            `Removed “${track.title}” from this album.`,
          );
          setRemoving(undefined);
        }}
        onCancel={() => setRemoving(undefined)}
      >
        <p>
          “{removing?.title}” stays in your catalog and on any other album. Only
          its place on this tracklist goes.
        </p>
      </ConfirmDialog>
    </div>
  );
}
