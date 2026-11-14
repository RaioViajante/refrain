import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { accessDenied } from "@/app/studio/access";
import {
  editionDate,
  editionPlace,
  providerTerm,
} from "@/app/studio/catalog/add/edition-text";
import { formatDuration } from "@/app/studio/format";
import { StudioFrame } from "@/app/studio/frame";
import { StudioLoading } from "@/app/studio/studio-loading";
import { studio } from "@/app/studio/studio-words";
import type { InterfaceLocale } from "@/i18n/locales";
import {
  CatalogError,
  reviewMusicRelease,
  type ReleaseReview,
  type UnsupportedReason,
} from "@/modules/catalog";
import { authorizeAuthor } from "@/modules/identity";

import { LinkAlbumButton, ReleaseApproval } from "./release-approval";

export function addReleaseMetadata(locale: InterfaceLocale): Metadata {
  return { title: studio(locale).words.meta.reviewBeforeAdding };
}

// The review of one MusicBrainz release before anything is written (M3.2).
// It shows exactly what the import would add, what is already in the catalog
// and would be reused as it is, and the front covers the author may choose
// (none by default). The approval sends back only the release, the
// fingerprint of this review, and the chosen image; the server fetches the
// release again and refuses if it no longer matches.

interface Props {
  params: Promise<{ id: string }>;
  locale: InterfaceLocale;
}

export function AddReleaseScreen({ params, locale }: Props) {
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
  const w = words.release;
  const unsupported: Record<UnsupportedReason, string> = w.unsupported;
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
                href={href(`/studio/catalog/add/release/${id}`)}
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
    <StudioFrame
      locale={locale}
      path={`/studio/catalog/add/release/${release.id}`}
      current="catalog"
    >
      <p>
        <Link
          href={href(`/studio/catalog/add/album/${release.releaseGroup.id}`)}
          className="studio-link"
        >
          {w.back}
        </Link>
      </p>
      <h1 className="studio-title">{release.releaseGroup.title}</h1>
      <p className="studio-lede">{w.lead}</p>

      {review.existingAlbum ? (
        <div className="studio-panel" role="status">
          <p className="studio-section-title">
            {words.addMusic.alreadyInCatalog}
          </p>
          <p>
            {words.editions.alreadyStart}
            <Link
              href={href(`/studio/albums/${review.existingAlbum.id}`)}
              className="studio-link"
            >
              {review.existingAlbum.title}
            </Link>
            {w.alreadyAlbumEnd}
          </p>
        </div>
      ) : review.existingEdition ? (
        <div className="studio-panel" role="status">
          <p className="studio-section-title">
            {words.addMusic.alreadyInCatalog}
          </p>
          <p>
            {w.editionBelongs}
            <Link
              href={href(`/studio/albums/${review.existingEdition.albumId}`)}
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
          <p className="studio-section-title">{w.unsupportedTitle}</p>
          <p>{unsupported[review.unsupported]}</p>
          <p>{w.unsupportedHint}</p>
        </div>
      ) : null}

      <section aria-labelledby="review-album" className="space-y-2">
        <h2 id="review-album" className="studio-section-title">
          {w.album}
        </h2>
        <dl className="studio-facts">
          <dt>{w.title}</dt>
          <dd>{release.releaseGroup.title}</dd>
          <dt>{w.creditedTo}</dt>
          <dd>{release.credit || w.noArtist}</dd>
          <dt>{w.firstReleased}</dt>
          <dd>{plan?.firstReleaseYear ?? w.notKnown}</dd>
          <dt>{w.kind}</dt>
          <dd>
            {[
              release.releaseGroup.primaryType
                ? providerTerm(locale, release.releaseGroup.primaryType)
                : w.notGiven,
              ...release.releaseGroup.secondaryTypes.map((type) =>
                providerTerm(locale, type),
              ),
            ].join(" · ")}
          </dd>
        </dl>
      </section>

      <section aria-labelledby="review-edition" className="space-y-2">
        <h2 id="review-edition" className="studio-section-title">
          {w.edition}
        </h2>
        <dl className="studio-facts">
          <dt>{w.released}</dt>
          <dd>
            {editionDate(locale, release.date) ?? words.editions.noDate}
            {partialDate ? w.partialDate : ""}
          </dd>
          <dt>{w.country}</dt>
          <dd>{editionPlace(locale, release.country) ?? w.notGiven}</dd>
          <dt>{w.label}</dt>
          <dd>{plan?.edition.label ?? release.labels[0] ?? w.notGiven}</dd>
          {release.disambiguation ? (
            <>
              <dt>{w.note}</dt>
              <dd>{release.disambiguation}</dd>
            </>
          ) : null}
          <dt>{w.status}</dt>
          <dd>
            {release.status ? providerTerm(locale, release.status) : w.notGiven}
          </dd>
        </dl>
      </section>

      {plan ? (
        <section aria-labelledby="review-tracks" className="space-y-2">
          <h2 id="review-tracks" className="studio-section-title">
            {w.tracks}
          </h2>
          <p className="studio-hint">{w.tracksHint(plan.tracks.length)}</p>
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
                        {existing.archived ? w.archivedInCatalog : w.inCatalog}
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
            {w.artists}
          </h2>
          <ul className="studio-facts-list">
            {review.artists.map((artist) => (
              <li key={artist.mbArtistId}>
                {artist.existing ? (
                  <>
                    <Link
                      href={href(`/studio/artists/${artist.existing.id}`)}
                      className="studio-link"
                    >
                      {artist.existing.name}
                    </Link>
                    <span className="studio-meta">
                      {artist.existing.archived
                        ? w.archivedInCatalog
                        : w.keptAsItIs}
                    </span>
                  </>
                ) : (
                  <>
                    {artist.name}
                    <span className="studio-meta">
                      {artist.kind === "group" ? w.newBand : w.newPerson}
                      {artist.kindFromProvider ? "" : w.kindUnknown}
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
          coverDisplay={review.coverDisplay}
          // Only these fields reach the browser: never a cover address, and
          // no image source while covers are off.
          choices={review.artwork.map((choice) => ({
            imageId: choice.imageId,
            types: choice.types,
            artwork: choice.artwork,
          }))}
        />
      ) : null}

      {!review.existingAlbum && review.sameTitle.length > 0 ? (
        <section aria-labelledby="review-link" className="space-y-2">
          <h2 id="review-link" className="studio-section-title">
            {w.linkTitle}
          </h2>
          <p className="studio-hint" style={{ maxWidth: "62ch" }}>
            {w.linkHint}
          </p>
          <ul className="studio-list" aria-labelledby="review-link">
            {review.sameTitle.map((album) => (
              <li key={album.id} className="studio-row studio-entry">
                <span
                  className="studio-entry-body"
                  style={{ gridColumn: "1 / 3" }}
                >
                  <span className="studio-row-title">
                    <Link href={href(`/studio/albums/${album.id}`)}>
                      {album.title}
                    </Link>
                  </span>
                  <span className="studio-meta">
                    {[
                      album.credit || words.albums.noArtist,
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

      <p className="studio-hint">{words.addMusic.source}</p>
    </StudioFrame>
  );
}
