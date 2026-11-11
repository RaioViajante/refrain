import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { accessDenied } from "@/app/studio/access";
import { AlbumThumb } from "@/app/studio/artwork-placeholder";
import {
  editionDate,
  editionPlace,
  providerTerm,
} from "@/app/studio/catalog/add/edition-text";
import { StudioFrame } from "@/app/studio/frame";
import { StudioLoading } from "@/app/studio/studio-loading";
import { studio } from "@/app/studio/studio-words";
import type { InterfaceLocale } from "@/i18n/locales";
import {
  CatalogError,
  listMusicEditions,
  type MusicEditions,
} from "@/modules/catalog";
import { authorizeAuthor } from "@/modules/identity";

export function addAlbumMetadata(locale: InterfaceLocale): Metadata {
  return { title: studio(locale).words.meta.chooseEdition };
}

// A MusicBrainz release group (the album as a work) and its releases (the
// editions). The author picks the edition whose tracks, label, and date the
// album will have; nothing is chosen for them (M3.2).

interface Props {
  params: Promise<{ id: string }>;
  locale: InterfaceLocale;
}

export function AddAlbumScreen({ params, locale }: Props) {
  return (
    <Suspense fallback={<StudioLoading locale={locale} />}>
      <Editions params={params} locale={locale} />
    </Suspense>
  );
}

async function Editions({ params, locale }: Props) {
  const authorization = await authorizeAuthor(await headers());
  if (!authorization.ok) {
    return accessDenied(authorization.reason, locale);
  }
  const { words, href } = studio(locale);
  const w = words.editions;
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
        <StudioFrame
          locale={locale}
          path="/studio/catalog/add"
          current="catalog"
        >
          <p>
            <Link href={href("/studio/catalog/add")} className="studio-link">
              {w.back}
            </Link>
          </p>
          <div className="studio-panel" role="alert">
            <p className="studio-section-title">
              {words.addMusic.unreachableTitle}
            </p>
            <p>{words.addMusic.unreachableBody}</p>
            <p>
              <Link
                href={href(`/studio/catalog/add/album/${id}`)}
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

  const { group, releases, total, catalogAlbum } = editions;
  return (
    <StudioFrame
      locale={locale}
      path={`/studio/catalog/add/album/${group.id}`}
      current="catalog"
    >
      <p>
        <Link href={href("/studio/catalog/add")} className="studio-link">
          {w.back}
        </Link>
      </p>
      <h1 className="studio-title">{group.title}</h1>
      <p className="studio-lede">
        {[
          group.primaryType
            ? providerTerm(locale, group.primaryType)
            : words.addMusic.release,
          group.credit,
          group.firstReleaseDate
            ? w.firstReleased(group.firstReleaseDate.slice(0, 4))
            : "",
          ...group.secondaryTypes.map((type) => providerTerm(locale, type)),
          group.disambiguation,
        ]
          .filter(Boolean)
          .join(" · ")}
      </p>

      {catalogAlbum ? (
        <div className="studio-panel" role="status">
          <p className="studio-section-title">
            {words.addMusic.alreadyInCatalog}
          </p>
          <p>
            {w.alreadyStart}
            <Link
              href={href(`/studio/albums/${catalogAlbum.id}`)}
              className="studio-link"
            >
              {catalogAlbum.title}
            </Link>
            {w.alreadyEnd}
          </p>
        </div>
      ) : null}

      <section aria-labelledby="editions" className="space-y-2">
        <h2 id="editions" className="studio-section-title">
          {w.choose}
        </h2>
        <p className="studio-hint" style={{ maxWidth: "62ch" }}>
          {w.explain}
        </p>
        {releases.length === 0 ? (
          <p className="studio-hint">{w.none}</p>
        ) : (
          <ul className="studio-list" aria-labelledby="editions">
            {releases.map((release) => (
              <li key={release.id} className="studio-row studio-entry">
                <AlbumThumb artwork={release.artwork} lazy />
                <span className="studio-entry-body">
                  <span className="studio-row-title">
                    {release.title}
                    {release.disambiguation
                      ? ` (${release.disambiguation})`
                      : ""}
                  </span>
                  <span className="studio-meta">
                    {[
                      release.date !== null &&
                      release.date === group.firstReleaseDate
                        ? w.original
                        : "",
                      editionDate(locale, release.date) ?? w.noDate,
                      editionPlace(locale, release.country) ?? "",
                      release.labels.join(", "),
                      release.formats.join(" + "),
                      words.counts.tracks(release.trackCount),
                      release.status
                        ? providerTerm(locale, release.status)
                        : "",
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </span>
                <span className="studio-entry-end">
                  {release.catalogAlbumId ? (
                    <Link
                      href={href(`/studio/albums/${release.catalogAlbumId}`)}
                      className="studio-in-catalog"
                    >
                      {words.addMusic.inCatalog}
                    </Link>
                  ) : catalogAlbum ? null : (
                    <Link
                      href={href(`/studio/catalog/add/release/${release.id}`)}
                      className="studio-button"
                    >
                      {w.review}
                      <span className="studio-sr-only">
                        {w.reviewLabel(
                          editionDate(locale, release.date),
                          editionPlace(locale, release.country),
                        )}
                      </span>
                    </Link>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
        {total > releases.length ? (
          <p className="studio-hint">{w.showing(releases.length, total)}</p>
        ) : null}
      </section>
      <p className="studio-hint">{w.source}</p>
    </StudioFrame>
  );
}
