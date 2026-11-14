import "server-only";

import {
  coverArtworkFor,
  coverArtworkOf,
  frontThumbnailFor,
  type CoverReference,
} from "./artwork";

// The cover display switch (docs/security.md § Deployment gate, item 6; the
// design proposed in ADR 0009 § 12, PR #98). Real covers are the intended
// look of Refrain; this is the operational control over showing them: it
// authorizes covers on a server, or takes them all down. It decides whether
// any page, public or Studio, may ask a browser to fetch an album cover. It
// can only hide: it never publishes, lists, or reveals anything, and every
// public read still goes through the publication predicate.
//
// - Server-only: never a `NEXT_PUBLIC_` variable, never in a client bundle,
//   never controlled by a request.
// - Fail closed: unset, empty, or anything other than exactly `true` (so
//   `TRUE`, `1`, `yes`, and ` true` too) means off. Local development turns
//   it on in `.env.development.local`; a hosted deployment only after the
//   owner's item 6 review.
// - Read when a request is served, never at build time: Next.js inlines only
//   `NEXT_PUBLIC_` variables into a build, and the HTTP tests serve one build
//   with several values to prove it.
// - Off, it keeps the stored covers: `albums.cover_url` and its image id stay
//   as the author chose them, and nothing is cleared.
//
// These are the only exported ways to build a cover's image addresses
// (`index.ts` exports nothing else that does, and
// src/integrations/cover-art-archive/display.test.ts checks it), so no page
// can show a cover around the switch. An image id is not a licence: turning
// the switch on for a hosted deployment needs the owner's recorded item 6
// review, never only this variable.

export const COVER_DISPLAY_VARIABLE = "REFRAIN_COVER_DISPLAY_ENABLED";

type Environment = Record<string, string | undefined>;

/** Whether covers may be shown. Exactly `true` enables it. */
export function coverDisplayEnabled(env: Environment = process.env): boolean {
  return env[COVER_DISPLAY_VARIABLE] === "true";
}

/** What a page needs to show a cover: the image sources only. */
export interface DisplayedCover {
  /** The 500 px thumbnail. */
  src: string;
  /** 250, 500, and 1200 px thumbnails, for `srcset`. */
  srcSet: string;
}

function sourcesOf(
  artwork: { src: string; srcSet: string } | null,
): DisplayedCover | null {
  return artwork ? { src: artwork.src, srcSet: artwork.srcSet } : null;
}

/**
 * The image sources for an album's stored cover, or null: the switch is off,
 * or the stored value is not exactly what Refrain writes. Either way the page
 * shows its fallback frame.
 */
export function displayedCoverOf(
  coverUrl: string | null | undefined,
  coverSource: string | null | undefined,
  env: Environment = process.env,
): DisplayedCover | null {
  return coverDisplayEnabled(env)
    ? sourcesOf(coverArtworkOf(coverUrl, coverSource))
    : null;
}

/** The image sources for one chosen image, or null under the same rules. */
export function displayedCoverFor(
  reference: CoverReference,
  env: Environment = process.env,
): DisplayedCover | null {
  return coverDisplayEnabled(env)
    ? sourcesOf(coverArtworkFor(reference))
    : null;
}

/**
 * A preview of a release's front cover for the edition list, or null under
 * the same rules.
 */
export function displayedFrontThumbnailFor(
  releaseId: string,
  env: Environment = process.env,
): DisplayedCover | null {
  return coverDisplayEnabled(env) ? frontThumbnailFor(releaseId) : null;
}
