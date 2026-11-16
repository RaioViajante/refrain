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
import { CatalogChangeDialog } from "@/app/studio/catalog/catalog-change-dialog";
import { problemWith } from "@/app/studio/messages";
import { useStudio } from "@/app/studio/studio-locale";
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
  const { words, href } = useStudio();
  const w = words.trackForm;
  const [values, setValues] = useState(initial);
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);
  const [lengthProblem, setLengthProblem] = useState<string | undefined>();
  const { pending, failure, run, clearFailure, report } = useSubmission();
  // ADR 0013 step 3: the edit waiting for the author's review, when it would
  // change a published page.
  const [reviewing, setReviewing] = useState<
    Record<string, unknown> | undefined
  >();
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
      setLengthProblem(words.tracklist.lengthProblem);
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
      } else if (result.code === "confirmation_required") {
        // A published page shows this record: the review dialog asks first.
        clearFailure();
        setReviewing({ ...fields });
      }
      return;
    }
    const result = await run(() =>
      createTrackAction({ ...fields, albumId: values.albumId || null }),
    );
    if (result.ok) {
      setDirty(false);
      setSaved(true);
      router.push(href(`/studio/tracks/${result.data.id}`));
    }
  }

  return (
    <form onSubmit={save} className="space-y-6 max-w-[620px]" noValidate>
      <TextField
        label={w.title}
        value={values.title}
        onChange={(value) => change("title", value)}
        required
        maxLength={300}
        problem={problemWith(words, failure, "title")}
      />
      <TextField
        label={w.length}
        value={values.length}
        onChange={(value) => change("length", value)}
        maxLength={12}
        width="160px"
        hint={w.lengthHint}
        problem={lengthProblem ?? problemWith(words, failure, "lengthMs")}
      />
      <ArtistRows
        legend={w.credits}
        rows={values.artists}
        onChange={(rows) => change("artists", rows)}
        options={artistOptions}
        minimum={0}
        problem={problemWith(words, failure, "artistIds")}
        emptyHint={w.noCredits}
      />
      <TextField
        label={w.creditNote}
        value={values.credit}
        onChange={(value) => change("credit", value)}
        maxLength={300}
        hint={w.creditNoteHint}
        problem={problemWith(words, failure, "credit")}
      />
      <TextField
        label={w.mbRecordingId}
        value={values.mbRecordingId}
        onChange={(value) => change("mbRecordingId", value)}
        maxLength={36}
        problem={problemWith(words, failure, "mbRecordingId")}
      />
      {albumOptions ? (
        <SelectField
          label={w.album}
          value={values.albumId}
          onChange={(value) => change("albumId", value)}
          options={albumOptions}
          placeholder={w.albumPlaceholder}
          hint={w.albumHint}
          problem={problemWith(words, failure, "albumId")}
        />
      ) : null}
      <div className="studio-actions">
        <button
          type="submit"
          className="studio-button studio-button-primary"
          disabled={pending}
        >
          {trackId ? w.save : w.add}
        </button>
        <FormStatus
          pending={pending}
          failure={failure}
          saved={saved}
          dirty={dirty}
        />
      </div>
      {trackId ? (
        <CatalogChangeDialog
          kind="track"
          recordId={trackId}
          payload={reviewing}
          onSaved={() => {
            setReviewing(undefined);
            setDirty(false);
            setSaved(true);
            router.refresh();
          }}
          onNothingToConfirm={() => {
            setReviewing(undefined);
            void run(() => updateTrackAction(trackId, reviewing)).then(
              (result) => {
                if (result.ok) {
                  setDirty(false);
                  setSaved(true);
                  router.refresh();
                }
              },
            );
          }}
          onRefused={(refused) => {
            setReviewing(undefined);
            report(refused);
          }}
          onCancel={() => setReviewing(undefined)}
        />
      ) : null}
    </form>
  );
}
