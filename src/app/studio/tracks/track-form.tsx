"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { ArtistRows } from "@/app/studio/artist-rows";
import {
  FormStatus,
  SelectField,
  TextField,
  useSubmission,
  useUnsavedGuard,
} from "@/app/studio/form-kit";
import { parseDuration } from "@/app/studio/format";
import { problemWith } from "@/app/studio/messages";
import {
  createTrackAction,
  updateTrackAction,
} from "@/app/studio/tracks/actions";
import type { TrackValues } from "@/app/studio/tracks/track-values";

export function TrackForm({
  trackId,
  initial,
  artistOptions,
  albumOptions,
}: {
  /** Present when editing an existing track. */
  trackId?: string;
  initial: TrackValues;
  artistOptions: { value: string; label: string }[];
  /** Albums a new track can be added to. Omitted when editing. */
  albumOptions?: { value: string; label: string }[];
}) {
  const router = useRouter();
  const [values, setValues] = useState(initial);
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);
  const [lengthProblem, setLengthProblem] = useState<string | undefined>();
  const { pending, failure, run } = useSubmission();
  useUnsavedGuard(dirty);

  function change<Field extends keyof TrackValues>(
    field: Field,
    value: TrackValues[Field],
  ) {
    setValues((current) => ({ ...current, [field]: value }));
    setDirty(true);
    setSaved(false);
    if (field === "length") {
      setLengthProblem(undefined);
    }
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    const lengthMs = parseDuration(values.length);
    if (lengthMs === undefined) {
      setLengthProblem("Write the length as minutes and seconds, like 3:42.");
      return;
    }
    const fields = {
      title: values.title,
      lengthMs,
      credit: values.credit,
      mbRecordingId: values.mbRecordingId,
      // A row left on "Choose an artist" is not a credit.
      artistIds: values.artists
        .map((row) => row.artistId)
        .filter((artistId) => artistId !== ""),
    };

    if (trackId) {
      const result = await run(() => updateTrackAction(trackId, fields));
      if (result.ok) {
        setDirty(false);
        setSaved(true);
        router.refresh();
      }
      return;
    }
    const result = await run(() =>
      createTrackAction({ ...fields, albumId: values.albumId || null }),
    );
    if (result.ok) {
      setDirty(false);
      setSaved(true);
      router.push(`/studio/tracks/${result.data.id}`);
    }
  }

  return (
    <form onSubmit={save} className="space-y-6 max-w-[620px]" noValidate>
      <TextField
        label="Title"
        value={values.title}
        onChange={(value) => change("title", value)}
        required
        maxLength={300}
        problem={problemWith(failure, "title")}
      />
      <TextField
        label="Length (optional)"
        value={values.length}
        onChange={(value) => change("length", value)}
        maxLength={12}
        width="160px"
        hint="Minutes and seconds, like 3:42."
        problem={lengthProblem ?? problemWith(failure, "lengthMs")}
      />
      <ArtistRows
        legend="Credited artists (optional)"
        rows={values.artists}
        onChange={(rows) => change("artists", rows)}
        options={artistOptions}
        minimum={0}
        problem={problemWith(failure, "artistIds")}
        emptyHint="No artist is credited. A track can stand on its own."
      />
      <TextField
        label="Credit note (optional)"
        value={values.credit}
        onChange={(value) => change("credit", value)}
        maxLength={300}
        hint="Anything the credits say that an artist link doesn’t, like “feat. someone”."
        problem={problemWith(failure, "credit")}
      />
      <TextField
        label="MusicBrainz recording ID (optional)"
        value={values.mbRecordingId}
        onChange={(value) => change("mbRecordingId", value)}
        maxLength={36}
        problem={problemWith(failure, "mbRecordingId")}
      />
      {albumOptions ? (
        <SelectField
          label="Add to an album (optional)"
          value={values.albumId}
          onChange={(value) => change("albumId", value)}
          options={albumOptions}
          placeholder="Not on an album yet"
          hint="It goes at the end of the album’s tracklist. A track can be on several albums; add the others from the album page."
          problem={problemWith(failure, "albumId")}
        />
      ) : null}
      <div className="studio-actions">
        <button
          type="submit"
          className="studio-button studio-button-primary"
          disabled={pending}
        >
          {trackId ? "Save track" : "Add track"}
        </button>
        <FormStatus
          pending={pending}
          failure={failure}
          saved={saved}
          dirty={dirty}
        />
      </div>
    </form>
  );
}
