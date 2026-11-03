import type {
  ArtistPhoto,
  PhotoLicense,
} from "@/integrations/wikimedia-commons";

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
  image,
  name,
  label,
  size = 150,
  fluid = false,
}: {
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
  return (
    <div
      className="studio-photo"
      role="img"
      aria-label={
        label ??
        (image ? `Photograph of ${name}` : `No photograph of ${name} yet`)
      }
      style={fluid ? undefined : { width: `min(100%, ${size}px)` }}
    >
      {/* Under an image, the fallback says only that it is not shown: there
          is a photograph, and it did not load. */}
      <span aria-hidden>
        {image || label ? "photograph not shown" : "no photograph yet"}
      </span>
      {image ? (
        <PhotoImage src={image.src} srcSet={image.srcSet} sizes={`${size}px`} />
      ) : null}
    </div>
  );
}

/**
 * The credit as a caption. A file's own attribution sometimes begins with
 * "Photo:" already; the stored credit stays exactly as the file asks, and
 * only the caption's prefix is left out, so it never reads "Photo: Photo:".
 */
export function creditCaption(credit: string): string {
  return /^(?:photo|photograph|foto)(?:\s+by)?\s*[:©]/i.test(credit)
    ? credit
    : `Photo: ${credit}`;
}

/** The license's name, linked to its deed when it has one. */
export function LicenseName({ license }: { license: PhotoLicense }) {
  return license.url ? (
    <a href={license.url} className="studio-link" rel="noreferrer license">
      {license.name}
    </a>
  ) : (
    <>{license.name} (as marked on Wikimedia Commons)</>
  );
}

/**
 * The credit under a photograph, and a disclosure with everything an
 * attribution needs: the work, its creator, its source, its license, and the
 * changes Refrain makes.
 */
export function PhotoAttribution({ photo }: { photo: ArtistPhoto }) {
  return (
    <div className="studio-photo-attribution">
      <p className="studio-photo-credit">
        {creditCaption(photo.credit)} · <LicenseName license={photo.license} />{" "}
        · via Wikimedia Commons
      </p>
      <details className="studio-photo-details">
        <summary>Photo details</summary>
        <dl className="studio-facts">
          <dt>Photograph</dt>
          <dd>
            <a href={photo.sourceUrl} className="studio-link" rel="noreferrer">
              {photo.title}
            </a>
          </dd>
          <dt>Credit</dt>
          <dd>{photo.credit}</dd>
          <dt>Source</dt>
          <dd>
            Wikimedia Commons,{" "}
            <a href={photo.sourceUrl} className="studio-link" rel="noreferrer">
              the file’s page
            </a>
          </dd>
          <dt>License</dt>
          <dd>
            <LicenseName license={photo.license} />
            {photo.license.shareAlike
              ? ". Adaptations must use the same license."
              : null}
          </dd>
          <dt>Changes</dt>
          <dd>{photo.modifications}</dd>
        </dl>
      </details>
    </div>
  );
}
