import { sql, type SQL } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import type { Locale, Transaction, VisibilityStatus } from "@/db";
import {
  createTestAlbum,
  createTestAlbumJournal,
  createTestTrackReflection,
  inRollbackTransaction,
} from "@/testing";

import {
  languageVersionsWithStatus,
  publicLanguageVersions,
  publicTrackReflectionTexts,
  trackReflectionTextsWithStatus,
} from "./predicate";
import { resolvePublicSlug } from "./queries";

// The predicate was parameterized by status (ADR 0006 § 2). These tests show
// on real PostgreSQL that the live fragments still select exactly what the
// original, literal-`'published'` predicate selected, over every combination
// of the inputs that decide visibility. The original text is frozen below,
// character for character as it was before the change, so this test does not
// depend on the code it checks.

const legacyPublicLanguageVersions = sql.raw(`
  select t.entry_id, e.kind, t.locale, t.is_original, t.published_at
    from entry_texts t
    join entries e on e.id = t.entry_id
   where e.deleted_at is null
     and t.status = 'published'`);

const legacyPublicTrackReflectionTexts = sql`
  select tr.id as track_reflection_id, tr.album_journal_id, tr.track_id,
         trt.locale
    from track_reflections tr
    join track_reflection_texts trt on trt.track_reflection_id = tr.id
    join (${legacyPublicLanguageVersions}) pv
      on pv.entry_id = tr.album_journal_id
     and pv.locale = trt.locale
   where tr.is_published`;

async function rows(tx: Transaction, fragment: SQL): Promise<string[]> {
  const result = await tx.execute<Record<string, unknown>>(
    sql`select * from (${fragment}) q`,
  );
  return result.rows.map((row) => JSON.stringify(row)).sort();
}

const statuses: VisibilityStatus[] = ["draft", "private", "published"];
const ptStates: (VisibilityStatus | null)[] = [null, ...statuses];

// Reflection shapes, one track each: the flag crossed with where text exists.
const reflectionShapes = [
  { isPublished: true, texts: { en: "[Test] en", "pt-BR": "[Test] pt" } },
  { isPublished: true, texts: { en: "[Test] en" } },
  { isPublished: true, texts: { "pt-BR": "[Test] pt" } },
  { isPublished: true, texts: {} },
  { isPublished: false, texts: { en: "[Test] en", "pt-BR": "[Test] pt" } },
  { isPublished: false, texts: {} },
] as const;

/** Builds every combination, each as its own album journal; returns the ids. */
async function buildMatrix(tx: Transaction) {
  const album = await createTestAlbum(tx, {
    trackTitles: reflectionShapes.map((_, index) => `[Test] Track ${index}`),
  });
  const entries: { entryId: string; slug: string }[] = [];
  let n = 0;
  for (const deleted of [false, true]) {
    for (const en of statuses) {
      for (const pt of ptStates) {
        const slug = `matrix-${n++}`;
        const versions: {
          locale: Locale;
          isOriginal?: boolean;
          status: VisibilityStatus;
        }[] = [{ locale: "en", status: en }];
        if (pt) {
          versions.push({ locale: "pt-BR", isOriginal: false, status: pt });
        }
        const entryId = await createTestAlbumJournal(tx, {
          albumId: album.albumId,
          versions,
          slug,
          deletedAt: deleted ? new Date("2026-02-01T00:00:00Z") : undefined,
        });
        for (const [index, shape] of reflectionShapes.entries()) {
          await createTestTrackReflection(tx, {
            albumJournalId: entryId,
            albumId: album.albumId,
            trackId: album.trackIds[index]!,
            isPublished: shape.isPublished,
            texts: shape.texts,
          });
        }
        entries.push({ entryId, slug });
      }
    }
  }
  return entries;
}

describe("the parameterized predicate keeps the public visibility rules", () => {
  it("selects the same language versions as the original predicate", async () => {
    await inRollbackTransaction(async (tx) => {
      const entries = await buildMatrix(tx);
      const legacy = await rows(tx, legacyPublicLanguageVersions);
      const current = await rows(tx, publicLanguageVersions);
      expect(current).toEqual(legacy);
      // Counted by hand from the matrix, so equality is not vacuous: of 24
      // entries, the 12 that are live have a published version in 7 cases
      // (English published in 4 of them, Portuguese published in 3 more
      // language versions), and no deleted entry counts.
      const mine = new Set(entries.map((entry) => entry.entryId));
      const visible = current
        .map((row) => JSON.parse(row) as { entry_id: string })
        .filter((row) => mine.has(row.entry_id));
      expect(entries).toHaveLength(24);
      expect(visible).toHaveLength(7);
    });
  });

  it("selects the same reflection texts as the original predicate", async () => {
    await inRollbackTransaction(async (tx) => {
      const entries = await buildMatrix(tx);
      const legacy = await rows(tx, legacyPublicTrackReflectionTexts);
      const current = await rows(tx, publicTrackReflectionTexts);
      expect(current).toEqual(legacy);
      const mine = new Set(entries.map((entry) => entry.entryId));
      // Counted by hand: two flagged reflections with text in each public
      // language, in 7 public versions.
      expect(
        current
          .map((row) => JSON.parse(row) as { album_journal_id: string })
          .filter((row) => mine.has(row.album_journal_id)),
      ).toHaveLength(14);
    });
  });

  it("never selects a deleted entry, a non-published version, or an unflagged reflection", async () => {
    await inRollbackTransaction(async (tx) => {
      await buildMatrix(tx);
      const leaked = await tx.execute(sql`
        select 1
          from (${publicTrackReflectionTexts}) v
          join entries e on e.id = v.album_journal_id
          join entry_texts t on t.entry_id = v.album_journal_id
                            and t.locale = v.locale
          join track_reflections tr on tr.id = v.track_reflection_id
         where e.deleted_at is not null
            or t.status <> 'published'
            or not tr.is_published
         limit 1`);
      expect(leaked.rows).toEqual([]);
    });
  });

  it("resolves slugs exactly as the original predicate did, including history", async () => {
    await inRollbackTransaction(async (tx) => {
      const entries = await buildMatrix(tx);
      // Slug history: a previous published address, a previous address that
      // was never public, and an address that is current but never public.
      for (const [index, { entryId, slug }] of entries.entries()) {
        // Every other entry's current address was never public.
        const currentWasPublic = index % 2 === 0;
        await tx.execute(sql`
          update entry_slugs set is_current = false, was_published = true
           where entry_id = ${entryId}`);
        await tx.execute(sql`
          insert into entry_slugs (kind, slug, entry_id, is_current, was_published)
          values ('album_journal', ${slug + "-now"}, ${entryId}, true, ${currentWasPublic}),
                 ('album_journal', ${slug + "-unseen"}, ${entryId}, false, false)`);
      }
      const outcomes = { found: 0, redirect: 0, not_found: 0 };
      // The original resolution query, with the original predicate.
      for (const { entryId, slug } of entries) {
        for (const candidate of [slug, slug + "-now", slug + "-unseen"]) {
          const expected = await tx.execute<{
            entry_id: string;
            is_current: boolean;
            current_slug: string;
          }>(sql`
            select requested.entry_id, requested.is_current,
                   current_slug.slug as current_slug
              from entry_slugs requested
              join entry_slugs current_slug
                on current_slug.entry_id = requested.entry_id
               and current_slug.is_current
             where requested.kind = 'album_journal'
               and requested.slug = ${candidate}
               and requested.was_published
               and current_slug.was_published
               and exists (select 1
                             from (${legacyPublicLanguageVersions}) pv
                            where pv.entry_id = requested.entry_id)`);
          const row = expected.rows[0];
          const legacy = !row
            ? { outcome: "not_found" }
            : row.is_current
              ? { outcome: "found", entryId: row.entry_id }
              : { outcome: "redirect", currentSlug: row.current_slug };
          const actual = await resolvePublicSlug(
            tx,
            "album_journal",
            candidate,
          );
          expect(actual, `${candidate} of ${entryId}`).toEqual(legacy);
          outcomes[actual.outcome]++;
        }
      }
      // All three outcomes occur, so the comparison is not vacuous.
      expect(outcomes.found).toBeGreaterThan(0);
      expect(outcomes.redirect).toBeGreaterThan(0);
      expect(outcomes.not_found).toBeGreaterThan(0);
    });
  });

  it("selects the versions with another status only when asked, and only those", async () => {
    await inRollbackTransaction(async (tx) => {
      await buildMatrix(tx);
      for (const status of statuses) {
        const asked = await rows(tx, languageVersionsWithStatus(status));
        const expected = await tx.execute<Record<string, unknown>>(sql`
          select t.entry_id, e.kind, t.locale, t.is_original, t.published_at
            from entry_texts t
            join entries e on e.id = t.entry_id
           where e.deleted_at is null and t.status = ${status}`);
        expect(asked).toEqual(
          expected.rows.map((row) => JSON.stringify(row)).sort(),
        );
        const reflections = await rows(
          tx,
          trackReflectionTextsWithStatus(status),
        );
        const expectedReflections = await tx.execute<
          Record<string, unknown>
        >(sql`
          select tr.id as track_reflection_id, tr.album_journal_id,
                 tr.track_id, trt.locale
            from track_reflections tr
            join track_reflection_texts trt on trt.track_reflection_id = tr.id
            join entry_texts t on t.entry_id = tr.album_journal_id
                              and t.locale = trt.locale
            join entries e on e.id = tr.album_journal_id
           where tr.is_published
             and e.deleted_at is null
             and t.status = ${status}`);
        expect(reflections).toEqual(
          expectedReflections.rows.map((row) => JSON.stringify(row)).sort(),
        );
        if (status === "published") {
          expect(reflections).toEqual(
            await rows(tx, legacyPublicTrackReflectionTexts),
          );
        }
      }
    });
  });
});
