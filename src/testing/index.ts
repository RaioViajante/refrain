// Test support: helpers for integration tests against the disposable test
// database. Imported only by tests, never by application code.
export {
  captureDatabaseError,
  databaseErrorOf,
  expectRejected,
  inRollbackTransaction,
  SqlState,
  type DatabaseErrorShape,
} from "./database";
