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
export {
  previewPublication,
  publishLanguageVersion,
  type PublishPreview,
} from "./publish";
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
