// Persistence module: public entry point. Server-only.
export { getDb, type Database } from "./client";
export { checkDatabaseConnection } from "./health";
