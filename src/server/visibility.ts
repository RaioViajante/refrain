// The one place that decides what the public may see (AGENTS.md § 4). Every
// public read composes these predicates; none writes its own WHERE for it.
import { and, eq, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";

import { mixtapes, siteTexts } from "@/db/schema";

/** A mixtape is public only once published. */
export const publicMixtape: SQL = eq(mixtapes.status, "published");

/** An owner's site text is public only once published. */
export const publicSiteText: SQL = eq(siteTexts.published, true);

/**
 * The join condition for an image shown on a public page: the referenced
 * image, and only if the owner confirmed the right to publish it.
 */
export function publicImageJoin(
  table: { id: PgColumn; rightsConfirmed: PgColumn },
  reference: PgColumn,
): SQL {
  return and(eq(table.id, reference), eq(table.rightsConfirmed, true))!;
}
