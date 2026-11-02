import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { accessDenied } from "@/app/studio/access";
import { StudioFrame } from "@/app/studio/frame";
import { StudioLoading } from "@/app/studio/studio-loading";
import {
  CatalogError,
  reviewMusicArtist,
  type ArtistReview,
} from "@/modules/catalog";
import { authorizeAuthor } from "@/modules/identity";

import { ArtistApproval, LinkArtistButton } from "./artist-approval";

export const metadata: Metadata = { title: "Review before adding · refrain" };

// The review of one MusicBrainz artist before anything is written (M3.2).

export default function ArtistReviewPage({
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
  let review: ArtistReview;
  try {
    review = await reviewMusicArtist(authorization.author, id);
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
                href={`/studio/catalog/add/artist/${id}`}
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

  const { artist, plan, existing } = review;
  return (
    <StudioFrame current="catalog">
      <p>
        <Link href="/studio/catalog/add?kind=artists" className="studio-link">
          ← Add music
        </Link>
      </p>
      <h1 className="studio-title">{artist.name}</h1>
      <p className="studio-lede">
        Review what will be added to your catalog. Nothing is published by
        adding it.
      </p>

      <dl className="studio-facts">
        <dt>Name</dt>
        <dd>{artist.name}</dd>
        <dt>Sorted as</dt>
        <dd>{artist.sortName ?? "not given"}</dd>
        <dt>Added as</dt>
        <dd>
          {plan.kind === "group" ? "a band" : "a person"}
          {plan.kindFromProvider
            ? ""
            : " (MusicBrainz doesn’t say; you can change it in the catalog)"}
        </dd>
        {artist.country ? (
          <>
            <dt>Country</dt>
            <dd>{artist.country}</dd>
          </>
        ) : null}
        {artist.disambiguation ? (
          <>
            <dt>Note</dt>
            <dd>{artist.disambiguation}</dd>
          </>
        ) : null}
      </dl>

      {existing ? (
        <div className="studio-panel" role="status">
          <p className="studio-section-title">Already in your catalog</p>
          <p>
            This artist is{" "}
            <Link
              href={`/studio/artists/${existing.id}`}
              className="studio-link"
            >
              {existing.name}
            </Link>{" "}
            in your catalog, so it isn’t added again.
          </p>
        </div>
      ) : review.review === null ? (
        <div className="studio-panel" role="status">
          <p>This name is longer than the catalog holds. Add it by hand.</p>
        </div>
      ) : (
        <ArtistApproval mbArtistId={artist.id} review={review.review} />
      )}

      {!existing && review.review !== null && review.sameName.length > 0 ? (
        <section aria-labelledby="review-link" className="space-y-2">
          <h2 id="review-link" className="studio-section-title">
            Or link an artist you already have
          </h2>
          <p className="studio-hint" style={{ maxWidth: "62ch" }}>
            Linking records only which MusicBrainz artist it is. The name and
            the rest stay exactly as they are.
          </p>
          <ul className="studio-list" aria-labelledby="review-link">
            {review.sameName.map((match) => (
              <li key={match.id} className="studio-row">
                <span className="studio-row-title">
                  <Link href={`/studio/artists/${match.id}`}>{match.name}</Link>
                </span>
                <span className="studio-meta">
                  {match.kind === "group" ? "Band" : "Person"}
                </span>
                <LinkArtistButton
                  artistId={match.id}
                  artistName={match.name}
                  mbArtistId={artist.id}
                  review={review.review!}
                />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <p className="studio-hint">Data from MusicBrainz.</p>
    </StudioFrame>
  );
}
