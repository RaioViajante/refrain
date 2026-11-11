import type { InterfaceLocale } from "@/i18n/locales";
import { studioWords } from "@/i18n/studio";
import {
  PHOTO_MODIFICATIONS,
  photoCreditCaption,
  type ArtistPhoto,
  type PhotoLicense,
} from "@/integrations/wikimedia-commons";

import { Icon } from "./icons";
import { PhotoImage } from "./photo-image";

// An artist's photograph (M3.3): the approved V4.4 4:5 frame (`.art.pt`) with
// its fallback underneath, the chosen Wikimedia Commons thumbnail over it once
// loaded, and the attribution the license asks for. Presentational only, with
// no administrative control, so a public artist page could reuse it when one
// is approved; today it appears in the studio alone.
//
// Every address here was rebuilt by the Catalog from the stored file name
// (src/integrations/wikimedia-commons/photo.ts) or comes from the fixed
// license table: nothing from a provider response is rendered, and the
// credit is plain text, which React escapes. Images are requested without a
// referrer, and the frame keeps its size whether or not the image arrives;
// an image that fails is removed (./photo-image.tsx).

export function PhotoFrame({
  locale,
  image,
  name,
  label,
  size = 150,
  fluid = false,
}: {
  locale: InterfaceLocale;
  image?: { src: string; srcSet: string } | null;
  /** The artist's name, for the frame's label. */
  name: string;
  /**
   * The label of a candidate, which may not show the artist at all: it is
   * named by its file, never presented as a photograph of them.
   */
  label?: string;
  /** The frame's largest width, in CSS pixels. */
  size?: number;
  /** Fill the containing column instead (a grid sets the width). */
  fluid?: boolean;
}) {
  const w = studioWords(locale).photograph;
  return (
    <div
      className="studio-photo"
      role="img"
      aria-label={label ?? (image ? w.of(name) : w.noneOf(name))}
      style={fluid ? undefined : { width: `min(100%, ${size}px)` }}
    >
      {/* Under an image, the fallback says only that it is not shown: there
          is a photograph, and it did not load. */}
      <span aria-hidden>{image || label ? w.notShown : w.noneYet}</span>
      {image ? (
        <PhotoImage
          key={image.src}
          src={image.src}
          srcSet={image.srcSet}
          sizes={`${size}px`}
        />
      ) : null}
    </div>
  );
}

/**
 * A row's thumbnail in the Studio's Artists list: the person mark, and the
 * chosen photograph over it in the 4:5 portrait of the photo frame. An
 * owner-approved extension of V4.4 (docs/design-system.md). Decorative, because
 * the row's title names the artist; with no photograph, or if it fails, the
 * mark remains.
 */
export function ArtistThumb({
  image,
}: {
  image?: { src: string; srcSet: string } | null;
}) {
  return (
    <span
      className="studio-thumb studio-thumb-portrait"
      data-bare
      aria-hidden="true"
    >
      <Icon name="artist" size={26} />
      {image ? (
        <PhotoImage
          key={image.src}
          src={image.src}
          srcSet={image.srcSet}
          sizes="56px"
        />
      ) : null}
    </span>
  );
}

/**
 * The credit as a caption: the credit, after "Photo: " in the page's
 * language unless the credit already names itself a photograph (the rule of
 * `photoCreditCaption`, shared with the public artist page since M3.5). The
 * credit is the file's own words, unchanged.
 */
export function creditCaption(locale: InterfaceLocale, credit: string): string {
  return photoCreditCaption(credit) === credit
    ? credit
    : `${studioWords(locale).photograph.captionPrefix}${credit}`;
}

/** The license's name, linked to its deed when it has one. */
export function LicenseName({
  locale,
  license,
}: {
  locale: InterfaceLocale;
  license: PhotoLicense;
}) {
  return license.url ? (
    <a href={license.url} className="studio-link" rel="noreferrer license">
      {license.name}
    </a>
  ) : (
    <>{studioWords(locale).photograph.licenseAsMarked(license.name)}</>
  );
}

/**
 * The credit under a photograph, and a disclosure with everything an
 * attribution needs: the work, its creator, its source, its license, and the
 * changes Refrain makes.
 */
export function PhotoAttribution({
  locale,
  photo,
}: {
  locale: InterfaceLocale;
  photo: ArtistPhoto;
}) {
  const w = studioWords(locale).photograph;
  // Refrain's own changes are one fixed English sentence: interface copy,
  // said in the page's language. Anything else is shown as stored, in
  // English.
  const standardChanges = photo.modifications === PHOTO_MODIFICATIONS;
  return (
    <div className="studio-photo-attribution">
      <p className="studio-photo-credit">
        {creditCaption(locale, photo.credit)} ·{" "}
        <LicenseName locale={locale} license={photo.license} />
        {w.viaCommons}
      </p>
      <details className="studio-photo-details">
        <summary>{w.details}</summary>
        <dl className="studio-facts">
          <dt>{w.work}</dt>
          <dd>
            <a href={photo.sourceUrl} className="studio-link" rel="noreferrer">
              {photo.title}
            </a>
          </dd>
          <dt>{w.credit}</dt>
          <dd>{photo.credit}</dd>
          <dt>{w.source}</dt>
          <dd>
            {w.sourceCommons}
            <a href={photo.sourceUrl} className="studio-link" rel="noreferrer">
              {w.filePage}
            </a>
          </dd>
          <dt>{w.license}</dt>
          <dd>
            <LicenseName locale={locale} license={photo.license} />
            {photo.license.shareAlike ? w.shareAlike : null}
          </dd>
          <dt>{w.changes}</dt>
          <dd lang={standardChanges ? undefined : "en"}>
            {standardChanges ? w.standardChanges : photo.modifications}
          </dd>
        </dl>
      </details>
    </div>
  );
}
