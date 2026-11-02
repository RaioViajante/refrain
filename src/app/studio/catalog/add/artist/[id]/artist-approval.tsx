"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import {
  importMusicArtistAction,
  linkArtistToMusicAction,
} from "@/app/studio/catalog/add/actions";
import { ConfirmDialog, useSubmission } from "@/app/studio/form-kit";
import { failureMessage } from "@/app/studio/messages";

// The author's explicit approval of a reviewed MusicBrainz artist (M3.2).

export function ArtistApproval({
  mbArtistId,
  review,
}: {
  mbArtistId: string;
  review: string;
}) {
  const router = useRouter();
  const { pending, failure, run } = useSubmission();

  async function approve() {
    const result = await run(() =>
      importMusicArtistAction({ mbArtistId, review }),
    );
    if (result.ok) {
      router.push(`/studio/artists/${result.data.id}`);
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
          {pending ? "Adding…" : "Add artist"}
        </button>
      </div>
      <p
        role={failure ? "alert" : "status"}
        className={failure ? "studio-problem" : "studio-hint"}
        style={{ maxWidth: "62ch" }}
      >
        {failure ? failureMessage(failure) : "Nothing is published."}
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
  const { pending, failure, run, clearFailure } = useSubmission();
  const [asking, setAsking] = useState(false);

  async function link() {
    const result = await run(() =>
      linkArtistToMusicAction({ artistId, mbArtistId, review }),
    );
    setAsking(false);
    if (result.ok) {
      router.push(`/studio/artists/${artistId}`);
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
        Link to this artist
        <span className="studio-sr-only">{`: ${artistName}`}</span>
      </button>
      {failure ? (
        <p role="alert" className="studio-problem">
          {failureMessage(failure)}
        </p>
      ) : null}
      <ConfirmDialog
        open={asking}
        title={`Link “${artistName}” to MusicBrainz?`}
        confirmLabel="Link"
        pending={pending}
        onConfirm={link}
        onCancel={() => setAsking(false)}
      >
        <p>
          This records which MusicBrainz artist it is. The name, sort name, and
          kind stay exactly as they are, and a link that is already there is
          never replaced.
        </p>
      </ConfirmDialog>
    </>
  );
}
