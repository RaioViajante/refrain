import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { accessDenied } from "@/app/studio/access";
import { formatDuration } from "@/app/studio/format";
import { StudioFrame } from "@/app/studio/frame";
import { StudioLoading } from "@/app/studio/studio-loading";
import {
  CatalogError,
  reviewMusicRelease,
  type ReleaseReview,
  type UnsupportedReason,
} from "@/modules/catalog";
import { authorizeAuthor } from "@/modules/identity";

import { LinkAlbumButton, ReleaseApproval } from "./release-approval";

export const metadata: Metadata = { title: "Review before adding · refrain" };

// The review of one MusicBrainz release before anything is written (M3.2).
// It shows exactly what the import would add, what is already in the catalog
// and would be reused as it is, and the front covers the author may choose
// (none by default). The approval sends back only the release, the
// fingerprint of this review, and the chosen image; the server fetches the
// release again and refuses if it no longer matches.

const UNSUPPORTED: Record<UnsupportedReason, string> = {
  no_tracks: "MusicBrainz lists no tracks for this edition.",
  too_many_tracks:
    "This edition has more tracks or discs than an album in the catalog can hold.",
  repeated_recording:
    "This edition lists the same recording twice, and an album holds each recording once.",
  no_credits: "MusicBrainz credits no artist on this edition.",
  too_many_credits: "This edition credits more artists than the catalog holds.",
  text_too_long:
    "A title or name on this edition is longer than the catalog holds.",
};

export default function ReleaseReviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return (
    <Suspense fallback={<StudioLoading />}>
      <Review params={params} />
    </Suspense>
  );
}

async function Review({ params }: { params: Promise<{ id: string }> }) {
  const authorization = await authorizeAuthor(await headers());
  if (!authorization.ok) {
    return accessDenied(authorization.reason);
  }
  const { id } = await params;
  let review: ReleaseReview;
  try {
    review = await reviewMusicRelease(authorization.author, id);
  } catch (error) {
    if (error instanceof CatalogError) {
      if (
        error.failure === "invalid_input" ||
        error.failure === "provider_not_found"
      ) {
        notFound();
      }
      return (
        <StudioFrame current="catalog">
          <div className="studio-panel" role="alert">
            <p className="studio-section-title">Couldn’t reach MusicBrainz.</p>
            <p>
              Your catalog and your writing still work. Try again in a moment.
            </p>
            <p>
              <Link
                href={`/studio/catalog/add/release/${id}`}
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

  const { release, plan } = review;
  const discs = new Set(plan?.tracks.map((track) => track.discNumber));
  const partialDate =
    release.date !== null && plan?.edition.releaseDate === null;
  const canImport =
    plan !== null &&
    review.review !== null &&
    !review.existingAlbum &&
    !review.existingEdition;

  return (
    <StudioFrame current="catalog">
      <p>
        <Link
          href={`/studio/catalog/add/album/${release.releaseGroup.id}`}
          className="studio-link"
        >
          ← Other editions
        </Link>
      </p>
      <h1 className="studio-title">{release.releaseGroup.title}</h1>
      <p className="studio-lede">
        Review what will be added to your catalog. Nothing is published by
        adding it, and nothing already in your catalog is changed.
      </p>

      {review.existingAlbum ? (
        <div className="studio-panel" role="status">
          <p className="studio-section-title">Already in your catalog</p>
          <p>
            This album is{" "}
            <Link
              href={`/studio/albums/${review.existingAlbum.id}`}
              className="studio-link"
            >
              {review.existingAlbum.title}
            </Link>{" "}
            in your catalog, so it isn’t added again.
          </p>
        </div>
      ) : review.existingEdition ? (
        <div className="studio-panel" role="status">
          <p className="studio-section-title">Already in your catalog</p>
          <p>
            This edition belongs to{" "}
            <Link
              href={`/studio/albums/${review.existingEdition.albumId}`}
              className="studio-link"
            >
              {review.existingEdition.title}
            </Link>
            .
          </p>
        </div>
      ) : null}

      {review.unsupported ? (
        <div className="studio-panel" role="status">
          <p className="studio-section-title">
            This edition can’t be added as one album
          </p>
          <p>{UNSUPPORTED[review.unsupported]}</p>
          <p>
            Choose another edition, add the album by hand, or link an album you
            already have.
          </p>
        </div>
      ) : null}

      <section aria-labelledby="review-album" className="space-y-2">
        <h2 id="review-album" className="studio-section-title">
          The album
        </h2>
        <dl className="studio-facts">
          <dt>Title</dt>
          <dd>{release.releaseGroup.title}</dd>
          <dt>Credited to</dt>
          <dd>{release.credit || "no artist credited"}</dd>
          <dt>First released</dt>
          <dd>{plan?.firstReleaseYear ?? "not known"}</dd>
          <dt>Kind</dt>
          <dd>
            {[
              release.releaseGroup.primaryType ?? "not given",
              ...release.releaseGroup.secondaryTypes,
            ].join(" · ")}
          </dd>
        </dl>
      </section>

      <section aria-labelledby="review-edition" className="space-y-2">
        <h2 id="review-edition" className="studio-section-title">
          This edition
        </h2>
        <dl className="studio-facts">
          <dt>Released</dt>
          <dd>
            {release.date ?? "no date"}
            {partialDate
              ? " (only the year is kept: the catalog stores full dates)"
              : ""}
          </dd>
          <dt>Country</dt>
          <dd>{release.country ?? "not given"}</dd>
          <dt>Label</dt>
          <dd>{plan?.edition.label ?? release.labels[0] ?? "not given"}</dd>
          {release.disambiguation ? (
            <>
              <dt>Note</dt>
              <dd>{release.disambiguation}</dd>
            </>
          ) : null}
          <dt>Status</dt>
          <dd>{release.status ?? "not given"}</dd>
        </dl>
      </section>

      {plan ? (
        <section aria-labelledby="review-tracks" className="space-y-2">
          <h2 id="review-tracks" className="studio-section-title">
            Tracks
          </h2>
          <p className="studio-hint">
            {`${plan.tracks.length} ${plan.tracks.length === 1 ? "track" : "tracks"}, in this edition’s order.`}{" "}
            A track already in your catalog keeps its own title and details.
          </p>
          <ol className="studio-tracks-review">
            {plan.tracks.map((track) => {
              const existing = review.existingTracks[track.mbRecordingId];
              return (
                <li key={track.mbRecordingId}>
                  <span className="studio-count">
                    {discs.size > 1
                      ? `${track.discNumber}.${track.position}`
                      : track.position}
                  </span>
                  <span>
                    {existing ? existing.title : track.title}
                    {track.credit && track.credit !== release.credit ? (
                      <span className="studio-meta"> · {track.credit}</span>
                    ) : null}
                    {existing ? (
                      <span className="studio-meta">
                        {existing.archived
                          ? " · in your catalog, archived: restore it first"
                          : " · already in your catalog"}
                      </span>
                    ) : null}
                  </span>
                  <span className="studio-count">
                    {track.lengthMs ? formatDuration(track.lengthMs) : ""}
                  </span>
                </li>
              );
            })}
          </ol>
        </section>
      ) : null}

      {review.artists.length > 0 ? (
        <section aria-labelledby="review-artists" className="space-y-2">
          <h2 id="review-artists" className="studio-section-title">
            Artists
          </h2>
          <ul className="studio-facts-list">
            {review.artists.map((artist) => (
              <li key={artist.mbArtistId}>
                {artist.existing ? (
                  <>
                    <Link
                      href={`/studio/artists/${artist.existing.id}`}
                      className="studio-link"
                    >
                      {artist.existing.name}
                    </Link>
                    <span className="studio-meta">
                      {artist.existing.archived
                        ? " · in your catalog, archived: restore it first"
                        : " · already in your catalog, kept as it is"}
                    </span>
                  </>
                ) : (
                  <>
                    {artist.name}
                    <span className="studio-meta">
                      {` · new, as a ${artist.kind === "group" ? "band" : "person"}`}
                      {artist.kindFromProvider
                        ? ""
                        : " (MusicBrainz doesn’t say; you can change it in the catalog)"}
                    </span>
                  </>
                )}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {canImport ? (
        <ReleaseApproval
          releaseId={release.id}
          review={review.review!}
          title={release.releaseGroup.title}
          artworkUnavailable={review.artworkUnavailable}
          choices={review.artwork.map((choice) => ({
            imageId: choice.imageId,
            src: choice.artwork.src,
            srcSet: choice.artwork.srcSet,
          }))}
        />
      ) : null}

      {!review.existingAlbum && review.sameTitle.length > 0 ? (
        <section aria-labelledby="review-link" className="space-y-2">
          <h2 id="review-link" className="studio-section-title">
            Or link an album you already have
          </h2>
          <p className="studio-hint" style={{ maxWidth: "62ch" }}>
            Linking records only that your album is this MusicBrainz album and
            edition. Its title, credits, tracks, and artwork stay exactly as
            they are.
          </p>
          <ul className="studio-list" aria-labelledby="review-link">
            {review.sameTitle.map((album) => (
              <li key={album.id} className="studio-row studio-entry">
                <span
                  className="studio-entry-body"
                  style={{ gridColumn: "1 / 3" }}
                >
                  <span className="studio-row-title">
                    <Link href={`/studio/albums/${album.id}`}>
                      {album.title}
                    </Link>
                  </span>
                  <span className="studio-meta">
                    {[
                      album.credit || "no credited artist",
                      album.firstReleaseYear
                        ? String(album.firstReleaseYear)
                        : "",
                      album.label ?? "",
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </span>
                <span className="studio-entry-end">
                  <LinkAlbumButton
                    albumId={album.id}
                    albumTitle={album.title}
                    releaseId={release.id}
                    review={review.linkReview}
                  />
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <p className="studio-hint">
        Data from MusicBrainz. Artwork from Cover Art Archive, added only if you
        choose it.
      </p>
    </StudioFrame>
  );
}
