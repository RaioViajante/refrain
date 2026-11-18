"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import {
  createAlbumAction,
  updateAlbumAction,
} from "@/app/studio/albums/actions";
import { type AlbumValues, emptyAlbum } from "@/app/studio/albums/album-values";
import { ArtistRows } from "@/app/studio/artist-rows";
import {
  FormStatus,
  TextField,
  useSubmission,
  useUnsavedGuard,
} from "@/app/studio/form-kit";
import { problemWith } from "@/app/studio/messages";
import { useStudio } from "@/app/studio/studio-locale";

export function AlbumForm({
  albumId,
  initial = emptyAlbum,
  artistOptions,
}: {
  /** Present when editing an existing album. */
  albumId?: string;
  initial?: AlbumValues;
  artistOptions: { value: string; label: string }[];
}) {
  const router = useRouter();
  const { words, href } = useStudio();
  const w = words.albumForm;
  const [values, setValues] = useState(initial);
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);
  const [yearProblem, setYearProblem] = useState<string | undefined>();
  const { pending, failure, run } = useSubmission();
  useUnsavedGuard(dirty);

  function change<Field extends keyof AlbumValues>(
    field: Field,
    value: AlbumValues[Field],
  ) {
    setValues((current) => ({ ...current, [field]: value }));
    setDirty(true);
    setSaved(false);
    if (field === "year") {
      setYearProblem(undefined);
    }
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    const year = values.year.trim();
    if (year !== "" && !/^\d{4}$/.test(year)) {
      setYearProblem(w.yearProblem);
      return;
    }
    const payload = {
      title: values.title,
      firstReleaseYear: year === "" ? null : Number(year),
      mbReleaseGroupId: values.mbReleaseGroupId,
      // A row left on "Choose an artist" is not a credit.
      credits: values.credits
        .filter((row) => row.artistId !== "")
        .map((row) => ({ artistId: row.artistId, creditedAs: row.creditedAs })),
      edition: {
        label: values.label,
        releaseDate: values.releaseDate,
        country: values.country,
      },
    };

    if (albumId) {
      const result = await run(() => updateAlbumAction(albumId, payload));
      if (result.ok) {
        setDirty(false);
        setSaved(true);
        router.refresh();
      }
      return;
    }
    const result = await run(() => createAlbumAction(payload));
    if (result.ok) {
      setDirty(false);
      setSaved(true);
      router.push(href(`/studio/albums/${result.data.id}`));
    }
  }

  if (artistOptions.length === 0 && values.credits.every((c) => !c.artistId)) {
    return (
      <div className="studio-panel">
        <p className="studio-section-title">{w.artistFirst}</p>
        <p>{w.artistFirstBody}</p>
        <p>
          <Link href={href("/studio/artists/new")} className="studio-button">
            {words.artists.add}
          </Link>
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={save} className="space-y-6 max-w-[700px]" noValidate>
      <TextField
        label={w.title}
        value={values.title}
        onChange={(value) => change("title", value)}
        required
        maxLength={300}
        hint={w.titleHint}
        problem={problemWith(words, failure, "title")}
      />
      <ArtistRows
        legend={w.credits}
        rows={values.credits}
        onChange={(rows) => change("credits", rows)}
        options={artistOptions}
        minimum={1}
        withCreditedAs
        problem={
          problemWith(words, failure, "credits") ??
          Object.keys(failure?.fields ?? {})
            .filter((field) => field.startsWith("credits."))
            .map(() => w.creditsProblem)[0]
        }
      />
      <TextField
        label={w.year}
        value={values.year}
        onChange={(value) => change("year", value)}
        inputMode="numeric"
        maxLength={4}
        width="140px"
        problem={yearProblem ?? problemWith(words, failure, "firstReleaseYear")}
      />
      <fieldset className="space-y-6 border-0 p-0 mx-0 mt-0 min-w-0">
        <legend className="studio-label mb-1">{w.edition}</legend>
        <p className="studio-hint">{w.editionHint}</p>
        <TextField
          label={w.label}
          value={values.label}
          onChange={(value) => change("label", value)}
          maxLength={200}
          problem={problemWith(words, failure, "edition.label")}
        />
        <div className="grid gap-6 sm:grid-cols-2">
          <TextField
            label={w.releaseDate}
            type="date"
            value={values.releaseDate}
            onChange={(value) => change("releaseDate", value)}
            problem={problemWith(words, failure, "edition.releaseDate")}
          />
          <TextField
            label={w.country}
            value={values.country}
            onChange={(value) => change("country", value.toUpperCase())}
            maxLength={2}
            width="120px"
            problem={problemWith(words, failure, "edition.country")}
          />
        </div>
      </fieldset>
      <TextField
        label={w.mbReleaseGroupId}
        value={values.mbReleaseGroupId}
        onChange={(value) => change("mbReleaseGroupId", value)}
        maxLength={36}
        hint={w.mbReleaseGroupIdHint}
        problem={problemWith(words, failure, "mbReleaseGroupId")}
      />
      <div className="studio-actions">
        <button
          type="submit"
          className="studio-button studio-button-primary"
          disabled={pending}
        >
          {albumId ? w.save : w.add}
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
