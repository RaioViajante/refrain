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
  MAX_OPENING_LENGTH,
  type CreateAlbumJournalInput,
  type JournalPrivacyInput,
  type SaveAlbumJournalInput,
} from "./input";
export { textToParagraphs } from "./body";
export type {
  AlbumJournalDetail,
  AlbumJournalProgress,
  AlbumJournalSummary,
  DeletedAlbumJournalSummary,
  JournalStatistics,
} from "./queries";
export {
  createAlbumJournal,
  deleteAlbumJournal,
  getAlbumJournal,
  getJournalStatistics,
  listAlbumJournalProgress,
  listAlbumJournals,
  listDeletedAlbumJournals,
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
