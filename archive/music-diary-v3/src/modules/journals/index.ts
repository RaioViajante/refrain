// Journals and Reflections module: public entry point. Server-only.
//
// The Writing Studio functions are bound to the application's database and
// take the AuthorizedAuthor first. `permanentlyDeleteEntry` takes a
// DatabaseExecutor, so presentation code cannot call it; no studio screen
// offers "Delete now" yet.
export type { Locale, VisibilityStatus } from "@/db";
export { permanentlyDeleteEntry } from "./commands";
export { JournalError, type JournalFailure } from "./errors";
export {
  MAX_BODY_LENGTH,
  MAX_MEMORY_RECORDINGS,
  MAX_MEMORY_TITLE_LENGTH,
  MAX_OPENING_LENGTH,
  MAX_REMEMBERED_WHEN_LENGTH,
  MAX_REFLECTION_LENGTH,
  type CreateAlbumJournalInput,
  type CreateMemoryInput,
  type SaveMemoryInput,
  type JournalPrivacyInput,
  type SaveAlbumJournalInput,
} from "./input";
export { textToParagraphs } from "./body";
export type {
  AlbumJournalDetail,
  TrackByTrack,
  TrackByTrackItem,
  TrackReflectionState,
  AlbumJournalProgress,
  AlbumJournalSummary,
  DeletedAlbumJournalSummary,
  JournalStatistics,
} from "./queries";
export type {
  DeletedMemorySummary,
  MemoryDetail,
  MemoryOfRecording,
  MemoryRecording,
  MemoryStatistics,
  MemorySummary,
} from "./memory-queries";
export type {
  MemoryPublicationPreview,
  MemoryPublicationReview,
  ReviewedMemoryMusic,
} from "./memory-publishing";
export type {
  PublicChangePreviewReview,
  PublicChangeReview,
  PublicationPreview,
  PublicationReview,
  ReviewedChange,
  ReviewedReflection,
  ReviewedValue,
  ReviewText,
} from "./publishing";
export {
  createAlbumJournal,
  createMemory,
  deleteAlbumJournal,
  deleteMemory,
  getMemory,
  getMemoryStatistics,
  listDeletedMemories,
  listMemories,
  listMemoriesOfRecording,
  previewMemoryPublicChange,
  previewMemoryPublication,
  publishMemoryVersion,
  restoreMemory,
  saveMemory,
  setMemoryPrivacy,
  getAlbumJournal,
  getJournalStatistics,
  getTrackByTrack,
  listAlbumJournalProgress,
  listAlbumJournals,
  listDeletedAlbumJournals,
  previewAlbumJournalPublication,
  previewAlbumJournalPublicChange,
  publishAlbumJournalVersion,
  restoreAlbumJournal,
  saveAlbumJournal,
  setAlbumJournalPrivacy,
} from "./studio";
export {
  halfStepsToStars,
  isRatingHalfSteps,
  MAX_RATING_HALF_STEPS,
  MIN_RATING_HALF_STEPS,
  starsToHalfSteps,
} from "./rating";
