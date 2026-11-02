// The review fingerprints the studio would show for the fixture records, for
// the HTTP tests, which call the approval actions directly. Computed with the
// Catalog's own plan functions over the real adapters answering from the
// fixtures, so they are exactly what a review page would carry.
// Test support reads the module's pure plan functions, which its entry point
// does not export.
// eslint-disable-next-line no-restricted-imports
import {
  artistPlanOf,
  linkPlanOf,
  planReleaseImport,
  reviewOf,
} from "@/modules/catalog/music";

import { fixtureProviders } from "./provider-runtime";

export async function releaseReviews(releaseId: string) {
  const { providers } = fixtureProviders();
  const release = await providers.musicBrainz.getRelease(releaseId);
  const planned = planReleaseImport(release);
  return {
    review: planned.ok ? reviewOf(planned.plan) : null,
    linkReview: reviewOf(linkPlanOf(release)),
  };
}

export async function artistReview(mbArtistId: string) {
  const { providers } = fixtureProviders();
  return reviewOf(
    artistPlanOf(await providers.musicBrainz.getArtist(mbArtistId)),
  );
}
