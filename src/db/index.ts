// Persistence module: public entry point. Server-only.
export {
  closeDb,
  getDb,
  type Database,
  type DatabaseExecutor,
  type Transaction,
} from "./client";
export { withDatabase } from "./bind";
export { DatabaseConfigError, readDatabaseUrl } from "./env";
export {
  databaseErrorOf,
  isReferencedRowRefusal,
  SqlState,
  type DatabaseErrorShape,
} from "./errors";
export { checkDatabaseConnection } from "./health";
export * as schema from "./schema";
export {
  artistKinds,
  entryKinds,
  isOneOf,
  locales,
  visibilityStatuses,
  type ArtistKind,
  type EntryKind,
  type Locale,
  type VisibilityStatus,
} from "./schema";
