// MusicBrainz integration: public entry point. Server-only.
export {
  APPLICATION_VERSION,
  createMusicBrainzClient,
  luceneTerms,
  musicBrainz,
  musicBrainzId,
  searchText,
  USER_AGENT,
  type Freshness,
  type MusicBrainzClient,
  type MusicBrainzOptions,
} from "./client";
export {
  creditText,
  MAX_RELEASES,
  MAX_RESULTS,
  type Artist,
  type ArtistResult,
  type MusicBrainzCredit,
  type Release,
  type ReleaseGroupResult,
  type ReleaseMedium,
  type ReleaseSummary,
  type ReleaseTrack,
} from "./contract";
