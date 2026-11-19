import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import type * as schema from "./schema";

/** The application's Drizzle database, or a transaction on it. */
export type Database = NodePgDatabase<typeof schema>;
