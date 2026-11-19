// Tracklist writes that keep a tape's positions contiguous (1…n). Callers in
// the Studio authorize first; these functions only enforce data rules.
import "server-only";

import { asc, eq, sql } from "drizzle-orm";

import { mixtapeTracks } from "@/db/schema";
import type { Database } from "@/db/types";

export class TracklistError extends Error {
  override name = "TracklistError";
}

// Positions are moved above this offset before being rewritten, so the
// non-deferrable UNIQUE (mixtape_id, position) never sees two equal values.
const PARKING_OFFSET = 1_000_000;

/**
 * Reorders a tape to exactly `trackIds` (every one of its tracks, each once),
 * in one transaction. Throws TracklistError if the list is not a permutation.
 */
export async function setTrackOrder(
  db: Database,
  mixtapeId: string,
  trackIds: readonly string[],
): Promise<void> {
  await db.transaction(async (tx) => {
    const current = await tx
      .select({ id: mixtapeTracks.id })
      .from(mixtapeTracks)
      .where(eq(mixtapeTracks.mixtapeId, mixtapeId))
      .orderBy(asc(mixtapeTracks.position))
      .for("update");

    const known = new Set(current.map((t) => t.id));
    if (
      trackIds.length !== known.size ||
      new Set(trackIds).size !== trackIds.length ||
      trackIds.some((id) => !known.has(id))
    ) {
      throw new TracklistError(
        "The new order must list every track of the tape exactly once.",
      );
    }
    if (trackIds.length === 0) return;

    await tx
      .update(mixtapeTracks)
      .set({ position: sql`${mixtapeTracks.position} + ${PARKING_OFFSET}` })
      .where(eq(mixtapeTracks.mixtapeId, mixtapeId));

    const values = sql.join(
      trackIds.map((id, index) => sql`(${id}::uuid, ${index + 1}::int)`),
      sql`, `,
    );
    await tx.execute(sql`
      update ${mixtapeTracks}
      set position = ordered.position, updated_at = now()
      from (values ${values}) as ordered(id, position)
      where ${mixtapeTracks.id} = ordered.id
        and ${mixtapeTracks.mixtapeId} = ${mixtapeId}
    `);
  });
}
