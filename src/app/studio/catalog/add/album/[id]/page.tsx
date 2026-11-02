import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { accessDenied } from "@/app/studio/access";
import { StudioFrame } from "@/app/studio/frame";
import { Icon } from "@/app/studio/icons";
import { StudioLoading } from "@/app/studio/studio-loading";
import {
  CatalogError,
  listMusicEditions,
  type MusicEditions,
} from "@/modules/catalog";
import { authorizeAuthor } from "@/modules/identity";

export const metadata: Metadata = { title: "Choose an edition · refrain" };

// A MusicBrainz release group (the album as a work) and its releases (the
// editions). The author picks the edition whose tracks, label, and date the
// album will have; nothing is chosen for them (M3.2).

export default function EditionsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return (
    <Suspense fallback={<StudioLoading />}>
      <Editions params={params} />
    </Suspense>
  );
}

async function Editions({ params }: { params: Promise<{ id: string }> }) {
  const authorization = await authorizeAuthor(await headers());
  if (!authorization.ok) {
    return accessDenied(authorization.reason);
  }
  const { id } = await params;
  let editions: MusicEditions;
  try {
    editions = await listMusicEditions(authorization.author, id);
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
          <p>
            <Link href="/studio/catalog/add" className="studio-link">
              ← Add music
            </Link>
          </p>
          <div className="studio-panel" role="alert">
            <p className="studio-section-title">Couldn’t reach MusicBrainz.</p>
            <p>
              Your catalog and your writing still work. Try again in a moment.
            </p>
            <p>
              <Link
                href={`/studio/catalog/add/album/${id}`}
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

  const { group, releases, total, catalogAlbum } = editions;
  return (
    <StudioFrame current="catalog">
      <p>
        <Link href="/studio/catalog/add" className="studio-link">
          ← Add music
        </Link>
      </p>
      <h1 className="studio-title">{group.title}</h1>
      <p className="studio-lede">
        {[
          group.primaryType ?? "Release",
          group.credit,
          group.firstReleaseDate
            ? `first released ${group.firstReleaseDate.slice(0, 4)}`
            : "",
          ...group.secondaryTypes,
          group.disambiguation,
        ]
          .filter(Boolean)
          .join(" · ")}
      </p>

      {catalogAlbum ? (
        <div className="studio-panel" role="status">
          <p className="studio-section-title">Already in your catalog</p>
          <p>
            This album is{" "}
            <Link
              href={`/studio/albums/${catalogAlbum.id}`}
              className="studio-link"
            >
              {catalogAlbum.title}
            </Link>{" "}
            in your catalog, so it can’t be added again. Its artwork can be
            chosen on its page.
          </p>
        </div>
      ) : null}

      <section aria-labelledby="editions" className="space-y-2">
        <h2 id="editions" className="studio-section-title">
          Choose an edition
        </h2>
        <p className="studio-hint" style={{ maxWidth: "62ch" }}>
          The album is the work. An edition is one release of it, with its own
          tracks, label, and date. The edition you choose sets the album’s
          tracklist; you review everything before it is added.
        </p>
        {releases.length === 0 ? (
          <p className="studio-hint">MusicBrainz lists no editions.</p>
        ) : (
          <ul className="studio-list" aria-labelledby="editions">
            {releases.map((release) => (
              <li key={release.id} className="studio-row studio-entry">
                <span className="studio-thumb" data-bare aria-hidden="true">
                  <Icon name="album" size={26} />
                </span>
                <span className="studio-entry-body">
                  <span className="studio-row-title">
                    {release.title}
                    {release.disambiguation
                      ? ` (${release.disambiguation})`
                      : ""}
                  </span>
                  <span className="studio-meta">
                    {[
                      release.date ?? "no date",
                      release.country ?? "",
                      release.labels.join(", "),
                      release.formats.join(" + "),
                      `${release.trackCount} ${release.trackCount === 1 ? "track" : "tracks"}`,
                      release.status ?? "",
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </span>
                <span className="studio-entry-end">
                  {release.catalogAlbumId ? (
                    <Link
                      href={`/studio/albums/${release.catalogAlbumId}`}
                      className="studio-in-catalog"
                    >
                      In catalog
                    </Link>
                  ) : catalogAlbum ? null : (
                    <Link
                      href={`/studio/catalog/add/release/${release.id}`}
                      className="studio-button"
                    >
                      Review
                      <span className="studio-sr-only">{` the ${release.date ?? "undated"} ${release.country ?? ""} edition`}</span>
                    </Link>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
        {total > releases.length ? (
          <p className="studio-hint">
            Showing the first {releases.length} of {total} editions.
          </p>
        ) : null}
      </section>
      <p className="studio-hint">Data from MusicBrainz.</p>
    </StudioFrame>
  );
}
