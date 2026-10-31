// Persistence module: public entry point. Server-only.
export {
  closeDb,
  getDb,
  type Database,
  type DatabaseExecutor,
  type Transaction,
} from "./client";
export { checkDatabaseConnection } from "./health";
