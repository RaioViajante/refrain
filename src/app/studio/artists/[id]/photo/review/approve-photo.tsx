"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

import { setArtistPhotoAction } from "@/app/studio/artists/actions";
import { useSubmission } from "@/app/studio/form-kit";
import { failureMessage } from "@/app/studio/messages";
import { useStudio } from "@/app/studio/studio-locale";

// The explicit choice of a reviewed photograph (M3.3). It sends the review's
// fingerprint and the photograph on file when the review was opened; the
// server asks Commons again and refuses if either changed. Cancel is a link
// back: it sends nothing.

export function ApprovePhoto({
  artistId,
  file,
  review,
  expectedPhoto,
  replacing,
  cancelHref,
}: {
  artistId: string;
  file: string;
  review: string;
  expectedPhoto: string | null;
  replacing: boolean;
  cancelHref: string;
}) {
  const router = useRouter();
  const { words, href } = useStudio();
  const w = words.approvePhoto;
  const { pending, failure, run, clearFailure } = useSubmission();

  async function approve() {
    clearFailure();
    const result = await run(() =>
      setArtistPhotoAction({ artistId, file, review, expectedPhoto }),
    );
    if (result.ok) {
      router.push(href(`/studio/artists/${artistId}`));
      router.refresh();
    }
  }

  return (
    <section aria-label={w.label} className="space-y-3">
      {replacing ? <p className="studio-hint">{w.replaces}</p> : null}
      <div className="studio-actions">
        <button
          type="button"
          className="studio-button studio-button-primary"
          disabled={pending}
          onClick={() => void approve()}
        >
          {replacing ? w.useInstead : w.use}
        </button>
        <Link href={cancelHref} className="studio-button">
          {words.common.cancel}
        </Link>
      </div>
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
    </section>
  );
}
