import type { PublicArtistPhoto } from "@/modules/publication/public";

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
}: Readonly<{ name: string; photo: PublicArtistPhoto | null }>) {
  return (
    <PublicPhotoFrame
      name={name}
      image={photo ? { src: photo.src, srcSet: photo.srcSet } : null}
    />
  );
}

function LicenseName({
  license,
}: Readonly<{ license: PublicArtistPhoto["license"] }>) {
  return license.url ? (
    <a
      className="public-link-inline"
      href={license.url}
      rel="license noreferrer"
    >
      {license.name}
    </a>
  ) : (
    <>{license.name} (as marked on Wikimedia Commons)</>
  );
}

/**
 * The credit under the photograph, discreet, and a disclosure with everything
 * an attribution needs: the work and a link to it, its creator, its source,
 * its license and a link to it, and the changes Refrain makes.
 */
export function ArtistPhotoCredit({
  photo,
}: Readonly<{ photo: PublicArtistPhoto }>) {
  return (
    <div className="pa-credit">
      <p className="pa-credit-line">
        <span className="pa-credit-by">{photo.caption}</span>
        <span className="pa-credit-license">
          <LicenseName license={photo.license} /> · via Wikimedia Commons
        </span>
      </p>
      <details className="pa-credit-details">
        <summary>
          Photo details
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
          <dt>Photograph</dt>
          <dd>
            <a
              className="public-link-inline"
              href={photo.sourceUrl}
              rel="noreferrer"
            >
              {photo.title}
            </a>
          </dd>
          <dt>Credit</dt>
          <dd>{photo.credit}</dd>
          {/* The work above links to its file's page, which is the source. */}
          <dt>Source</dt>
          <dd>Wikimedia Commons</dd>
          <dt>License</dt>
          <dd>
            <LicenseName license={photo.license} />
            {photo.license.shareAlike ? (
              <span className="pa-credit-note">
                Adaptations must use the same license.
              </span>
            ) : null}
          </dd>
          <dt>Changes</dt>
          <dd>{photo.modifications}</dd>
        </dl>
      </details>
    </div>
  );
}
