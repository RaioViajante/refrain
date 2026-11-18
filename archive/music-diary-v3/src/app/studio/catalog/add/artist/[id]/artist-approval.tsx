"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import {
  importMusicArtistAction,
  linkArtistToMusicAction,
} from "@/app/studio/catalog/add/actions";
import { ConfirmDialog, useSubmission } from "@/app/studio/form-kit";
import { failureMessage } from "@/app/studio/messages";
import { useStudio } from "@/app/studio/studio-locale";

// The author's explicit approval of a reviewed MusicBrainz artist (M3.2).

export function ArtistApproval({
  mbArtistId,
  review,
}: {
  mbArtistId: string;
  review: string;
}) {
  const router = useRouter();
  const { words, href } = useStudio();
  const { pending, failure, run } = useSubmission();

  async function approve() {
    const result = await run(() =>
      importMusicArtistAction({ mbArtistId, review }),
    );
    if (result.ok) {
      router.push(href(`/studio/artists/${result.data.id}`));
    }
  }

  return (
    <div className="space-y-2">
      <div className="studio-actions">
        <button
          type="button"
          className="studio-button studio-button-primary"
          disabled={pending}
          onClick={approve}
        >
          {pending ? words.releaseApproval.adding : words.artistForm.add}
        </button>
      </div>
      <p
        role={failure ? "alert" : "status"}
        className={failure ? "studio-problem" : "studio-hint"}
        style={{ maxWidth: "62ch" }}
      >
        {failure
          ? failureMessage(words, failure)
          : words.artistReview.nothingPublished}
      </p>
    </div>
  );
}

export function LinkArtistButton({
  artistId,
  artistName,
  mbArtistId,
  review,
}: {
  artistId: string;
  artistName: string;
  mbArtistId: string;
  review: string;
}) {
  const router = useRouter();
  const { words, href } = useStudio();
  const w = words.artistReview;
  const { pending, failure, run, clearFailure } = useSubmission();
  const [asking, setAsking] = useState(false);

  async function link() {
    const result = await run(() =>
      linkArtistToMusicAction({ artistId, mbArtistId, review }),
    );
    setAsking(false);
    if (result.ok) {
      router.push(href(`/studio/artists/${artistId}`));
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
        <span className="studio-sr-only">{`: ${artistName}`}</span>
      </button>
      {failure ? (
        <p role="alert" className="studio-problem">
          {failureMessage(words, failure)}
        </p>
      ) : null}
      <ConfirmDialog
        open={asking}
        title={words.releaseApproval.linkQuestion(artistName)}
        confirmLabel={words.releaseApproval.linkConfirm}
        pending={pending}
        onConfirm={link}
        onCancel={() => setAsking(false)}
      >
        <p>{w.linkBody}</p>
      </ConfirmDialog>
    </>
  );
}
