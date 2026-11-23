// The shelf's shared rules (catalogue numbers and addresses), used both when
// a tape is created and when one is restored from the trash.
import "server-only";

import { and, eq, ne } from "drizzle-orm";

import { mixtapes } from "@/db/schema";
import type { Database } from "@/db/types";

import { StudioError } from "./errors";

/** The highest catalogue number the Studio gives a tape. */
export const MAX_NUMBER = 999;

/** `base`, or `base-2`, `base-3`… — the first address no other tape uses. */
export async function uniqueSlug(
  db: Database,
  base: string,
  exceptId?: string,
) {
  for (let n = 1; n < 100; n++) {
    const slug = n === 1 ? base : `${base}-${n}`;
    const [taken] = await db
      .select({ id: mixtapes.id })
      .from(mixtapes)
      .where(
        exceptId
          ? and(eq(mixtapes.slug, slug), ne(mixtapes.id, exceptId))
          : eq(mixtapes.slug, slug),
      )
      .limit(1);
    if (!taken) return slug;
  }
  throw new StudioError("não foi possível criar um endereço para essa fita.");
}
