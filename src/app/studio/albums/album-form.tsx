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
      setYearProblem("Write the year with four digits, like 1994.");
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
      router.push(`/studio/albums/${result.data.id}`);
    }
  }

  if (artistOptions.length === 0 && values.credits.every((c) => !c.artistId)) {
    return (
      <div className="studio-panel">
        <p className="studio-section-title">Add an artist first</p>
        <p>An album is credited to at least one artist or band.</p>
        <p>
          <Link href="/studio/artists/new" className="studio-button">
            Add an artist
          </Link>
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={save} className="space-y-6 max-w-[700px]" noValidate>
      <TextField
        label="Title"
        value={values.title}
        onChange={(value) => change("title", value)}
        required
        maxLength={300}
        hint="Titles don’t have to be unique: two albums can share a name."
        problem={problemWith(failure, "title")}
      />
      <ArtistRows
        legend="Credited artists"
        rows={values.credits}
        onChange={(rows) => change("credits", rows)}
        options={artistOptions}
        minimum={1}
        withCreditedAs
        problem={
          problemWith(failure, "credits") ??
          Object.keys(failure?.fields ?? {})
            .filter((field) => field.startsWith("credits."))
            .map(() => "Choose an artist for each row, and no artist twice.")[0]
        }
      />
      <TextField
        label="First released (optional)"
        value={values.year}
        onChange={(value) => change("year", value)}
        inputMode="numeric"
        maxLength={4}
        width="140px"
        problem={yearProblem ?? problemWith(failure, "firstReleaseYear")}
      />
      <fieldset className="space-y-6 border-0 p-0 mx-0 mt-0 min-w-0">
        <legend className="studio-label mb-1">Reference edition</legend>
        <p className="studio-hint">
          The release that sets the order of the tracks. Everything here is
          optional.
        </p>
        <TextField
          label="Label"
          value={values.label}
          onChange={(value) => change("label", value)}
          maxLength={200}
          problem={problemWith(failure, "edition.label")}
        />
        <div className="grid gap-6 sm:grid-cols-2">
          <TextField
            label="Release date"
            type="date"
            value={values.releaseDate}
            onChange={(value) => change("releaseDate", value)}
            problem={problemWith(failure, "edition.releaseDate")}
          />
          <TextField
            label="Country (two letters)"
            value={values.country}
            onChange={(value) => change("country", value.toUpperCase())}
            maxLength={2}
            width="120px"
            problem={problemWith(failure, "edition.country")}
          />
        </div>
      </fieldset>
      <TextField
        label="MusicBrainz release group ID (optional)"
        value={values.mbReleaseGroupId}
        onChange={(value) => change("mbReleaseGroupId", value)}
        maxLength={36}
        hint="Filled in when you add or link this album from Add music. Saving this form looks nothing up."
        problem={problemWith(failure, "mbReleaseGroupId")}
      />
      <div className="studio-actions">
        <button
          type="submit"
          className="studio-button studio-button-primary"
          disabled={pending}
        >
          {albumId ? "Save album" : "Add album"}
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
