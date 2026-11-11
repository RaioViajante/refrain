"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import {
  removeAlbumArtworkAction,
  setAlbumArtworkAction,
} from "@/app/studio/albums/actions";
import { ArtworkPlaceholder } from "@/app/studio/artwork-placeholder";
import { ConfirmDialog, useSubmission } from "@/app/studio/form-kit";
import { failureMessage } from "@/app/studio/messages";
import { useStudio } from "@/app/studio/studio-locale";

// Choosing an album's cover (M3.2). Each action sends the artwork the author
// is looking at (`expectedCoverUrl`), so a change made elsewhere meanwhile is
// never silently replaced: the server refuses and the page asks to look again.

interface Choice {
  releaseId: string;
  imageId: string;
  src: string;
  srcSet: string;
  current: boolean;
}

export function ArtworkChooser({
  albumId,
  title,
  currentCoverUrl,
  hasArtwork,
  fromReleaseGroup,
  choices,
}: {
  albumId: string;
  title: string;
  currentCoverUrl: string | null;
  hasArtwork: boolean;
  fromReleaseGroup: boolean;
  choices: Choice[];
}) {
  const router = useRouter();
  const { locale, words } = useStudio();
  const w = words.artworkPage;
  const { pending, failure, run, clearFailure } = useSubmission();
  const [removing, setRemoving] = useState(false);

  async function choose(choice: Choice) {
    const result = await run(() =>
      setAlbumArtworkAction({
        albumId,
        releaseId: choice.releaseId,
        imageId: choice.imageId,
        expectedCoverUrl: currentCoverUrl,
      }),
    );
    if (result.ok) {
      router.refresh();
    }
  }

  async function remove() {
    const result = await run(() =>
      removeAlbumArtworkAction({ albumId, expectedCoverUrl: currentCoverUrl }),
    );
    setRemoving(false);
    if (result.ok) {
      router.refresh();
    }
  }

  return (
    <section aria-labelledby="artwork-choices" className="space-y-3">
      <h2 id="artwork-choices" className="studio-section-title">
        {w.frontCovers}
      </h2>
      {choices.length === 0 ? (
        <p className="studio-hint">{w.noFrontCover}</p>
      ) : (
        <>
          {fromReleaseGroup ? (
            <p className="studio-hint" style={{ maxWidth: "62ch" }}>
              {w.fromReleaseGroup}
            </p>
          ) : null}
          <ul className="studio-choices">
            {choices.map((choice, index) => (
              <li
                key={`${choice.releaseId}/${choice.imageId}`}
                className="studio-choice"
              >
                <ArtworkPlaceholder
                  locale={locale}
                  artwork={choice}
                  title={w.frontCoverOf(title, index + 1)}
                  size={220}
                />
                {choice.current ? (
                  <p className="studio-in-catalog">{w.current}</p>
                ) : (
                  <button
                    type="button"
                    className="studio-button"
                    disabled={pending}
                    onClick={() => {
                      clearFailure();
                      void choose(choice);
                    }}
                  >
                    {hasArtwork ? w.useInstead : w.use}
                    <span className="studio-sr-only">
                      {w.frontCoverNumber(index + 1)}
                    </span>
                  </button>
                )}
              </li>
            ))}
          </ul>
        </>
      )}

      {hasArtwork ? (
        <div className="studio-actions">
          <button
            type="button"
            className="studio-button"
            disabled={pending}
            onClick={() => {
              clearFailure();
              setRemoving(true);
            }}
          >
            {w.remove}
          </button>
        </div>
      ) : null}

      <p
        role={failure ? "alert" : "status"}
        className={failure ? "studio-problem" : "studio-hint"}
        style={{ maxWidth: "62ch" }}
      >
        {pending
          ? words.common.saving
          : failure
            ? failureMessage(words, failure)
            : ""}
      </p>

      <ConfirmDialog
        open={removing}
        title={w.removeQuestion}
        confirmLabel={w.removeConfirm}
        pending={pending}
        onConfirm={remove}
        onCancel={() => setRemoving(false)}
      >
        <p>{w.removeBody}</p>
      </ConfirmDialog>
    </section>
  );
}
