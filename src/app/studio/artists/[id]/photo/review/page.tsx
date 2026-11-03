import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { accessDenied } from "@/app/studio/access";
import { LicenseName, PhotoFrame } from "@/app/studio/artist-photograph";
import { formatDate } from "@/app/studio/format";
import { StudioFrame } from "@/app/studio/frame";
import { StudioLoading } from "@/app/studio/studio-loading";
import {
  CatalogError,
  reviewArtistPhoto,
  type ArtistPhotoReview,
  type PhotoRefusal,
} from "@/modules/catalog";
import { authorizeAuthor } from "@/modules/identity";

import { ApprovePhoto } from "./approve-photo";

// A fixed title: nothing about the file reaches page metadata.
export const metadata: Metadata = { title: "Review photograph · refrain" };

// The review of one Wikimedia Commons file for an artist (M3.3). Opening it
// writes nothing. It shows what would be stored and everything the author
// needs to decide: the creator, the credit, the source, the license and its
// terms, restrictions, the size and format, the version, and what Refrain
// changes. A file that cannot be used is explained and never shown.

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

export default function ReviewPhotoPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: SearchParams;
}) {
  return (
    <Suspense fallback={<StudioLoading />}>
      <ReviewPhoto params={params} searchParams={searchParams} />
    </Suspense>
  );
}

const REFUSAL: Record<PhotoRefusal, string> = {
  unsupported_license:
    "Its license isn’t one Refrain accepts (CC0, public domain, or CC BY or CC BY-SA 2.0 to 4.0, unported or international).",
  license_mismatch:
    "Its license details on Wikimedia Commons disagree with each other, so which license applies isn’t clear.",
  non_free: "Wikimedia Commons marks it as not freely licensed.",
  no_creator: "It doesn’t name the photographer or creator to credit.",
  credit_not_plain:
    "Its credit is formatted in a way Refrain can’t show as plain text.",
  credit_too_long: "Its credit is too long to show under a photograph.",
  deletion_requested:
    "It has been nominated for deletion on Wikimedia Commons.",
  unsupported_format: "It isn’t a JPEG or PNG photograph.",
  too_small: "It’s smaller than 600 × 400 pixels.",
  unexpected_address:
    "Its addresses on Wikimedia Commons aren’t in the form Refrain can show reliably.",
};

const FORMAT: Record<string, string> = {
  "image/jpeg": "JPEG",
  "image/png": "PNG",
};

async function ReviewPhoto({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: SearchParams;
}) {
  const authorization = await authorizeAuthor(await headers());
  if (!authorization.ok) {
    return accessDenied(authorization.reason);
  }
  const { id } = await params;
  const query = await searchParams;
  const file = first(query.file);
  const back = `/studio/artists/${id}/photo${
    first(query.q) ? `?${new URLSearchParams({ q: first(query.q) })}` : ""
  }`;

  let review: ArtistPhotoReview | null;
  try {
    review = await reviewArtistPhoto(authorization.author, {
      artistId: id,
      file,
    });
  } catch (error) {
    if (error instanceof CatalogError && error.failure === "invalid_input") {
      notFound();
    }
    if (
      error instanceof CatalogError &&
      (error.failure === "provider_unavailable" ||
        error.failure === "provider_not_found")
    ) {
      return (
        <StudioFrame current="artists">
          <p>
            <Link href={back} className="studio-link">
              ← Photograph
            </Link>
          </p>
          <h1 className="studio-title">Review photograph</h1>
          <div className="studio-panel" role="alert">
            <p className="studio-section-title">
              Couldn’t reach Wikimedia Commons.
            </p>
            <p>
              Nothing was changed. Your catalog and your writing still work. Try
              again in a moment.
            </p>
            <p>
              <Link
                href={`/studio/artists/${id}/photo/review?${new URLSearchParams({ file, ...(first(query.q) ? { q: first(query.q) } : {}) })}`}
                className="studio-button"
              >
                Try again
              </Link>
            </p>
          </div>
        </StudioFrame>
      );
    }
    throw error;
  }
  if (!review) {
    notFound();
  }
  const { artist, assessment } = review;

  return (
    <StudioFrame current="artists">
      <p>
        <Link href={back} className="studio-link">
          ← Photograph
        </Link>
      </p>
      <h1 className="studio-title">Review photograph</h1>
      <p className="studio-lede">For {artist.name}.</p>

      {!assessment ? (
        <div className="studio-panel" role="status">
          <p className="studio-section-title">
            Wikimedia Commons has no such file.
          </p>
          <p>It may have been deleted or renamed. Nothing was changed.</p>
          <p>
            <Link href={back} className="studio-button">
              Back to the photograph
            </Link>
          </p>
        </div>
      ) : (
        <>
          <div className="studio-review-photo">
            <PhotoFrame
              image={assessment.image}
              name={artist.name}
              label={
                assessment.image
                  ? `Candidate: ${assessment.title}`
                  : `${assessment.title} isn’t shown`
              }
              size={260}
            />
            <dl className="studio-facts">
              <dt>Photograph</dt>
              <dd>
                <a
                  href={assessment.sourceUrl}
                  className="studio-link"
                  rel="noreferrer"
                >
                  {assessment.title}
                </a>
              </dd>
              <dt>Credit shown</dt>
              <dd>{assessment.credit ?? "None that can be shown"}</dd>
              {assessment.creditFromAttribution ? (
                <>
                  <dt>Creator</dt>
                  <dd>{assessment.creator || "Not named"}</dd>
                </>
              ) : null}
              <dt>Source</dt>
              <dd>
                Wikimedia Commons,{" "}
                <a
                  href={assessment.sourceUrl}
                  className="studio-link"
                  rel="noreferrer"
                >
                  the file’s page
                </a>
                {assessment.sourceCredit
                  ? `. Its source note: ${assessment.sourceCredit}`
                  : null}
              </dd>
              <dt>License</dt>
              <dd>
                {assessment.license ? (
                  <LicenseName license={assessment.license} />
                ) : (
                  "Not one Refrain accepts"
                )}
                {assessment.usageTerms ? ` (${assessment.usageTerms})` : null}
              </dd>
              <dt>Size</dt>
              <dd>
                {assessment.width} × {assessment.height} px,{" "}
                {FORMAT[assessment.mime] ?? "another format"}
              </dd>
              <dt>Version</dt>
              <dd>
                Uploaded {formatDate(new Date(assessment.timestamp))} · SHA-1{" "}
                {assessment.sha1.slice(0, 12)}
              </dd>
              <dt>Changes</dt>
              <dd>{assessment.modifications}</dd>
            </dl>
          </div>

          {assessment.restrictions.includes("personality") ? (
            <div className="studio-panel" role="note">
              <p className="studio-section-title">Personality rights</p>
              <p>
                Wikimedia Commons warns that the people shown may have rights
                that restrict some uses of their image, whatever the license.
              </p>
            </div>
          ) : null}
          {assessment.restrictions.some((word) => word !== "personality") ? (
            <p className="studio-hint">
              Other restrictions noted on Wikimedia Commons:{" "}
              {assessment.restrictions
                .filter((word) => word !== "personality")
                .join(", ")}
              .
            </p>
          ) : null}
          <p className="studio-hint" style={{ maxWidth: "62ch" }}>
            A free license covers the photograph itself, not the people in it.
            Before a photograph appears on a public page, it needs the rights
            review in Refrain’s hosted-release checklist.
          </p>

          {assessment.refusals.length > 0 || !review.review ? (
            <div className="studio-panel" role="status">
              <p className="studio-section-title">
                This photograph can’t be used.
              </p>
              <ul className="studio-facts-list">
                {assessment.refusals.map((refusal) => (
                  <li key={refusal}>{REFUSAL[refusal]}</li>
                ))}
              </ul>
              <p>
                <Link href={back} className="studio-button">
                  Choose another
                </Link>
              </p>
            </div>
          ) : artist.archived ? (
            <div className="studio-panel" role="status">
              <p>
                This artist is archived. Restore it to change its photograph.
              </p>
            </div>
          ) : review.isCurrent ? (
            <div className="studio-panel" role="status">
              <p>This is the photograph on file, in this version.</p>
              <p>
                <Link href={back} className="studio-button">
                  Back to the photograph
                </Link>
              </p>
            </div>
          ) : (
            <ApprovePhoto
              artistId={artist.id}
              file={assessment.fileName}
              review={review.review}
              expectedPhoto={review.current.state}
              replacing={review.current.state !== null}
              cancelHref={back}
            />
          )}
        </>
      )}
    </StudioFrame>
  );
}
