import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { Suspense } from "react";

import { accessDenied } from "@/app/studio/access";
import { AlbumThumb } from "@/app/studio/artwork-placeholder";
import { StudioFrame } from "@/app/studio/frame";
import { Icon } from "@/app/studio/icons";
import { StudioLoading } from "@/app/studio/studio-loading";
import { studio, type StudioSpeech } from "@/app/studio/studio-words";
import type { InterfaceLocale } from "@/i18n/locales";
import {
  CatalogError,
  listAlbumCovers,
  searchMusic,
  type AlbumCover,
  type MusicSearch,
  type MusicSearchKind,
} from "@/modules/catalog";
import { authorizeAuthor, type AuthorizedAuthor } from "@/modules/identity";

import { providerTerm } from "./edition-text";

// A fixed title: nothing searched for reaches page metadata.
export function addMusicMetadata(locale: InterfaceLocale): Metadata {
  return { title: studio(locale).words.meta.addMusic };
}

// Add music (the approved V4.4 `Search` screen, M3.2). The search is a plain
// GET form, so it works without JavaScript and the address can be reloaded.
// Only the words typed are sent to MusicBrainz, from the server. Choosing a
// result never adds it: an album leads to its editions and a review, an
// artist to a review, and the author approves what is written.

const KINDS: MusicSearchKind[] = ["albums", "artists"];

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

interface Props {
  searchParams: SearchParams;
  locale: InterfaceLocale;
}

export function AddMusicScreen({ searchParams, locale }: Props) {
  return (
    <Suspense fallback={<StudioLoading locale={locale} />}>
      <AddMusic searchParams={searchParams} locale={locale} />
    </Suspense>
  );
}

async function AddMusic({ searchParams, locale }: Props) {
  const authorization = await authorizeAuthor(await headers());
  if (!authorization.ok) {
    return accessDenied(authorization.reason, locale);
  }
  const speech = studio(locale);
  const { words, href } = speech;
  const w = words.addMusic;
  const params = await searchParams;
  const query = first(params.q).trim();
  const kind: MusicSearchKind =
    first(params.kind) === "artists" ? "artists" : "albums";
  const kindHref = (id: MusicSearchKind) =>
    href(
      `/studio/catalog/add?${new URLSearchParams({ kind: id, ...(query ? { q: query } : {}) })}`,
    );

  return (
    <StudioFrame locale={locale} path="/studio/catalog/add" current="catalog">
      <p>
        <Link href={href("/studio/catalog")} className="studio-link">
          {w.back}
        </Link>
      </p>
      <h1 className="studio-title">{w.title}</h1>
      <p className="studio-lede">{w.lead}</p>

      <div className="studio-search">
        <form
          action={href("/studio/catalog/add")}
          method="get"
          role="search"
          className="studio-search-field"
        >
          <input type="hidden" name="kind" value={kind} />
          <label htmlFor="music-search" className="studio-sr-only">
            {w.search}
          </label>
          <Icon name="search" size={18} />
          <input
            id="music-search"
            name="q"
            type="search"
            className="studio-field"
            defaultValue={query}
            maxLength={200}
            placeholder={w.search}
            enterKeyHint="search"
            autoComplete="off"
          />
        </form>
        <nav className="studio-search-kinds" aria-label={w.searchFor}>
          {KINDS.map((item) => (
            <Link
              key={item}
              href={kindHref(item)}
              aria-current={item === kind ? "page" : undefined}
            >
              {w.kinds[item]}
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
                <Icon name="search" size={16} /> {w.searching}
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
            speech={speech}
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
  speech,
  author,
  kind,
  query,
  retry,
}: {
  speech: StudioSpeech;
  author: AuthorizedAuthor;
  kind: MusicSearchKind;
  query: string;
  retry: string;
}) {
  const w = speech.words.addMusic;
  let found: MusicSearch;
  try {
    found = await searchMusic(author, { kind, query });
  } catch (error) {
    if (error instanceof CatalogError) {
      if (error.failure === "invalid_input") {
        return (
          <div className="studio-panel" role="status">
            <p className="studio-section-title">{w.length}</p>
          </div>
        );
      }
      return (
        <div className="studio-panel" role="alert">
          <p className="studio-section-title">{w.unreachableTitle}</p>
          <p>{w.unreachableBody}</p>
          <p>
            <Link href={retry} className="studio-button">
              {speech.words.photoPage.tryAgain}
            </Link>
          </p>
        </div>
      );
    }
    throw error;
  }

  const source = <p className="studio-hint">{w.source}</p>;

  if (found.results.length === 0 && found.local.length === 0) {
    return (
      <>
        <div className="studio-panel" role="status">
          <p className="studio-section-title">
            {speech.words.photoPage.nothingFound(query)}
          </p>
          <p>{speech.words.photoPage.nothingFoundHint}</p>
        </div>
        {source}
      </>
    );
  }

  return (
    <>
      <p role="status" className="studio-sr-only">
        {w.resultCount(found.results.length)}
      </p>
      {found.kind === "albums" ? (
        <AlbumResults
          speech={speech}
          found={found}
          covers={await listAlbumCovers(author)}
        />
      ) : (
        <ArtistResults speech={speech} found={found} />
      )}
      {source}
    </>
  );
}

function InCatalog({ speech, path }: { speech: StudioSpeech; path: string }) {
  return (
    <Link href={speech.href(path)} className="studio-in-catalog">
      {speech.words.addMusic.inCatalog}
    </Link>
  );
}

function AlbumResults({
  speech,
  found,
  covers,
}: {
  speech: StudioSpeech;
  found: Extract<MusicSearch, { kind: "albums" }>;
  covers: Map<string, AlbumCover>;
}) {
  const { locale, words, href } = speech;
  const w = words.addMusic;
  return (
    <>
      {found.local.length > 0 ? (
        <section aria-labelledby="in-catalog" className="space-y-2">
          <h2 id="in-catalog" className="studio-section-title">
            {w.alreadyInCatalog}
          </h2>
          <ul className="studio-list" aria-labelledby="in-catalog">
            {found.local.map((album) => (
              <li key={album.id} className="studio-row studio-entry">
                <AlbumThumb artwork={covers.get(album.id)} />
                <span className="studio-entry-body">
                  <span className="studio-row-title">
                    <Link href={href(`/studio/albums/${album.id}`)}>
                      {album.title}
                    </Link>
                  </span>
                  <span className="studio-meta">
                    {[
                      words.frame.albums,
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
                  <InCatalog
                    speech={speech}
                    path={`/studio/albums/${album.id}`}
                  />
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="from-musicbrainz" className="space-y-2">
        <h2 id="from-musicbrainz" className="studio-section-title">
          {w.fromMusicBrainz}
        </h2>
        {found.results.length === 0 ? (
          <p className="studio-hint">{w.nothingNew}</p>
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
                      group.primaryType
                        ? providerTerm(locale, group.primaryType)
                        : w.release,
                      group.credit,
                      group.firstReleaseDate?.slice(0, 4) ?? "",
                      ...group.secondaryTypes.map((type) =>
                        providerTerm(locale, type),
                      ),
                      group.disambiguation,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </span>
                <span className="studio-entry-end">
                  {group.catalogAlbumId ? (
                    <InCatalog
                      speech={speech}
                      path={`/studio/albums/${group.catalogAlbumId}`}
                    />
                  ) : (
                    <Link
                      href={href(`/studio/catalog/add/album/${group.id}`)}
                      className="studio-button"
                    >
                      {w.add}
                      <span className="studio-sr-only">
                        {w.addAlbumLabel(group.title, group.credit)}
                      </span>
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
  speech,
  found,
}: {
  speech: StudioSpeech;
  found: Extract<MusicSearch, { kind: "artists" }>;
}) {
  const { locale, words, href } = speech;
  const w = words.addMusic;
  return (
    <>
      {found.local.length > 0 ? (
        <section aria-labelledby="in-catalog" className="space-y-2">
          <h2 id="in-catalog" className="studio-section-title">
            {w.alreadyInCatalog}
          </h2>
          <ul className="studio-list" aria-labelledby="in-catalog">
            {found.local.map((artist) => (
              <li key={artist.id} className="studio-row studio-entry">
                <span className="studio-thumb" aria-hidden="true">
                  <Icon name="artist" size={26} />
                </span>
                <span className="studio-entry-body">
                  <span className="studio-row-title">
                    <Link href={href(`/studio/artists/${artist.id}`)}>
                      {artist.name}
                    </Link>
                  </span>
                  <span className="studio-meta">
                    {artist.kind === "group"
                      ? words.artists.band
                      : words.artists.person}
                  </span>
                </span>
                <span className="studio-entry-end">
                  <InCatalog
                    speech={speech}
                    path={`/studio/artists/${artist.id}`}
                  />
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="from-musicbrainz" className="space-y-2">
        <h2 id="from-musicbrainz" className="studio-section-title">
          {w.fromMusicBrainz}
        </h2>
        {found.results.length === 0 ? (
          <p className="studio-hint">{w.nothingNew}</p>
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
                      artist.type
                        ? providerTerm(locale, artist.type)
                        : w.artist,
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
                      speech={speech}
                      path={`/studio/artists/${artist.catalogArtistId}`}
                    />
                  ) : (
                    <Link
                      href={href(`/studio/catalog/add/artist/${artist.id}`)}
                      className="studio-button"
                    >
                      {w.add}
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
