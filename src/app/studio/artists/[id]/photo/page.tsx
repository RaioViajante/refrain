import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { accessDenied } from "@/app/studio/access";
import {
  PhotoAttribution,
  PhotoFrame,
  LicenseName,
} from "@/app/studio/artist-photograph";
import { plural } from "@/app/studio/format";
import { StudioFrame } from "@/app/studio/frame";
import { Icon } from "@/app/studio/icons";
import { StudioLoading } from "@/app/studio/studio-loading";
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
export const metadata: Metadata = { title: "Photograph · refrain" };

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

export default function PhotoPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: SearchParams;
}) {
  return (
    <Suspense fallback={<StudioLoading />}>
      <Photo params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function Photo({
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
  const artist = await getArtist(authorization.author, id);
  if (!artist) {
    notFound();
  }
  const query = first((await searchParams).q)
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
  const here = `/studio/artists/${id}/photo${query ? `?${new URLSearchParams({ q: query })}` : ""}`;

  return (
    <StudioFrame current="artists">
      <p>
        <Link href={`/studio/artists/${id}`} className="studio-link">
          ← {artist.name}
        </Link>
      </p>
      <h1 className="studio-title">Photograph</h1>
      <p className="studio-lede">
        Choose a freely licensed photograph from Wikimedia Commons, or none.
        Only photographs with a license Refrain accepts and a named creator are
        offered, and nothing changes until you choose one.
      </p>

      <section aria-labelledby="photo-current" className="space-y-3">
        <h2 id="photo-current" className="studio-section-title">
          On file
        </h2>
        <figure className="studio-photo-figure">
          <PhotoFrame
            image={artist.photo.photo}
            name={artist.name}
            size={220}
          />
          {artist.photo.photo ? (
            <figcaption>
              <PhotoAttribution photo={artist.photo.photo} />
            </figcaption>
          ) : null}
        </figure>
        {artist.photo.unreadable ? (
          <div className="studio-panel" role="status">
            <p className="studio-section-title">Not shown</p>
            <p>
              The photograph on file isn’t in the form Refrain writes (it may
              have been changed outside the studio), so it isn’t shown. Remove
              it, then choose again.
            </p>
          </div>
        ) : artist.photo.photo ? null : (
          <p className="studio-hint">No photo. The page works without one.</p>
        )}
        {artist.photo.state !== null && !artist.archived ? (
          <RemovePhoto
            artistId={id}
            name={artist.name}
            expectedPhoto={artist.photo.state}
          />
        ) : null}
      </section>

      {artist.archived ? (
        <div className="studio-panel" role="status">
          <p>This artist is archived. Restore it to change its photograph.</p>
        </div>
      ) : (
        <>
          <div className="studio-search">
            <form
              action={`/studio/artists/${id}/photo`}
              method="get"
              role="search"
              className="studio-search-field"
            >
              <label htmlFor="photo-search" className="studio-sr-only">
                Search Wikimedia Commons
              </label>
              <Icon name="search" size={18} />
              <input
                id="photo-search"
                name="q"
                type="search"
                className="studio-field"
                defaultValue={query || artist.name}
                maxLength={200}
                placeholder="Search Wikimedia Commons"
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
                  <Icon name="search" size={16} /> Looking on Wikimedia Commons…
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
              author={authorization.author}
              artistId={id}
              query={query}
              retry={here}
            />
          </Suspense>
        </>
      )}
      <p className="studio-hint" style={{ maxWidth: "62ch" }}>
        Photographs from Wikimedia Commons, each under its own license and
        credited as it asks. A free license covers the photograph, not the
        people in it.
      </p>
    </StudioFrame>
  );
}

const CHECK: Record<Exclude<CurrentPhotoCheck, "unchanged">, string> = {
  new_version:
    "A new version of this file was uploaded to Wikimedia Commons after you chose it, and the frame now shows that version. Review it again, or remove it.",
  details_changed:
    "Its credit or license on Wikimedia Commons changed after you chose it. Review it again to keep the attribution right, or remove it.",
  missing:
    "Wikimedia Commons no longer has this file; it may have been deleted. Remove it, or choose another.",
  not_usable:
    "On Wikimedia Commons, this file no longer meets Refrain’s license and credit rules. Remove it, or choose another.",
  unavailable:
    "Couldn’t check this file on Wikimedia Commons just now. The photograph on file is unchanged.",
};

async function Choices({
  author,
  artistId,
  query,
  retry,
}: {
  author: AuthorizedAuthor;
  artistId: string;
  query: string;
  retry: string;
}) {
  const found = await listArtistPhotoChoices(author, { artistId, query });
  if (!found) {
    notFound();
  }
  const reviewHref = (fileName: string) =>
    `/studio/artists/${artistId}/photo/review?${new URLSearchParams({
      file: fileName,
      ...(query ? { q: query } : {}),
    })}`;

  return (
    <>
      {found.currentCheck && found.currentCheck !== "unchanged" ? (
        <div
          className="studio-panel"
          role={found.currentCheck === "unavailable" ? "status" : "alert"}
        >
          <p className="studio-section-title">The photograph on file</p>
          <p>{CHECK[found.currentCheck]}</p>
          {found.current.photo &&
          (found.currentCheck === "new_version" ||
            found.currentCheck === "details_changed") ? (
            <p>
              <Link
                href={reviewHref(found.current.photo.fileName)}
                className="studio-button"
              >
                Review it again
              </Link>
            </p>
          ) : null}
        </div>
      ) : null}

      <Suggestions found={found} reviewHref={reviewHref} />

      {found.results === null ? (
        <p className="studio-hint">
          Search Wikimedia Commons for a photograph of {found.artist.name}.
        </p>
      ) : found.searchUnavailable ? (
        <div className="studio-panel" role="alert">
          <p className="studio-section-title">
            Couldn’t reach Wikimedia Commons.
          </p>
          <p>
            Your catalog and your writing still work, and the photograph on file
            is unchanged. Try again in a moment.
          </p>
          <p>
            <Link href={retry} className="studio-button">
              Try again
            </Link>
          </p>
        </div>
      ) : found.results.length === 0 && found.refused === 0 ? (
        <div className="studio-panel" role="status">
          <p className="studio-section-title">
            Nothing found for “{found.query}”.
          </p>
          <p>Check the spelling, or try fewer words.</p>
        </div>
      ) : (
        <section aria-labelledby="photo-results" className="space-y-3">
          <h2 id="photo-results" className="studio-section-title">
            From Wikimedia Commons
          </h2>
          <p role="status" className="studio-sr-only">
            {`${plural(found.results.length, "photograph")} can be chosen.`}
          </p>
          {found.results.length > 0 ? (
            <>
              <p className="studio-hint" style={{ maxWidth: "62ch" }}>
                A search finds words, not people. Look closely before you
                choose.
              </p>
              <ChoiceGrid
                choices={found.results}
                name={found.artist.name}
                reviewHref={reviewHref}
              />
            </>
          ) : (
            <p className="studio-hint">Nothing found here can be offered.</p>
          )}
          <Refused count={found.refused} />
        </section>
      )}
    </>
  );
}

function Suggestions({
  found,
  reviewHref,
}: {
  found: ArtistPhotoChoices;
  reviewHref: (fileName: string) => string;
}) {
  if (found.suggestionState === "not_linked") {
    return null;
  }
  return (
    <section aria-labelledby="photo-suggestions" className="space-y-3">
      <h2 id="photo-suggestions" className="studio-section-title">
        Suggested through Wikidata
      </h2>
      {found.suggestionState === "unavailable" ? (
        <p className="studio-hint" role="status">
          Couldn’t reach Wikidata or Wikimedia Commons for suggestions. Search
          below instead.
        </p>
      ) : found.suggestionState === "no_item" ? (
        <p className="studio-hint">
          Wikidata has no single entry for this artist’s MusicBrainz link, so
          there are no suggestions. Search below instead.
        </p>
      ) : found.suggestions.length === 0 ? (
        <p className="studio-hint">
          Wikidata’s entry for this artist has no photograph Refrain can offer.
          {found.suggestionsRefused > 0
            ? ` ${plural(found.suggestionsRefused, "file")} didn’t meet the license and credit rules.`
            : ""}
        </p>
      ) : (
        <>
          <p className="studio-hint" style={{ maxWidth: "62ch" }}>
            Wikidata links {found.artist.name}’s MusicBrainz entry to these
            files. That is a lead, not proof: check that each photograph really
            shows them before you choose it.
          </p>
          <ChoiceGrid
            choices={found.suggestions}
            name={found.artist.name}
            reviewHref={reviewHref}
          />
          <Refused count={found.suggestionsRefused} />
        </>
      )}
    </section>
  );
}

function ChoiceGrid({
  choices,
  name,
  reviewHref,
}: {
  choices: PhotoChoice[];
  name: string;
  reviewHref: (fileName: string) => string;
}) {
  return (
    <ul className="studio-choices">
      {choices.map((choice) => (
        <li key={choice.fileName} className="studio-choice">
          <PhotoFrame
            image={choice.image}
            name={name}
            label={`Candidate: ${choice.title}`}
            size={220}
          />
          <p className="studio-photo-credit">
            {choice.title}
            <br />
            Photo: {choice.credit} · <LicenseName license={choice.license} />
          </p>
          <Link href={reviewHref(choice.fileName)} className="studio-button">
            Review
            <span className="studio-sr-only">{` ${choice.title}`}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function Refused({ count }: { count: number }) {
  return count > 0 ? (
    <p className="studio-hint" style={{ maxWidth: "62ch" }}>
      {count === 1
        ? "1 more file can’t be offered: its license, credit, format, or size doesn’t meet Refrain’s rules."
        : `${count} more files can’t be offered: their license, credit, format, or size doesn’t meet Refrain’s rules.`}
    </p>
  ) : null;
}
