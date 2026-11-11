import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { accessDenied } from "@/app/studio/access";
import { StudioFrame } from "@/app/studio/frame";
import { StudioLoading } from "@/app/studio/studio-loading";
import { studio } from "@/app/studio/studio-words";
import type { InterfaceLocale } from "@/i18n/locales";
import {
  CatalogError,
  reviewMusicArtist,
  type ArtistReview,
} from "@/modules/catalog";
import { authorizeAuthor } from "@/modules/identity";

import { ArtistApproval, LinkArtistButton } from "./artist-approval";

export function addArtistMetadata(locale: InterfaceLocale): Metadata {
  return { title: studio(locale).words.meta.reviewBeforeAdding };
}

// The review of one MusicBrainz artist before anything is written (M3.2).

interface Props {
  params: Promise<{ id: string }>;
  locale: InterfaceLocale;
}

export function AddArtistScreen({ params, locale }: Props) {
  return (
    <Suspense fallback={<StudioLoading locale={locale} />}>
      <Review params={params} locale={locale} />
    </Suspense>
  );
}

async function Review({ params, locale }: Props) {
  const authorization = await authorizeAuthor(await headers());
  if (!authorization.ok) {
    return accessDenied(authorization.reason, locale);
  }
  const { words, href } = studio(locale);
  const w = words.artistReview;
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
        <StudioFrame
          locale={locale}
          path="/studio/catalog/add"
          current="catalog"
        >
          <div className="studio-panel" role="alert">
            <p className="studio-section-title">
              {words.addMusic.unreachableTitle}
            </p>
            <p>{words.addMusic.unreachableBody}</p>
            <p>
              <Link
                href={href(`/studio/catalog/add/artist/${id}`)}
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

  const { artist, plan, existing } = review;
  return (
    <StudioFrame
      locale={locale}
      path={`/studio/catalog/add/artist/${artist.id}`}
      current="catalog"
    >
      <p>
        <Link
          href={href("/studio/catalog/add?kind=artists")}
          className="studio-link"
        >
          {words.editions.back}
        </Link>
      </p>
      <h1 className="studio-title">{artist.name}</h1>
      <p className="studio-lede">{w.lead}</p>

      <dl className="studio-facts">
        <dt>{w.name}</dt>
        <dd>{artist.name}</dd>
        <dt>{w.sortedAs}</dt>
        <dd>{artist.sortName ?? words.release.notGiven}</dd>
        <dt>{w.addedAs}</dt>
        <dd>
          {plan.kind === "group" ? w.band : w.person}
          {plan.kindFromProvider ? "" : words.release.kindUnknown}
        </dd>
        {artist.country ? (
          <>
            <dt>{words.release.country}</dt>
            <dd>{artist.country}</dd>
          </>
        ) : null}
        {artist.disambiguation ? (
          <>
            <dt>{words.release.note}</dt>
            <dd>{artist.disambiguation}</dd>
          </>
        ) : null}
      </dl>

      {existing ? (
        <div className="studio-panel" role="status">
          <p className="studio-section-title">
            {words.addMusic.alreadyInCatalog}
          </p>
          <p>
            {w.alreadyStart}
            <Link
              href={href(`/studio/artists/${existing.id}`)}
              className="studio-link"
            >
              {existing.name}
            </Link>
            {words.release.alreadyAlbumEnd}
          </p>
        </div>
      ) : review.review === null ? (
        <div className="studio-panel" role="status">
          <p>{w.tooLong}</p>
        </div>
      ) : (
        <ArtistApproval mbArtistId={artist.id} review={review.review} />
      )}

      {!existing && review.review !== null && review.sameName.length > 0 ? (
        <section aria-labelledby="review-link" className="space-y-2">
          <h2 id="review-link" className="studio-section-title">
            {w.linkTitle}
          </h2>
          <p className="studio-hint" style={{ maxWidth: "62ch" }}>
            {w.linkHint}
          </p>
          <ul className="studio-list" aria-labelledby="review-link">
            {review.sameName.map((match) => (
              <li key={match.id} className="studio-row">
                <span className="studio-row-title">
                  <Link href={href(`/studio/artists/${match.id}`)}>
                    {match.name}
                  </Link>
                </span>
                <span className="studio-meta">
                  {match.kind === "group"
                    ? words.artists.band
                    : words.artists.person}
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

      <p className="studio-hint">{words.editions.source}</p>
    </StudioFrame>
  );
}
