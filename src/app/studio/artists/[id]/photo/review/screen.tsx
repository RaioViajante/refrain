import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { accessDenied } from "@/app/studio/access";
import { LicenseName, PhotoFrame } from "@/app/studio/artist-photograph";
import { StudioFrame } from "@/app/studio/frame";
import { StudioLoading } from "@/app/studio/studio-loading";
import { studio, type StudioSpeech } from "@/app/studio/studio-words";
import { formatDate } from "@/i18n/format";
import type { InterfaceLocale } from "@/i18n/locales";
import { PHOTO_MODIFICATIONS } from "@/integrations/wikimedia-commons";
import {
  CatalogError,
  reviewArtistPhoto,
  type ArtistPhotoReview,
  type PhotoRefusal,
} from "@/modules/catalog";
import { authorizeAuthor } from "@/modules/identity";

import { ApprovePhoto } from "./approve-photo";

// A fixed title: nothing about the file reaches page metadata.
export function photoReviewMetadata(locale: InterfaceLocale): Metadata {
  return { title: studio(locale).words.meta.photoReview };
}

// The review of one Wikimedia Commons file for an artist (M3.3). Opening it
// writes nothing. It shows what would be stored and everything the author
// needs to decide: the creator, the credit, the source, the license and its
// terms, restrictions, the size and format, the version, and what Refrain
// changes. A file that cannot be used is explained and never shown.

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

interface Props {
  params: Promise<{ id: string }>;
  searchParams: SearchParams;
  locale: InterfaceLocale;
}

export function PhotoReviewScreen({ params, searchParams, locale }: Props) {
  return (
    <Suspense fallback={<StudioLoading locale={locale} />}>
      <ReviewPhoto
        params={params}
        searchParams={searchParams}
        locale={locale}
      />
    </Suspense>
  );
}

const FORMAT: Record<string, string> = {
  "image/jpeg": "JPEG",
  "image/png": "PNG",
};

async function ReviewPhoto({ params, searchParams, locale }: Props) {
  const authorization = await authorizeAuthor(await headers());
  if (!authorization.ok) {
    return accessDenied(authorization.reason, locale);
  }
  const speech = studio(locale);
  const { words, href } = speech;
  const w = words.photoReview;
  const refusalText: Record<PhotoRefusal, string> = w.refusals;
  const { id } = await params;
  const query = await searchParams;
  const file = first(query.file);
  const back = href(
    `/studio/artists/${id}/photo${
      first(query.q) ? `?${new URLSearchParams({ q: first(query.q) })}` : ""
    }`,
  );

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
        <StudioFrame
          locale={locale}
          path={`/studio/artists/${id}/photo`}
          current="artists"
        >
          <p>
            <Link href={back} className="studio-link">
              {w.back}
            </Link>
          </p>
          <h1 className="studio-title">{w.title}</h1>
          <div className="studio-panel" role="alert">
            <p className="studio-section-title">
              {words.photoPage.unreachableTitle}
            </p>
            <p>{w.unreachableBody}</p>
            <p>
              <Link
                href={href(
                  `/studio/artists/${id}/photo/review?${new URLSearchParams({ file, ...(first(query.q) ? { q: first(query.q) } : {}) })}`,
                )}
                className="studio-button"
              >
                {words.photoPage.tryAgain}
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
    <StudioFrame
      locale={locale}
      path={`/studio/artists/${artist.id}/photo`}
      current="artists"
    >
      <p>
        <Link href={back} className="studio-link">
          {w.back}
        </Link>
      </p>
      <h1 className="studio-title">{w.title}</h1>
      <p className="studio-lede">{w.forArtist(artist.name)}</p>

      {!assessment ? (
        <div className="studio-panel" role="status">
          <p className="studio-section-title">{w.noSuchFile}</p>
          <p>{w.noSuchFileBody}</p>
          <p>
            <Link href={back} className="studio-button">
              {w.backToPhoto}
            </Link>
          </p>
        </div>
      ) : (
        <>
          <div className="studio-review-photo">
            <PhotoFrame
              locale={locale}
              image={assessment.image}
              name={artist.name}
              label={
                assessment.image
                  ? words.photoPage.candidate(assessment.title)
                  : w.notShown(assessment.title)
              }
              size={260}
            />
            <dl className="studio-facts">
              <dt>{words.photograph.work}</dt>
              <dd>
                <a
                  href={assessment.sourceUrl}
                  className="studio-link"
                  rel="noreferrer"
                >
                  {assessment.title}
                </a>
              </dd>
              <dt>{w.creditShown}</dt>
              <dd>{assessment.credit ?? w.noCredit}</dd>
              {assessment.creditFromAttribution ? (
                <>
                  <dt>{w.creator}</dt>
                  <dd>
                    {assessment.creator ? (
                      <bdi>{assessment.creator}</bdi>
                    ) : (
                      w.notNamed
                    )}
                  </dd>
                </>
              ) : null}
              <dt>{words.photograph.source}</dt>
              <dd>
                {words.photograph.sourceCommons}
                <a
                  href={assessment.sourceUrl}
                  className="studio-link"
                  rel="noreferrer"
                >
                  {words.photograph.filePage}
                </a>
                {assessment.sourceCredit ? (
                  <>
                    {w.sourceNote}
                    <bdi>{assessment.sourceCredit}</bdi>
                  </>
                ) : null}
              </dd>
              <dt>{words.photograph.license}</dt>
              <dd>
                {assessment.license ? (
                  <LicenseName locale={locale} license={assessment.license} />
                ) : (
                  w.licenseNotAccepted
                )}
                {assessment.usageTerms ? (
                  <>
                    {" "}
                    (<bdi>{assessment.usageTerms}</bdi>)
                  </>
                ) : null}
              </dd>
              <dt>{w.size}</dt>
              <dd>
                {assessment.width} × {assessment.height} px,{" "}
                {FORMAT[assessment.mime] ?? w.anotherFormat}
              </dd>
              <dt>{w.version}</dt>
              <dd>
                {w.uploaded(formatDate(locale, new Date(assessment.timestamp)))}{" "}
                · SHA-1 {assessment.sha1.slice(0, 12)}
              </dd>
              <dt>{words.photograph.changes}</dt>
              {assessment.modifications === PHOTO_MODIFICATIONS ? (
                <dd>{words.photograph.standardChanges}</dd>
              ) : (
                <dd lang="en">{assessment.modifications}</dd>
              )}
            </dl>
          </div>

          {assessment.refusals.length > 0 || !review.review ? (
            <div className="studio-panel" role="status">
              <p className="studio-section-title">{w.cantBeUsed}</p>
              <ul className="studio-facts-list">
                {assessment.refusals.map((refusal) => (
                  <li key={refusal}>{refusalText[refusal]}</li>
                ))}
              </ul>
              <p>
                <Link href={back} className="studio-button">
                  {w.chooseAnother}
                </Link>
              </p>
            </div>
          ) : (
            <>
              {assessment.restrictions.includes("personality") ? (
                <div className="studio-panel" role="note">
                  <p className="studio-section-title">{w.personalityTitle}</p>
                  <p>{w.personalityBody}</p>
                </div>
              ) : null}
              {assessment.restrictions.some(
                (word) => word !== "personality",
              ) ? (
                <p className="studio-hint">
                  {w.otherRestrictions}
                  <span lang="en">
                    {assessment.restrictions
                      .filter((word) => word !== "personality")
                      .join(", ")}
                  </span>
                  .
                </p>
              ) : null}
              <p className="studio-hint" style={{ maxWidth: "62ch" }}>
                {w.freeLicenseNote}
              </p>

              {artist.archived ? (
                <div className="studio-panel" role="status">
                  <p>{w.archived}</p>
                </div>
              ) : artist.onPublicPage ? (
                <PublicPageNotice speech={speech} back={back} />
              ) : review.isCurrent ? (
                <div className="studio-panel" role="status">
                  <p>{w.isCurrent}</p>
                  <p>
                    <Link href={back} className="studio-button">
                      {w.backToPhoto}
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
        </>
      )}
    </StudioFrame>
  );
}

/**
 * Why the photograph cannot be replaced (M3.5): the artist has a public page,
 * and a new photograph would reach readers without a confirmation, which is
 * not built (gate G8). Removing stays possible on the photograph page.
 */
function PublicPageNotice({
  speech,
  back,
}: {
  speech: StudioSpeech;
  back: string;
}) {
  const w = speech.words.photoReview;
  return (
    <div className="studio-panel" role="status">
      <p className="studio-section-title">
        {speech.words.photoPage.onPublicPageTitle}
      </p>
      <p>{w.onPublicPageBody}</p>
      <p>
        <Link href={back} className="studio-button">
          {w.backToPhoto}
        </Link>
      </p>
    </div>
  );
}
