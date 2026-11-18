import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { accessDenied } from "@/app/studio/access";
import {
  creditCaption,
  LicenseName,
  PhotoAttribution,
  PhotoFrame,
} from "@/app/studio/artist-photograph";
import { StudioFrame } from "@/app/studio/frame";
import { Icon } from "@/app/studio/icons";
import { StudioLoading } from "@/app/studio/studio-loading";
import { studio, type StudioSpeech } from "@/app/studio/studio-words";
import type { InterfaceLocale } from "@/i18n/locales";
import {
  getArtist,
  listArtistPhotoChoices,
  type ArtistPhotoChoices,
  type CurrentPhotoCheck,
  type PhotoChoice,
} from "@/modules/catalog";
import { authorizeAuthor, type AuthorizedAuthor } from "@/modules/identity";

import { RemovePhoto } from "./remove-photo";

// A fixed title: nothing searched for reaches page metadata.
export function artistPhotoMetadata(locale: InterfaceLocale): Metadata {
  return { title: studio(locale).words.meta.photo };
}

// An artist's photograph (M3.3), in the manner of M3.2's Add music and
// Artwork screens. The search is a plain GET form, so it works without
// JavaScript and the address can be reloaded. Only the words typed (and, for
// an artist linked to MusicBrainz, the MusicBrainz ID) are sent, from the
// server. Nothing here writes: choosing a file leads to its review, and the
// author approves there. Only removal writes, after a confirmation.

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

interface Props {
  params: Promise<{ id: string }>;
  searchParams: SearchParams;
  locale: InterfaceLocale;
}

export function ArtistPhotoScreen({ params, searchParams, locale }: Props) {
  return (
    <Suspense fallback={<StudioLoading locale={locale} />}>
      <Photo params={params} searchParams={searchParams} locale={locale} />
    </Suspense>
  );
}

async function Photo({ params, searchParams, locale }: Props) {
  const authorization = await authorizeAuthor(await headers());
  if (!authorization.ok) {
    return accessDenied(authorization.reason, locale);
  }
  const speech = studio(locale);
  const { words, href } = speech;
  const w = words.photoPage;
  const { id } = await params;
  const artist = await getArtist(authorization.author, id);
  if (!artist) {
    notFound();
  }
  const query = first((await searchParams).q)
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
  const here = href(
    `/studio/artists/${id}/photo${query ? `?${new URLSearchParams({ q: query })}` : ""}`,
  );

  return (
    <StudioFrame
      locale={locale}
      path={`/studio/artists/${artist.id}/photo`}
      current="artists"
    >
      <p>
        <Link href={href(`/studio/artists/${id}`)} className="studio-link">
          ← {artist.name}
        </Link>
      </p>
      <h1 className="studio-title">{w.title}</h1>
      <p className="studio-lede">{w.lead}</p>

      <section aria-labelledby="photo-current" className="space-y-3">
        <h2 id="photo-current" className="studio-section-title" tabIndex={-1}>
          {w.onFile}
        </h2>
        <figure className="studio-photo-figure">
          <PhotoFrame
            locale={locale}
            image={artist.photo.photo}
            name={artist.name}
            size={220}
          />
          {artist.photo.photo ? (
            <figcaption>
              <PhotoAttribution locale={locale} photo={artist.photo.photo} />
            </figcaption>
          ) : null}
        </figure>
        {artist.photo.unreadable ? (
          <div className="studio-panel" role="status">
            <p className="studio-section-title">{w.notShownTitle}</p>
            <p>{w.notShownBody}</p>
          </div>
        ) : artist.photo.photo ? null : (
          <p className="studio-hint">{words.artist.noPhoto}</p>
        )}
        <RemovePhoto
          artistId={id}
          name={artist.name}
          expectedPhoto={artist.photo.state}
          focusId="photo-current"
        />
      </section>

      {artist.archived ? (
        <div className="studio-panel" role="status">
          <p>{w.archived}</p>
        </div>
      ) : (
        <>
          <div className="studio-search">
            <form
              action={href(`/studio/artists/${id}/photo`)}
              method="get"
              role="search"
              className="studio-search-field"
            >
              <label htmlFor="photo-search" className="studio-sr-only">
                {w.search}
              </label>
              <Icon name="search" size={18} />
              <input
                id="photo-search"
                name="q"
                type="search"
                className="studio-field"
                defaultValue={query || artist.name}
                maxLength={200}
                placeholder={w.search}
                enterKeyHint="search"
                autoComplete="off"
              />
            </form>
          </div>

          <Suspense
            key={query}
            fallback={
              <div>
                <p role="status" className="studio-hint">
                  <Icon name="search" size={16} /> {w.looking}
                </p>
                <div className="studio-skeleton" aria-hidden="true">
                  <span />
                  <span />
                  <span />
                </div>
              </div>
            }
          >
            <Choices
              speech={speech}
              author={authorization.author}
              artistId={id}
              query={query}
              retry={here}
            />
          </Suspense>
        </>
      )}
      <p className="studio-hint" style={{ maxWidth: "62ch" }}>
        {w.source}
      </p>
    </StudioFrame>
  );
}

async function Choices({
  speech,
  author,
  artistId,
  query,
  retry,
}: {
  speech: StudioSpeech;
  author: AuthorizedAuthor;
  artistId: string;
  query: string;
  retry: string;
}) {
  const found = await listArtistPhotoChoices(author, { artistId, query });
  if (!found) {
    notFound();
  }
  const { href } = speech;
  const w = speech.words.photoPage;
  const check: Record<
    Exclude<CurrentPhotoCheck, "unchanged">,
    string
  > = w.check;
  const reviewHref = (fileName: string) =>
    href(
      `/studio/artists/${artistId}/photo/review?${new URLSearchParams({
        file: fileName,
        ...(query ? { q: query } : {}),
      })}`,
    );

  return (
    <>
      {found.artist.onPublicPage ? (
        <div className="studio-panel" role="status">
          <p className="studio-section-title">{w.onPublicPageTitle}</p>
          <p>{w.onPublicPageBody}</p>
        </div>
      ) : null}
      {found.currentCheck && found.currentCheck !== "unchanged" ? (
        <div
          className="studio-panel"
          role={found.currentCheck === "unavailable" ? "status" : "alert"}
        >
          <p className="studio-section-title">{w.checkTitle}</p>
          <p>{check[found.currentCheck]}</p>
          {found.current.photo &&
          (found.currentCheck === "new_version" ||
            found.currentCheck === "details_changed") ? (
            <p>
              <Link
                href={reviewHref(found.current.photo.fileName)}
                className="studio-button"
              >
                {w.reviewAgain}
              </Link>
            </p>
          ) : null}
        </div>
      ) : null}

      <Suggestions speech={speech} found={found} reviewHref={reviewHref} />

      {found.results === null ? (
        <p className="studio-hint">{w.searchFor(found.artist.name)}</p>
      ) : found.searchUnavailable ? (
        <div className="studio-panel" role="alert">
          <p className="studio-section-title">{w.unreachableTitle}</p>
          <p>{w.unreachableBody}</p>
          <p>
            <Link href={retry} className="studio-button">
              {w.tryAgain}
            </Link>
          </p>
        </div>
      ) : found.results.length === 0 && found.refused === 0 ? (
        <div className="studio-panel" role="status">
          <p className="studio-section-title">{w.nothingFound(found.query)}</p>
          <p>{w.nothingFoundHint}</p>
        </div>
      ) : (
        <section aria-labelledby="photo-results" className="space-y-3">
          <h2 id="photo-results" className="studio-section-title">
            {w.fromCommons}
          </h2>
          <p role="status" className="studio-sr-only">
            {w.canBeChosen(found.results.length)}
          </p>
          {found.results.length > 0 ? (
            <>
              <p className="studio-hint" style={{ maxWidth: "62ch" }}>
                {w.lookClosely}
              </p>
              <ChoiceGrid
                speech={speech}
                choices={found.results}
                name={found.artist.name}
                reviewHref={reviewHref}
              />
            </>
          ) : (
            <p className="studio-hint">{w.nothingOffered}</p>
          )}
          <Refused speech={speech} count={found.refused} />
        </section>
      )}
    </>
  );
}

function Suggestions({
  speech,
  found,
  reviewHref,
}: {
  speech: StudioSpeech;
  found: ArtistPhotoChoices;
  reviewHref: (fileName: string) => string;
}) {
  const w = speech.words.photoPage;
  if (found.suggestionState === "not_linked") {
    return null;
  }
  return (
    <section aria-labelledby="photo-suggestions" className="space-y-3">
      <h2 id="photo-suggestions" className="studio-section-title">
        {w.suggestedTitle}
      </h2>
      {found.suggestionState === "unavailable" ? (
        <p className="studio-hint" role="status">
          {w.suggestionsUnavailable}
        </p>
      ) : found.suggestionState === "no_item" ? (
        <p className="studio-hint">{w.suggestionsNoItem}</p>
      ) : found.suggestions.length === 0 ? (
        <p className="studio-hint">
          {w.suggestionsNone}
          {found.suggestionsRefused > 0
            ? w.suggestionsRefused(found.suggestionsRefused)
            : ""}
        </p>
      ) : (
        <>
          <p className="studio-hint" style={{ maxWidth: "62ch" }}>
            {w.suggestionsLead(found.artist.name)}
          </p>
          <ChoiceGrid
            speech={speech}
            choices={found.suggestions}
            name={found.artist.name}
            reviewHref={reviewHref}
          />
          <Refused speech={speech} count={found.suggestionsRefused} />
        </>
      )}
    </section>
  );
}

function ChoiceGrid({
  speech: { locale, words },
  choices,
  name,
  reviewHref,
}: {
  speech: StudioSpeech;
  choices: PhotoChoice[];
  name: string;
  reviewHref: (fileName: string) => string;
}) {
  return (
    <ul className="studio-choices">
      {choices.map((choice) => (
        <li key={choice.fileName} className="studio-choice studio-photo-choice">
          <PhotoFrame
            locale={locale}
            image={choice.image}
            name={name}
            label={words.photoPage.candidate(choice.title)}
            size={220}
            fluid
          />
          <p className="studio-photo-credit">
            {choice.title}
            <br />
            {creditCaption(locale, choice.credit)} ·{" "}
            <LicenseName locale={locale} license={choice.license} />
          </p>
          <Link href={reviewHref(choice.fileName)} className="studio-button">
            {words.photoPage.review}
            <span className="studio-sr-only">{` ${choice.title}`}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function Refused({ speech, count }: { speech: StudioSpeech; count: number }) {
  return count > 0 ? (
    <p className="studio-hint" style={{ maxWidth: "62ch" }}>
      {speech.words.photoPage.refused(count)}
    </p>
  ) : null;
}
