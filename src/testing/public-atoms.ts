import { sql } from "drizzle-orm";

import type { DatabaseExecutor, Locale } from "@/db";
import {
  getPublicLanguageVersion,
  listPublicLanguageVersions,
  listPublicTrackReflections,
} from "@/modules/publication";

// An INDEPENDENT account of what a reader sees of one album journal (ADR 0006
// § 11 and § 13, tests 9 and 13), built only from the live public queries and
// sharing no code with the Publication module's own atoms. A test that
// compares the two checks the module against the queries, not against
// itself. Keys: `version|<locale>|<field>`, `reflection|<track>|<locale>|
// <field>`, and `albumRating`. Imported only by tests.

export async function publicAtomsFromQueries(
  db: DatabaseExecutor,
  entryId: string,
): Promise<Map<string, unknown>> {
  const atoms = new Map<string, unknown>();
  const versions = await listPublicLanguageVersions(db, entryId);
  for (const { locale } of versions) {
    const version = await getPublicLanguageVersion(db, entryId, locale);
    if (!version) {
      throw new Error("A listed public version could not be read.");
    }
    atoms.set(`version|${locale}|title`, version.title);
    atoms.set(`version|${locale}|opening`, version.opening);
    atoms.set(`version|${locale}|marginNote`, version.marginNote);
    atoms.set(`version|${locale}|body`, version.body);
    for (const reflection of await listPublicTrackReflections(
      db,
      entryId,
      locale as Locale,
    )) {
      const key = `reflection|${reflection.trackId}|${locale}`;
      atoms.set(`${key}|text`, reflection.body);
      atoms.set(`${key}|favourite`, reflection.isFavourite);
      atoms.set(`${key}|rating`, reflection.ratingHalfSteps);
      atoms.set(`${key}|stillWriting`, reflection.isStillWriting);
    }
  }
  if (versions.length > 0) {
    // The album rating has no public query yet. It is public with the
    // journal when some version is (ADR 0006 § 1).
    const rating = await db.execute<{ rating_half_steps: number | null }>(
      sql`select rating_half_steps from album_journals
           where entry_id = ${entryId}`,
    );
    const value = rating.rows[0]?.rating_half_steps ?? null;
    if (value !== null) {
      atoms.set("albumRating", value);
    }
  }
  return atoms;
}

/** Whether `after` shows a reader nothing that `before` did not, unchanged. */
export function isSubsetWithSameValues(
  after: Map<string, unknown>,
  before: Map<string, unknown>,
): boolean {
  return [...after].every(
    ([key, value]) =>
      before.has(key) &&
      JSON.stringify(before.get(key)) === JSON.stringify(value),
  );
}
