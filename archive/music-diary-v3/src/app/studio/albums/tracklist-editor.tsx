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
import { useStudio } from "@/app/studio/studio-locale";
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
  const { words, href } = useStudio();
  const w = words.tracklist;
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
    if (await change(() => addTrackToAlbumAction(albumId, existing), w.added)) {
      setExisting("");
    }
  }

  async function createNew(event: FormEvent) {
    event.preventDefault();
    const lengthMs = parseDuration(length);
    if (lengthMs === undefined) {
      setLengthProblem(w.lengthProblem);
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
        w.created,
      )
    ) {
      setTitle("");
      setLength("");
    }
  }

  return (
    <div className="space-y-8">
      {tracklist.length === 0 ? (
        <p className="studio-hint">{w.empty}</p>
      ) : (
        <ol className="studio-list" aria-label={w.label}>
          {tracklist.map((track, index) => (
            <li key={track.trackId} className="studio-row">
              <span
                className="studio-row-title"
                style={{ minWidth: "2ch", textAlign: "right" }}
              >
                {index + 1}.
              </span>
              <span className="studio-row-title" style={{ flex: "1 1 200px" }}>
                <Link href={href(`/studio/tracks/${track.trackId}`)}>
                  {track.title}
                </Link>
              </span>
              <span className="studio-meta">
                {[
                  track.artistNames,
                  formatDuration(track.lengthMs),
                  track.archived ? w.archived : "",
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
                    aria-label={w.moveUp(track.title)}
                    onClick={() =>
                      change(
                        () =>
                          moveTrackInAlbumAction(albumId, track.trackId, "up"),
                        w.movedUp(track.title),
                      )
                    }
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="studio-button-quiet"
                    disabled={pending || index === tracklist.length - 1}
                    aria-label={w.moveDown(track.title)}
                    onClick={() =>
                      change(
                        () =>
                          moveTrackInAlbumAction(
                            albumId,
                            track.trackId,
                            "down",
                          ),
                        w.movedDown(track.title),
                      )
                    }
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    className="studio-button-quiet"
                    disabled={pending || track.hasReflection}
                    aria-label={w.removeLabel(track.title)}
                    onClick={() => {
                      clearFailure();
                      setRemoving(track);
                    }}
                  >
                    {w.remove}
                  </button>
                </span>
              )}
              {track.hasReflection ? (
                <span className="studio-hint" style={{ flexBasis: "100%" }}>
                  {w.hasReflection}
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
        {failure ? failureMessage(words, failure) : message}
      </p>

      {readOnly ? null : (
        <div className="space-y-8">
          {addable.length > 0 ? (
            <form onSubmit={addExisting} className="space-y-3 max-w-[620px]">
              <label htmlFor="add-existing-track" className="studio-label">
                {w.addExisting}
              </label>
              <div className="studio-actions">
                <select
                  id="add-existing-track"
                  className="studio-field"
                  style={{
                    flex: "1 1 260px",
                    width: "auto",
                    // The longest option must not widen the page: on a phone
                    // the select shrinks to the screen instead.
                    minWidth: 0,
                    maxWidth: "100%",
                  }}
                  value={existing}
                  onChange={(event) => setExisting(event.target.value)}
                >
                  <option value="">{w.chooseTrack}</option>
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
                  {w.addToAlbum}
                </button>
              </div>
            </form>
          ) : null}

          <form
            onSubmit={createNew}
            className="space-y-4 max-w-[620px]"
            noValidate
          >
            <p className="studio-label">{w.createTitle}</p>
            <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_140px]">
              <div className="studio-field-group">
                <label htmlFor="new-track-title" className="studio-hint">
                  {w.title}
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
                  {w.length}
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
              <span>{w.creditAlbumArtists}</span>
            </label>
            <button
              type="submit"
              className="studio-button"
              disabled={pending || title.trim() === ""}
            >
              {w.createAndAdd}
            </button>
          </form>
        </div>
      )}

      <ConfirmDialog
        open={removing !== undefined}
        title={w.removeQuestion}
        confirmLabel={w.removeConfirm}
        pending={pending}
        onConfirm={async () => {
          const track = removing;
          if (!track) {
            return;
          }
          await change(
            () => removeTrackFromAlbumAction(albumId, track.trackId),
            w.removed(track.title),
          );
          setRemoving(undefined);
        }}
        onCancel={() => setRemoving(undefined)}
      >
        <p>{w.removeBody(removing?.title ?? "")}</p>
      </ConfirmDialog>
    </div>
  );
}
