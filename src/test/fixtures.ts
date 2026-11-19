// Synthetic records for integration tests. Every text is labelled [Test];
// none is the owner's writing (AGENTS.md § 4).
import { images, mixtapes, mixtapeTracks, songs } from "@/db/schema";
import type { Database } from "@/db/types";

let sequence = 0;
const next = () => ++sequence;

export async function insertImage(
  db: Database,
  values: Partial<typeof images.$inferInsert> = {},
) {
  const n = next();
  const [row] = await db
    .insert(images)
    .values({
      url: `https://example.test/images/${n}.jpg`,
      alt: `[Test] image ${n}`,
      width: 1200,
      height: 1200,
      ...values,
    })
    .returning();
  return row!;
}

export async function insertMixtape(
  db: Database,
  values: Partial<typeof mixtapes.$inferInsert> = {},
) {
  const n = next();
  const published = values.status === "published";
  const [row] = await db
    .insert(mixtapes)
    .values({
      number: n,
      slug: `test-tape-${n}`,
      title: `[Test] tape ${n}`,
      publishedAt: published ? new Date() : null,
      ...values,
    })
    .returning();
  return row!;
}

export async function insertSong(
  db: Database,
  values: Partial<typeof songs.$inferInsert> = {},
) {
  const n = next();
  const [row] = await db
    .insert(songs)
    .values({
      title: `[Test] song ${n}`,
      artist: `[Test] artist ${n}`,
      ...values,
    })
    .returning();
  return row!;
}

export async function addTrack(
  db: Database,
  mixtapeId: string,
  songId: string,
  position: number,
  note = "",
) {
  const [row] = await db
    .insert(mixtapeTracks)
    .values({ mixtapeId, songId, position, note })
    .returning();
  return row!;
}
