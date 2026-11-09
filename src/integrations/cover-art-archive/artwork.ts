// Album artwork from the Cover Art Archive: the one form Refrain stores, and
// the only image addresses it ever renders. Pure functions, no network.
//
// The catalog stores a cover as `albums.cover_url` =
//   https://coverartarchive.org/release/<release MBID>/<image id>
// with `albums.cover_source` = "Cover Art Archive". The address names the
// exact release and image the author chose, which is the provenance, and it
// never follows a later change of a release's "front" image. Anything else
// in those columns (another host, a path, a query, a size) is not artwork:
// `coverArtworkOf` returns null and the page shows its fallback. Image
// addresses are always built here from the two validated parts, never copied
// from a provider response or from the database.
//
// Thumbnails (250, 500, and 1200 pixels) are documented at
// https://musicbrainz.org/doc/Cover_Art_Archive/API and were checked live over
// HTTPS (docs/evidence/m3-2.md). The archive redirects to archive.org hosts,
// which the Content-Security-Policy allows (next.config.ts, src/proxy.ts).

export const COVER_ART_ARCHIVE_ORIGIN = "https://coverartarchive.org";
export const COVER_ART_SOURCE = "Cover Art Archive";

/** The image hosts a cover request may reach, for `img-src`. */
export const COVER_IMAGE_HOSTS = [
  "https://coverartarchive.org",
  "https://archive.org",
  "https://*.archive.org",
] as const;

const MBID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
// The archive's image ids are integers, stored as decimal digits.
const IMAGE_ID = "[1-9][0-9]{0,19}";

const STORED_COVER = new RegExp(
  `^${COVER_ART_ARCHIVE_ORIGIN.replace(/\./g, "\\.")}/release/(${MBID})/(${IMAGE_ID})$`,
);

export const MBID_PATTERN = new RegExp(`^${MBID}$`);
export const IMAGE_ID_PATTERN = new RegExp(`^${IMAGE_ID}$`);

/** One chosen image: the release it belongs to and its id in the archive. */
export interface CoverReference {
  releaseId: string;
  imageId: string;
}

/** What a page needs to show a cover: built, never stored. */
export interface CoverArtwork {
  /** The 500 px thumbnail. */
  src: string;
  /** 250, 500, and 1200 px thumbnails, for `srcset`. */
  srcSet: string;
  /** The stored, canonical address (for comparisons, never for `src`). */
  coverUrl: string;
}

/**
 * A preview of a release's front cover, for the edition list: the archive's
 * own stable address for "this release's front", which needs no image id. It
 * is built from a validated identifier, never stored, and never chosen:
 * choosing a cover goes through the review, with a real image id.
 */
export function frontThumbnailFor(
  releaseId: string,
): { src: string; srcSet: string } | null {
  if (!MBID_PATTERN.test(releaseId)) {
    return null;
  }
  const base = `${COVER_ART_ARCHIVE_ORIGIN}/release/${releaseId}/front`;
  return {
    src: `${base}-250`,
    srcSet: `${base}-250 250w, ${base}-500 500w`,
  };
}

/** The canonical address to store for a chosen image, or null if invalid. */
export function canonicalCoverUrl(reference: CoverReference): string | null {
  if (
    !MBID_PATTERN.test(reference.releaseId) ||
    !IMAGE_ID_PATTERN.test(reference.imageId)
  ) {
    return null;
  }
  return `${COVER_ART_ARCHIVE_ORIGIN}/release/${reference.releaseId}/${reference.imageId}`;
}

/** The release and image named by a stored address, or null. */
export function parseCoverUrl(
  coverUrl: string | null | undefined,
): CoverReference | null {
  if (typeof coverUrl !== "string") {
    return null;
  }
  const match = STORED_COVER.exec(coverUrl);
  if (!match) {
    return null;
  }
  return { releaseId: match[1]!, imageId: match[2]! };
}

function thumbnail(reference: CoverReference, size: 250 | 500 | 1200): string {
  return `${COVER_ART_ARCHIVE_ORIGIN}/release/${reference.releaseId}/${reference.imageId}-${size}.jpg`;
}

/** The image sources for a chosen image. */
export function coverArtworkFor(
  reference: CoverReference,
): CoverArtwork | null {
  const coverUrl = canonicalCoverUrl(reference);
  if (!coverUrl) {
    return null;
  }
  return {
    src: thumbnail(reference, 500),
    srcSet: [250, 500, 1200]
      .map(
        (size) => `${thumbnail(reference, size as 250 | 500 | 1200)} ${size}w`,
      )
      .join(", "),
    coverUrl,
  };
}

/**
 * The artwork to show for an album's stored cover, or null (show the
 * fallback). Both columns must hold exactly what Refrain writes.
 */
export function coverArtworkOf(
  coverUrl: string | null | undefined,
  coverSource: string | null | undefined,
): CoverArtwork | null {
  if (coverSource !== COVER_ART_SOURCE) {
    return null;
  }
  const reference = parseCoverUrl(coverUrl);
  return reference ? coverArtworkFor(reference) : null;
}
