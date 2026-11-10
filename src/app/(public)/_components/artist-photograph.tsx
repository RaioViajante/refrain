import type { PublicArtistPhoto } from "@/modules/publication/public";

import { dictionaryFor } from "@/i18n/dictionaries";
import type { InterfaceLocale } from "@/i18n/locales";

import { PublicPhotoFrame } from "./public-photo-image";

// An artist's photograph on the public artist page (M3.5; the V4.4 `Artist`
// screen): the fixed 4:5 frame with its hatched fallback underneath, the
// photograph the author chose in the studio over it once loaded, so nothing
// moves while it loads or if it fails, and the attribution its license asks
// for. Shown as it is: no filter, tint, or overlay; its colors are the only
// color on the page beside album covers.
//
// Every address here was rebuilt by the read model from the stored file name
// (src/integrations/wikimedia-commons/photo.ts), and the license link comes
// from Refrain's fixed license table: nothing from a provider response is
// rendered, and the credit is plain text, which React escapes. The two outbound
// links send no referrer.

/** The frame: the fallback, and the photograph over it when there is one. */
export function ArtistPhotoFrame({
  name,
  photo,
  locale,
}: Readonly<{
  name: string;
  photo: PublicArtistPhoto | null;
  locale: InterfaceLocale;
}>) {
  const t = dictionaryFor(locale).photo;
  return (
    <PublicPhotoFrame
      image={photo ? { src: photo.src, srcSet: photo.srcSet } : null}
      words={{
        shown: t.of(name),
        failed: t.unavailableNowOf(name),
        none: t.noneOf(name),
        frame: t.frame,
        notYet: t.notYet,
        unavailableNow: t.unavailableNow,
        fromCommons: t.fromCommons,
      }}
    />
  );
}

function LicenseName({
  license,
  locale,
}: Readonly<{
  license: PublicArtistPhoto["license"];
  locale: InterfaceLocale;
}>) {
  return license.url ? (
    <a
      className="public-link-inline"
      href={license.url}
      rel="license noreferrer"
    >
      {license.name}
    </a>
  ) : (
    <>{dictionaryFor(locale).photo.licenseAsMarked(license.name)}</>
  );
}

/**
 * The credit under the photograph, discreet, and a disclosure with everything
 * an attribution needs: the work and a link to it, its creator, its source,
 * its license and a link to it, and the changes Refrain makes.
 */
export function ArtistPhotoCredit({
  photo,
  locale,
}: Readonly<{ photo: PublicArtistPhoto; locale: InterfaceLocale }>) {
  const t = dictionaryFor(locale).photo;
  const english = dictionaryFor("en").photo;
  // The read model writes the caption in English: the credit, after "Photo: "
  // unless the credit already names itself a photograph. The prefix is the
  // interface's; the credit is the file's own words, unchanged.
  const caption =
    photo.caption === photo.credit
      ? photo.credit
      : `${t.captionPrefix}${photo.credit}`;
  // Refrain's own changes are stored as one fixed English sentence; it is
  // interface copy, shown in the page's language. Anything else is shown as
  // stored, marked as English.
  const standardChanges = photo.modifications === english.standardChanges;
  return (
    <div className="pa-credit">
      <p className="pa-credit-line">
        <span className="pa-credit-by">{caption}</span>
        <span className="pa-credit-license">
          <LicenseName license={photo.license} locale={locale} />
          {t.viaCommons}
        </span>
      </p>
      <details className="pa-credit-details">
        <summary>
          {t.details}
          <svg
            className="pj-chevron"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            focusable="false"
          >
            <path d="m9 6 6 6-6 6" />
          </svg>
        </summary>
        <dl>
          <dt>{t.work}</dt>
          <dd>
            <a
              className="public-link-inline"
              href={photo.sourceUrl}
              rel="noreferrer"
            >
              {photo.title}
            </a>
          </dd>
          <dt>{t.credit}</dt>
          <dd>{photo.credit}</dd>
          {/* The work above links to its file's page, which is the source. */}
          <dt>{t.source}</dt>
          <dd>{t.commons}</dd>
          <dt>{t.license}</dt>
          <dd>
            <LicenseName license={photo.license} locale={locale} />
            {photo.license.shareAlike ? (
              <span className="pa-credit-note">{t.shareAlike}</span>
            ) : null}
          </dd>
          <dt>{t.changes}</dt>
          <dd lang={standardChanges || locale === "en" ? undefined : "en"}>
            {standardChanges ? t.standardChanges : photo.modifications}
          </dd>
        </dl>
      </details>
    </div>
  );
}
