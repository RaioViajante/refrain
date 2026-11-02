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
export {
  claimsOf,
  hkdfSha256,
  mintTestToken,
  otherSession,
  reissueTestToken,
  shiftedTestToken,
  testSecret,
  type RawClaims,
} from "./confirmation";
export { publishForTest, setPrivacyForTest } from "./publishing";
export { createTestJournal } from "./journals";
export { isSubsetWithSameValues, publicAtomsFromQueries } from "./public-atoms";
export { CHECKED_TABLES, rowChecksum } from "./checksum";
