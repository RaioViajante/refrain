// Publication and Visibility module: public entry point. Server-only.
export {
  changeEntrySlug,
  PublicationError,
  reserveInitialSlug,
  restoreDeletedEntry,
  retireEntrySlugs,
  unpublishLanguageVersion,
  type PublicationFailure,
} from "./commands";
// Publishing (ADR 0006): the preview mints a confirmation token, and the
// checked command is the only way to make a language version public.
export type {
  DisclosedMusicLink,
  DisclosedReflection,
  PublishDisclosure,
} from "./disclosure";
// ADR 0013 step 3: an album page's catalog wording, as the reviews show it.
export type { CatalogPageSummary } from "./catalog-binding";
// A memory's music as the page and the review name it (M3.7).
export type { PublicMemoryArtist, PublicMemoryMusic } from "./memory-music";
export {
  previewPublication,
  publishLanguageVersion,
  type PublishPreview,
} from "./publish";
// Changes to a public journal (ADR 0006 § 5): the preview mints a
// `change_public` token, and the Journals save is gated by the others.
export {
  assertWrittenAsPredicted,
  previewPublicChange,
  requirePublicChangeConfirmation,
  verifyChangeConfirmation,
  type PublicChangePreview,
} from "./change";
export type {
  ExposureChange,
  ExposureSubject,
  MusicLinkKey,
  ProposedChange,
  ProposedReflection,
  ProposedText,
  PublicChangeDelta,
} from "./surface";
// Whether an album is on a public page, decided by the predicate, for the
// catalog's artwork guard (M3.2; ADR 0006 D5, gate G8).
// M3.5: the same for an artist's page, for the photograph guard.
export {
  artistsNewlyExposedByCredit,
  isAlbumOnPublicPage,
  isArtistOnPublicPage,
  albumHasTrackInServedMemory,
  lockAlbumCatalogChange,
  lockAlbumPublicExposure,
  lockArtistPublicExposure,
  lockArtistRestoreExposure,
  lockReleaseImport,
  lockTrackCatalogChange,
} from "./catalog-exposure";
// ADR 0013 step 3: confirmed catalog changes. The preview mints a
// `catalog_change` token; the catalog commands verify and gate with it.
export {
  catalogChangeAltersServedPages,
  previewCatalogChange,
  requireCatalogChangeConfirmation,
  verifyCatalogChangeConfirmation,
  type CatalogChangePreview,
  type CatalogChangeReview,
  type CatalogSubject,
} from "./catalog-confirmation";
export type {
  AtomChange,
  CatalogChange,
  ImpactSurface,
} from "./catalog-impact";
// ADR 0013 § 4.4: an album journal's deletion takes its album and credited
// artists after its entry lock, in the lock order (catalog-locks.ts).
export { lockAlbumJournalTransition } from "./catalog-locks";
// The publication predicate itself (./predicate) is internal: other modules
// read public data only through these functions.
export {
  getPublicLanguageVersion,
  listPublicLanguageVersions,
  listPublicTrackReflections,
  resolvePresentedJournal,
  resolvePublicSlug,
  type JournalSubject,
  type PresentedJournal,
  type PublicLanguageVersion,
  type PublicLanguageVersionSummary,
  type PublicTrackReflection,
  type SlugResolution,
} from "./queries";
export {
  isNormalizedSlug,
  MAX_SLUG_LENGTH,
  normalizeSlug,
  suffixSlug,
} from "./slug";
