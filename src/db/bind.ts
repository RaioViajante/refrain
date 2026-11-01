import "server-only";

import { getDb, type DatabaseExecutor } from "./client";

/**
 * Binds a module command or query to the application's database.
 *
 * Commands take a `DatabaseExecutor` first, so tests can run them inside a
 * rolled-back transaction. Presentation code cannot import the database
 * client (docs/architecture.md, dependency rule 1), so a module exports the
 * bound form to it: the same function, without the executor argument.
 */
export function withDatabase<Args extends unknown[], Result>(
  work: (db: DatabaseExecutor, ...args: Args) => Promise<Result>,
): (...args: Args) => Promise<Result> {
  return (...args) => work(getDb(), ...args);
}
