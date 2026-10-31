// Persistence module: public entry point. Server-only.
export {
  closeDb,
  getDb,
  type Database,
  type DatabaseExecutor,
  type Transaction,
} from "./client";
export { checkDatabaseConnection } from "./health";
export * as schema from "./schema";
export type { EntryKind, Locale, VisibilityStatus } from "./schema";
