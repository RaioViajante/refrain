// Test support: helpers for integration tests against the disposable test
// database. Imported only by tests, never by application code.
export {
  captureDatabaseError,
  captureFailure,
  databaseErrorOf,
  expectRejected,
  inRollbackTransaction,
  inScratchTransaction,
  rowsAdded,
  type CountedTable,
  SqlState,
  type DatabaseErrorShape,
} from "./database";
export {
  createTestAlbum,
  createTestAlbumJournal,
  createTestArtist,
  createTestArtistJournal,
  createTestMemory,
  createTestTrackReflection,
  testAuthor,
  testDocument,
  type TestAlbum,
  type TestVersion,
} from "./fixtures";
export { raceAll, uniqueLabel, withConnections } from "./concurrency";
