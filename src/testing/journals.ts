import { randomUUID } from "node:crypto";

import type { Locale, Transaction } from "@/db";

import {
  createTestAlbum,
  createTestAlbumJournal,
  type TestVersion,
} from "./fixtures";

/**
 * An album journal with a reference edition of `trackCount` tracks, for tests
 * of reflections and confirmed saves. Every title and text is labelled
 * "[Test]". It has a current slug, so it can be published through the real
 * checked command (`publishForTest`).
 */
export async function createTestJournal(
  tx: Transaction,
  options: {
    trackCount?: number;
    versions?: TestVersion[];
    ratingHalfSteps?: number | null;
  } = {},
) {
  const { trackCount = 3, versions = [{ locale: "en" }] } = options;
  const album = await createTestAlbum(tx, {
    title: "[Test] Journal album",
    trackTitles: Array.from(
      { length: trackCount },
      (_, index) => `[Test] Track ${index + 1}`,
    ),
  });
  const entryId = await createTestAlbumJournal(tx, {
    albumId: album.albumId,
    versions,
    slug: `test-${randomUUID().slice(0, 8)}`,
    ratingHalfSteps: options.ratingHalfSteps ?? null,
  });
  return {
    entryId,
    ...album,
    locales: versions.map((v) => v.locale as Locale),
  };
}
