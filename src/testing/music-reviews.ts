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

import {
  assessCommonsFile,
  photoPlanOf,
} from "@/integrations/wikimedia-commons";

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

/**
 * The fingerprint an artist photograph's review page carries for a fixture
 * file (M3.3), built with the same assessment and plan as the Catalog.
 */
export async function photoReview(fileName: string) {
  const { providers } = fixtureProviders();
  const { files } = await providers.wikimedia.getFiles([fileName]);
  const plan = files[0] ? photoPlanOf(assessCommonsFile(files[0])) : null;
  if (!plan) {
    throw new Error(`The fixture ${fileName} is not a usable photograph.`);
  }
  return reviewOf(plan);
}
