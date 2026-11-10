import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { Suspense } from "react";

import { accessDenied } from "@/app/studio/access";
import { AlbumThumb } from "@/app/studio/artwork-placeholder";
import { StudioFrame } from "@/app/studio/frame";
import { Icon } from "@/app/studio/icons";
import { StudioLoading } from "@/app/studio/studio-loading";
import {
  CatalogError,
  listAlbumCovers,
  searchMusic,
  type AlbumCover,
  type MusicSearch,
  type MusicSearchKind,
} from "@/modules/catalog";
import { authorizeAuthor, type AuthorizedAuthor } from "@/modules/identity";

// A fixed title: nothing searched for reaches page metadata.
export const metadata: Metadata = { title: "Add music · refrain" };

// Add music (the approved V4.4 `Search` screen, M3.2). The search is a plain
// GET form, so it works without JavaScript and the address can be reloaded.
// Only the words typed are sent to MusicBrainz, from the server. Choosing a
// result never adds it: an album leads to its editions and a review, an
// artist to a review, and the author approves what is written.

const KINDS: { id: MusicSearchKind; label: string }[] = [
  { id: "albums", label: "Albums" },
  { id: "artists", label: "Artists" },
];

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

export default function AddMusicPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  return (
    <Suspense fallback={<StudioLoading />}>
      <AddMusic searchParams={searchParams} />
    </Suspense>
  );
}

async function AddMusic({ searchParams }: { searchParams: SearchParams }) {
  const authorization = await authorizeAuthor(await headers());
  if (!authorization.ok) {
    return accessDenied(authorization.reason);
  }
  const params = await searchParams;
  const query = first(params.q).trim();
  const kind: MusicSearchKind =
    first(params.kind) === "artists" ? "artists" : "albums";
  const kindHref = (id: MusicSearchKind) =>
    `/studio/catalog/add?${new URLSearchParams({ kind: id, ...(query ? { q: query } : {}) })}`;

  return (
    <StudioFrame current="catalog">
      <p>
        <Link href="/studio/catalog" className="studio-link">
          ← Back to the catalog
        </Link>
      </p>
      <h1 className="studio-title">Add music</h1>
      <p className="studio-lede">
        Search MusicBrainz for albums and artists, and add them to your catalog.
        Nothing is published by adding it.
      </p>

      <div className="studio-search">
        <form
          action="/studio/catalog/add"
          method="get"
          role="search"
          className="studio-search-field"
        >
          <input type="hidden" name="kind" value={kind} />
          <label htmlFor="music-search" className="studio-sr-only">
            Search MusicBrainz
          </label>
          <Icon name="search" size={18} />
          <input
            id="music-search"
            name="q"
            type="search"
            className="studio-field"
            defaultValue={query}
            maxLength={200}
            placeholder="Search MusicBrainz"
            enterKeyHint="search"
            autoComplete="off"
          />
        </form>
        <nav className="studio-search-kinds" aria-label="Search for">
          {KINDS.map((item) => (
            <Link
              key={item.id}
              href={kindHref(item.id)}
              aria-current={item.id === kind ? "page" : undefined}
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </div>

      {query ? (
        <Suspense
          key={`${kind}:${query}`}
          fallback={
            <div>
              <p role="status" className="studio-hint">
                <Icon name="search" size={16} /> Searching MusicBrainz…
              </p>
              <div className="studio-skeleton" aria-hidden="true">
                <span />
                <span />
                <span />
              </div>
            </div>
          }
        >
          <Results
            author={authorization.author}
            kind={kind}
            query={query}
            retry={kindHref(kind)}
          />
        </Suspense>
      ) : null}
    </StudioFrame>
  );
}

async function Results({
  author,
  kind,
  query,
  retry,
}: {
  author: AuthorizedAuthor;
  kind: MusicSearchKind;
  query: string;
  retry: string;
}) {
  let found: MusicSearch;
  try {
    found = await searchMusic(author, { kind, query });
  } catch (error) {
    if (error instanceof CatalogError) {
      if (error.failure === "invalid_input") {
        return (
          <div className="studio-panel" role="status">
            <p className="studio-section-title">Use 1 to 200 characters.</p>
          </div>
        );
      }
      return (
        <div className="studio-panel" role="alert">
          <p className="studio-section-title">Couldn’t reach MusicBrainz.</p>
          <p>
            Your catalog and your writing still work. Try again in a moment.
          </p>
          <p>
            <Link href={retry} className="studio-button">
              Try again
            </Link>
          </p>
        </div>
      );
    }
    throw error;
  }

  const source = (
    <p className="studio-hint">
      Data from MusicBrainz. Artwork from Cover Art Archive, added only if you
      choose it.
    </p>
  );

  if (found.results.length === 0 && found.local.length === 0) {
    return (
      <>
        <div className="studio-panel" role="status">
          <p className="studio-section-title">Nothing found for “{query}”.</p>
          <p>Check the spelling, or try fewer words.</p>
        </div>
        {source}
      </>
    );
  }

  return (
    <>
      <p role="status" className="studio-sr-only">
        {`${found.results.length} ${found.results.length === 1 ? "result" : "results"} from MusicBrainz.`}
      </p>
      {found.kind === "albums" ? (
        <AlbumResults found={found} covers={await listAlbumCovers(author)} />
      ) : (
        <ArtistResults found={found} />
      )}
      {source}
    </>
  );
}

function InCatalog({ href }: { href: string }) {
  return (
    <Link href={href} className="studio-in-catalog">
      In catalog
    </Link>
  );
}

function AlbumResults({
  found,
  covers,
}: {
  found: Extract<MusicSearch, { kind: "albums" }>;
  covers: Map<string, AlbumCover>;
}) {
  return (
    <>
      {found.local.length > 0 ? (
        <section aria-labelledby="in-catalog" className="space-y-2">
          <h2 id="in-catalog" className="studio-section-title">
            Already in your catalog
          </h2>
          <ul className="studio-list" aria-labelledby="in-catalog">
            {found.local.map((album) => (
              <li key={album.id} className="studio-row studio-entry">
                <AlbumThumb artwork={covers.get(album.id)} />
                <span className="studio-entry-body">
                  <span className="studio-row-title">
                    <Link href={`/studio/albums/${album.id}`}>
                      {album.title}
                    </Link>
                  </span>
                  <span className="studio-meta">
                    {[
                      "Albums",
                      album.credit,
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
                  <InCatalog href={`/studio/albums/${album.id}`} />
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="from-musicbrainz" className="space-y-2">
        <h2 id="from-musicbrainz" className="studio-section-title">
          From MusicBrainz
        </h2>
        {found.results.length === 0 ? (
          <p className="studio-hint">Nothing new found on MusicBrainz.</p>
        ) : (
          <ul className="studio-list" aria-labelledby="from-musicbrainz">
            {found.results.map((group) => (
              <li key={group.id} className="studio-row studio-entry">
                <span className="studio-thumb" data-bare aria-hidden="true">
                  <Icon name="album" size={26} />
                </span>
                <span className="studio-entry-body">
                  <span className="studio-row-title">{group.title}</span>
                  <span className="studio-meta">
                    {[
                      group.primaryType ?? "Release",
                      group.credit,
                      group.firstReleaseDate?.slice(0, 4) ?? "",
                      ...group.secondaryTypes,
                      group.disambiguation,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </span>
                <span className="studio-entry-end">
                  {group.catalogAlbumId ? (
                    <InCatalog
                      href={`/studio/albums/${group.catalogAlbumId}`}
                    />
                  ) : (
                    <Link
                      href={`/studio/catalog/add/album/${group.id}`}
                      className="studio-button"
                    >
                      Add
                      <span className="studio-sr-only">{` ${group.title}${group.credit ? ` by ${group.credit}` : ""}`}</span>
                    </Link>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

function ArtistResults({
  found,
}: {
  found: Extract<MusicSearch, { kind: "artists" }>;
}) {
  return (
    <>
      {found.local.length > 0 ? (
        <section aria-labelledby="in-catalog" className="space-y-2">
          <h2 id="in-catalog" className="studio-section-title">
            Already in your catalog
          </h2>
          <ul className="studio-list" aria-labelledby="in-catalog">
            {found.local.map((artist) => (
              <li key={artist.id} className="studio-row studio-entry">
                <span className="studio-thumb" aria-hidden="true">
                  <Icon name="artist" size={26} />
                </span>
                <span className="studio-entry-body">
                  <span className="studio-row-title">
                    <Link href={`/studio/artists/${artist.id}`}>
                      {artist.name}
                    </Link>
                  </span>
                  <span className="studio-meta">
                    {artist.kind === "group" ? "Band" : "Person"}
                  </span>
                </span>
                <span className="studio-entry-end">
                  <InCatalog href={`/studio/artists/${artist.id}`} />
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="from-musicbrainz" className="space-y-2">
        <h2 id="from-musicbrainz" className="studio-section-title">
          From MusicBrainz
        </h2>
        {found.results.length === 0 ? (
          <p className="studio-hint">Nothing new found on MusicBrainz.</p>
        ) : (
          <ul className="studio-list" aria-labelledby="from-musicbrainz">
            {found.results.map((artist) => (
              <li key={artist.id} className="studio-row studio-entry">
                <span className="studio-thumb" data-bare aria-hidden="true">
                  <Icon name="artist" size={26} />
                </span>
                <span className="studio-entry-body">
                  <span className="studio-row-title">{artist.name}</span>
                  <span className="studio-meta">
                    {[
                      artist.type ?? "Artist",
                      artist.country ?? "",
                      artist.begin
                        ? `${artist.begin.slice(0, 4)}${artist.end ? `–${artist.end.slice(0, 4)}` : ""}`
                        : "",
                      artist.disambiguation,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </span>
                <span className="studio-entry-end">
                  {artist.catalogArtistId ? (
                    <InCatalog
                      href={`/studio/artists/${artist.catalogArtistId}`}
                    />
                  ) : (
                    <Link
                      href={`/studio/catalog/add/artist/${artist.id}`}
                      className="studio-button"
                    >
                      Add
                      <span className="studio-sr-only">{` ${artist.name}`}</span>
                    </Link>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
