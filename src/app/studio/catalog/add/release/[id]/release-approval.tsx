"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import {
  importMusicReleaseAction,
  linkAlbumToMusicAction,
} from "@/app/studio/catalog/add/actions";
import { ArtworkPlaceholder } from "@/app/studio/artwork-placeholder";
import { ConfirmDialog, useSubmission } from "@/app/studio/form-kit";
import { failureMessage } from "@/app/studio/messages";
import { useStudio } from "@/app/studio/studio-locale";

// The author's explicit approval of a reviewed release (M3.2). Nothing is
// written until "Add to catalog" is pressed, and what is sent is only the
// release, the fingerprint of the review the author is looking at, and the
// cover they chose, if any. No cover is chosen by default.

interface Choice {
  imageId: string;
  src: string;
  srcSet: string;
}

export function ReleaseApproval({
  releaseId,
  review,
  title,
  choices,
  artworkUnavailable,
}: {
  releaseId: string;
  review: string;
  title: string;
  choices: Choice[];
  artworkUnavailable: boolean;
}) {
  const router = useRouter();
  const { locale, words, href } = useStudio();
  const w = words.releaseApproval;
  const { pending, failure, run } = useSubmission();
  const [cover, setCover] = useState<string>("");

  async function approve() {
    const result = await run(() =>
      importMusicReleaseAction({
        releaseId,
        review,
        coverImageId: cover || null,
      }),
    );
    if (result.ok) {
      router.push(href(`/studio/albums/${result.data.id}`));
    }
  }

  return (
    <>
      <section aria-labelledby="review-artwork" className="space-y-2">
        <h2 id="review-artwork" className="studio-section-title">
          {w.artwork}
        </h2>
        {artworkUnavailable ? (
          <p className="studio-hint" role="status">
            {w.artworkUnavailable}
          </p>
        ) : choices.length === 0 ? (
          <p className="studio-hint">{w.noFrontCover}</p>
        ) : (
          <fieldset className="studio-choice-group space-y-2">
            <legend className="studio-hint">{w.chooseCover}</legend>
            <ul className="studio-choices">
              <li className="studio-choice">
                <ArtworkPlaceholder locale={locale} />
                <label>
                  <input
                    type="radio"
                    name="cover"
                    value=""
                    checked={cover === ""}
                    onChange={() => setCover("")}
                  />
                  {w.noArtwork}
                </label>
              </li>
              {choices.map((choice, index) => (
                <li key={choice.imageId} className="studio-choice">
                  <ArtworkPlaceholder
                    locale={locale}
                    artwork={choice}
                    title={words.artworkPage.frontCoverOf(title, index + 1)}
                    size={220}
                  />
                  <label>
                    <input
                      type="radio"
                      name="cover"
                      value={choice.imageId}
                      checked={cover === choice.imageId}
                      onChange={() => setCover(choice.imageId)}
                    />
                    {w.frontCover(index + 1)}
                  </label>
                </li>
              ))}
            </ul>
          </fieldset>
        )}
      </section>

      <div className="space-y-2">
        <div className="studio-actions">
          <button
            type="button"
            className="studio-button studio-button-primary"
            disabled={pending}
            onClick={approve}
          >
            {pending ? w.adding : w.add}
          </button>
        </div>
        <p
          role={failure ? "alert" : "status"}
          className={failure ? "studio-problem" : "studio-hint"}
          style={{ maxWidth: "62ch" }}
        >
          {failure ? failureMessage(words, failure) : w.addHint}
        </p>
      </div>
    </>
  );
}

/** Links an album already in the catalog to the reviewed release, after asking. */
export function LinkAlbumButton({
  albumId,
  albumTitle,
  releaseId,
  review,
}: {
  albumId: string;
  albumTitle: string;
  releaseId: string;
  review: string;
}) {
  const router = useRouter();
  const { words, href } = useStudio();
  const w = words.releaseApproval;
  const { pending, failure, run, clearFailure } = useSubmission();
  const [asking, setAsking] = useState(false);

  async function link() {
    const result = await run(() =>
      linkAlbumToMusicAction({ albumId, releaseId, review }),
    );
    setAsking(false);
    if (result.ok) {
      router.push(href(`/studio/albums/${albumId}`));
    }
  }

  return (
    <>
      <button
        type="button"
        className="studio-button"
        disabled={pending}
        onClick={() => {
          clearFailure();
          setAsking(true);
        }}
      >
        {w.link}
        <span className="studio-sr-only">{`: ${albumTitle}`}</span>
      </button>
      {failure ? (
        <p role="alert" className="studio-problem">
          {failureMessage(words, failure)}
        </p>
      ) : null}
      <ConfirmDialog
        open={asking}
        title={w.linkQuestion(albumTitle)}
        confirmLabel={w.linkConfirm}
        pending={pending}
        onConfirm={link}
        onCancel={() => setAsking(false)}
      >
        <p>{w.linkBody}</p>
      </ConfirmDialog>
    </>
  );
}
