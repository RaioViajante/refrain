"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import {
  createArtistAction,
  updateArtistAction,
} from "@/app/studio/artists/actions";
import {
  FormStatus,
  SelectField,
  TextField,
  useSubmission,
  useUnsavedGuard,
} from "@/app/studio/form-kit";
import { problemWith } from "@/app/studio/messages";

interface ArtistValues {
  name: string;
  sortName: string;
  kind: "person" | "group";
  mbArtistId: string;
}

export const emptyArtist: ArtistValues = {
  name: "",
  sortName: "",
  kind: "person",
  mbArtistId: "",
};

export function ArtistForm({
  artistId,
  initial = emptyArtist,
}: {
  /** Present when editing an existing artist. */
  artistId?: string;
  initial?: ArtistValues;
}) {
  const router = useRouter();
  const [values, setValues] = useState(initial);
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);
  const { pending, failure, run } = useSubmission();
  useUnsavedGuard(dirty);

  function change<Field extends keyof ArtistValues>(
    field: Field,
    value: ArtistValues[Field],
  ) {
    setValues((current) => ({ ...current, [field]: value }));
    setDirty(true);
    setSaved(false);
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (artistId) {
      const result = await run(() => updateArtistAction(artistId, values));
      if (result.ok) {
        setDirty(false);
        setSaved(true);
        router.refresh();
      }
      return;
    }
    const result = await run(() => createArtistAction(values));
    if (result.ok) {
      setDirty(false);
      setSaved(true);
      router.push(`/studio/artists/${result.data.id}`);
    }
  }

  return (
    <form onSubmit={save} className="space-y-6 max-w-[560px]" noValidate>
      <TextField
        label="Name"
        value={values.name}
        onChange={(value) => change("name", value)}
        required
        maxLength={200}
        problem={problemWith(failure, "name")}
      />
      <SelectField
        label="Person or band"
        value={values.kind}
        onChange={(value) => change("kind", value as ArtistValues["kind"])}
        options={[
          { value: "person", label: "A person" },
          { value: "group", label: "A band or group" },
        ]}
        problem={problemWith(failure, "kind")}
      />
      <TextField
        label="Sort name (optional)"
        value={values.sortName}
        onChange={(value) => change("sortName", value)}
        maxLength={200}
        hint="How to file the name in lists, for example “Buckley, Jeff”."
        problem={problemWith(failure, "sortName")}
      />
      <TextField
        label="MusicBrainz artist ID (optional)"
        value={values.mbArtistId}
        onChange={(value) => change("mbArtistId", value)}
        maxLength={36}
        hint="Kept for later, when MusicBrainz search arrives. Nothing is looked up."
        problem={problemWith(failure, "mbArtistId")}
      />
      <div className="studio-actions">
        <button
          type="submit"
          className="studio-button studio-button-primary"
          disabled={pending}
        >
          {artistId ? "Save artist" : "Add artist"}
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
