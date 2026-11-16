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
import { CatalogChangeDialog } from "@/app/studio/catalog/catalog-change-dialog";
import { problemWith } from "@/app/studio/messages";
import { useStudio } from "@/app/studio/studio-locale";

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
  const { words, href } = useStudio();
  const w = words.artistForm;
  const [values, setValues] = useState(initial);
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);
  const { pending, failure, run, clearFailure, report } = useSubmission();
  // ADR 0013 step 3: the edit waiting for the author's review, when it would
  // change a published page.
  const [reviewing, setReviewing] = useState<
    Record<string, unknown> | undefined
  >();
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
      } else if (result.code === "confirmation_required") {
        // A published page shows this record: the review dialog asks first.
        clearFailure();
        setReviewing({ ...values });
      }
      return;
    }
    const result = await run(() => createArtistAction(values));
    if (result.ok) {
      setDirty(false);
      setSaved(true);
      router.push(href(`/studio/artists/${result.data.id}`));
    }
  }

  return (
    <form onSubmit={save} className="space-y-6 max-w-[560px]" noValidate>
      <TextField
        label={w.name}
        value={values.name}
        onChange={(value) => change("name", value)}
        required
        maxLength={200}
        problem={problemWith(words, failure, "name")}
      />
      <SelectField
        label={w.kind}
        value={values.kind}
        onChange={(value) => change("kind", value as ArtistValues["kind"])}
        options={[
          { value: "person", label: w.person },
          { value: "group", label: w.group },
        ]}
        problem={problemWith(words, failure, "kind")}
      />
      <TextField
        label={w.sortName}
        value={values.sortName}
        onChange={(value) => change("sortName", value)}
        maxLength={200}
        hint={w.sortNameHint}
        problem={problemWith(words, failure, "sortName")}
      />
      <TextField
        label={w.mbArtistId}
        value={values.mbArtistId}
        onChange={(value) => change("mbArtistId", value)}
        maxLength={36}
        hint={w.mbArtistIdHint}
        problem={problemWith(words, failure, "mbArtistId")}
      />
      <div className="studio-actions">
        <button
          type="submit"
          className="studio-button studio-button-primary"
          disabled={pending}
        >
          {artistId ? w.save : w.add}
        </button>
        <FormStatus
          pending={pending}
          failure={failure}
          saved={saved}
          dirty={dirty}
        />
      </div>
      {artistId ? (
        <CatalogChangeDialog
          kind="artist"
          recordId={artistId}
          payload={reviewing}
          onSaved={() => {
            setReviewing(undefined);
            setDirty(false);
            setSaved(true);
            router.refresh();
          }}
          onNothingToConfirm={() => {
            setReviewing(undefined);
            void run(() => updateArtistAction(artistId, reviewing)).then(
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
