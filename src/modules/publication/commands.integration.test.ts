import { and, eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { schema, type Locale, type Transaction } from "@/db";
import { permanentlyDeleteEntry, JournalError } from "@/modules/journals";
import {
  createTestAlbum,
  createTestAlbumJournal,
  createTestMemory,
  expectRejected,
  inRollbackTransaction,
  publishForTest,
  restrictedDeleteCode,
  SqlState,
  testAuthor,
} from "@/testing";

import {
  changeEntrySlug,
  PublicationError,
  retireEntrySlugs,
  unpublishLanguageVersion,
} from "./commands";
import { resolvePublicSlug } from "./queries";

// Integration tests of the publication commands and the ADR 0003 rules they
// rely on: publication history per language version, and retention of
// published slugs after permanent deletion. Route-level behavior (HTTP 308
// and 404) arrives with the public routes.

const { checkViolation, uniqueViolation } = SqlState;
const longAgo = new Date("2026-01-01T00:00:00Z");

async function transactionNow(tx: Transaction): Promise<Date> {
  const result = await tx.execute<{ now: string }>(
    sql`select now()::text as now`,
  );
  return new Date(result.rows[0]!.now);
}

async function version(tx: Transaction, entryId: string, locale: Locale) {
  const [row] = await tx
    .select({
      status: schema.entryTexts.status,
      publishedAt: schema.entryTexts.publishedAt,
      firstPublishedAt: schema.entryTexts.firstPublishedAt,
    })
    .from(schema.entryTexts)
    .where(
      and(
        eq(schema.entryTexts.entryId, entryId),
        eq(schema.entryTexts.locale, locale),
      ),
    );
  return row!;
}

async function entryFirstPublishedAt(tx: Transaction, entryId: string) {
  const [row] = await tx
    .select({ firstPublishedAt: schema.entries.firstPublishedAt })
    .from(schema.entries)
    .where(eq(schema.entries.id, entryId));
  return row!.firstPublishedAt;
}

async function earliestVersionPublication(tx: Transaction, entryId: string) {
  const result = await tx.execute<{ earliest: string | null }>(
    sql`select min(first_published_at)::text as earliest
          from entry_texts where entry_id = ${entryId}`,
  );
  const earliest = result.rows[0]?.earliest;
  return earliest ? new Date(earliest) : null;
}

/**
 * Sets a version's history to an earlier time, as if published long ago,
 * and (unless `versionOnly`) the entry's history with it.
 */
async function backdateFirstPublication(
  tx: Transaction,
  entryId: string,
  locale: Locale,
  { versionOnly = false } = {},
) {
  await tx
    .update(schema.entryTexts)
    .set({ firstPublishedAt: longAgo })
    .where(
      and(
        eq(schema.entryTexts.entryId, entryId),
        eq(schema.entryTexts.locale, locale),
      ),
    );
  if (!versionOnly) {
    await tx
      .update(schema.entries)
      .set({ firstPublishedAt: longAgo })
      .where(eq(schema.entries.id, entryId));
  }
}

async function slugRows(tx: Transaction, slug: string) {
  return tx
    .select({
      entryId: schema.entrySlugs.entryId,
      isCurrent: schema.entrySlugs.isCurrent,
      wasPublished: schema.entrySlugs.wasPublished,
    })
    .from(schema.entrySlugs)
    .where(eq(schema.entrySlugs.slug, slug));
}

async function softDelete(tx: Transaction, entryId: string) {
  await tx
    .update(schema.entries)
    .set({ deletedAt: sql`now()` })
    .where(eq(schema.entries.id, entryId));
}

async function draftMemory(tx: Transaction, slug = "test-memory") {
  return createTestMemory(tx, {
    versions: [{ locale: "en" }, { locale: "pt-BR", isOriginal: false }],
    slug,
  });
}

describe("publication history per language version (ADR 0003)", () => {
  it("records each version's first publication independently", async () => {
    await inRollbackTransaction(async (tx) => {
      const memoryId = await draftMemory(tx);
      const now = await transactionNow(tx);

      await publishForTest(tx, memoryId, "en");

      expect(await version(tx, memoryId, "en")).toEqual({
        status: "published",
        publishedAt: now,
        firstPublishedAt: now,
      });
      // The translation has never been published: no history.
      expect(await version(tx, memoryId, "pt-BR")).toEqual({
        status: "draft",
        publishedAt: null,
        firstPublishedAt: null,
      });
      expect(await entryFirstPublishedAt(tx, memoryId)).toEqual(now);
    });
  });

  it("keeps the entry's first publication equal to the earliest version's", async () => {
    await inRollbackTransaction(async (tx) => {
      const memoryId = await draftMemory(tx);
      await publishForTest(tx, memoryId, "en");
      // Only the version's history is older: the next publication must bring
      // the entry's first publication back to the earliest version's.
      await backdateFirstPublication(tx, memoryId, "en", { versionOnly: true });
      const now = await transactionNow(tx);
      expect(await entryFirstPublishedAt(tx, memoryId)).toEqual(now);

      // Publishing the translation later gives it its own, later history.
      await publishForTest(tx, memoryId, "pt-BR");
      expect((await version(tx, memoryId, "pt-BR")).firstPublishedAt).toEqual(
        now,
      );
      expect(await entryFirstPublishedAt(tx, memoryId)).toEqual(longAgo);
      expect(await earliestVersionPublication(tx, memoryId)).toEqual(longAgo);
    });
  });

  it("keeps the history through unpublishing and republishing", async () => {
    await inRollbackTransaction(async (tx) => {
      const memoryId = await draftMemory(tx);
      await publishForTest(tx, memoryId, "pt-BR");
      await backdateFirstPublication(tx, memoryId, "pt-BR");

      await unpublishLanguageVersion(
        tx,
        testAuthor(),
        memoryId,
        "pt-BR",
        "private",
      );
      expect(await version(tx, memoryId, "pt-BR")).toEqual({
        status: "private",
        publishedAt: null,
        firstPublishedAt: longAgo,
      });
      expect(await entryFirstPublishedAt(tx, memoryId)).toEqual(longAgo);

      const now = await transactionNow(tx);
      await publishForTest(tx, memoryId, "pt-BR");
      expect(await version(tx, memoryId, "pt-BR")).toEqual({
        status: "published",
        publishedAt: now,
        firstPublishedAt: longAgo,
      });
      expect(await entryFirstPublishedAt(tx, memoryId)).toEqual(longAgo);
    });
  });

  it("leaves an already published version unchanged when published again", async () => {
    await inRollbackTransaction(async (tx) => {
      const memoryId = await createTestMemory(tx, {
        versions: [{ locale: "en", status: "published", publishedAt: longAgo }],
        slug: "test-memory",
      });
      const before = await version(tx, memoryId, "en");
      await publishForTest(tx, memoryId, "en");
      expect(await version(tx, memoryId, "en")).toEqual(before);
    });
  });

  it("refuses transitions for deleted or missing entries and versions", async () => {
    await inRollbackTransaction(async (tx) => {
      const memoryId = await createTestMemory(tx, {
        versions: [{ locale: "en" }],
      });
      await expect(publishForTest(tx, memoryId, "pt-BR")).rejects.toMatchObject(
        { failure: "version_not_found" },
      );
      await expect(
        publishForTest(tx, "00000000-0000-4000-8000-000000000000", "en"),
      ).rejects.toMatchObject({ failure: "entry_not_found" });
      await expect(
        unpublishLanguageVersion(
          tx,
          testAuthor(),
          memoryId,
          "en",
          "published" as unknown as "private",
        ),
      ).rejects.toMatchObject({ failure: "invalid_status" });

      await softDelete(tx, memoryId);
      for (const attempt of [
        () => publishForTest(tx, memoryId, "en"),
        () =>
          unpublishLanguageVersion(tx, testAuthor(), memoryId, "en", "draft"),
        () => changeEntrySlug(tx, memoryId, "test-renamed"),
      ]) {
        await expect(attempt()).rejects.toBeInstanceOf(PublicationError);
      }
      expect(await version(tx, memoryId, "en")).toMatchObject({
        status: "draft",
        firstPublishedAt: null,
      });
    });
  });

  it("refuses to publish an entry without a current slug, changing nothing", async () => {
    await inRollbackTransaction(async (tx) => {
      const memoryId = await createTestMemory(tx, {
        versions: [{ locale: "en" }],
      });
      await expect(publishForTest(tx, memoryId, "en")).rejects.toMatchObject({
        failure: "no_current_slug",
      });
      expect(await version(tx, memoryId, "en")).toEqual({
        status: "draft",
        publishedAt: null,
        firstPublishedAt: null,
      });
      expect(await entryFirstPublishedAt(tx, memoryId)).toBeNull();
    });
  });

  it("rolls back the whole transition when one step fails", async () => {
    await inRollbackTransaction(async (tx) => {
      const memoryId = await draftMemory(tx);
      // Recorded history later than now makes the version update violate
      // entry_texts_first_published_order_check.
      await tx
        .update(schema.entryTexts)
        .set({ firstPublishedAt: new Date("2099-01-01T00:00:00Z") })
        .where(eq(schema.entryTexts.entryId, memoryId));

      const error = await publishForTest(tx, memoryId, "en").then(
        () => undefined,
        (rejection: unknown) => rejection,
      );
      expect(error).toBeDefined();
      expect((await version(tx, memoryId, "en")).status).toBe("draft");
      expect(await entryFirstPublishedAt(tx, memoryId)).toBeNull();
      expect((await slugRows(tx, "test-memory"))[0]?.wasPublished).toBe(false);
    });
  });

  it("enforces the history rules in the database", async () => {
    await inRollbackTransaction(async (tx) => {
      const memoryId = await draftMemory(tx);
      const en = and(
        eq(schema.entryTexts.entryId, memoryId),
        eq(schema.entryTexts.locale, "en"),
      );
      await expectRejected(
        tx,
        {
          code: checkViolation,
          constraint: "entry_texts_first_published_at_check",
        },
        (sp) =>
          sp
            .update(schema.entryTexts)
            .set({ status: "published", publishedAt: sql`now()` })
            .where(en),
      );
      await expectRejected(
        tx,
        {
          code: checkViolation,
          constraint: "entry_texts_first_published_order_check",
        },
        (sp) =>
          sp
            .update(schema.entryTexts)
            .set({
              status: "published",
              publishedAt: longAgo,
              firstPublishedAt: sql`now()`,
            })
            .where(en),
      );
      // An unpublished version may keep its history.
      await tx
        .update(schema.entryTexts)
        .set({ firstPublishedAt: longAgo })
        .where(en);
    });
  });
});

describe("slug retention after permanent deletion (ADR 0003)", () => {
  it("retires a published slug: reserved, detached, and unresolvable", async () => {
    await inRollbackTransaction(async (tx) => {
      const memoryId = await draftMemory(tx, "test-was-public");
      await publishForTest(tx, memoryId, "en");
      await softDelete(tx, memoryId);

      await permanentlyDeleteEntry(tx, memoryId);

      expect(await slugRows(tx, "test-was-public")).toEqual([
        { entryId: null, isCurrent: false, wasPublished: true },
      ]);
      // Only the kind and the slug remain of the entry.
      const [retired] = await tx
        .execute<Record<string, unknown>>(
          sql`select * from entry_slugs where slug = 'test-was-public'`,
        )
        .then((result) => result.rows);
      expect(Object.keys(retired!).sort()).toEqual(
        [
          "created_at",
          "entry_id",
          "is_current",
          "kind",
          "slug",
          "was_published",
        ].sort(),
      );
      expect(
        await tx.$count(
          schema.entryTexts,
          eq(schema.entryTexts.entryId, memoryId),
        ),
      ).toBe(0);

      // It answers exactly like an unknown slug...
      expect(await resolvePublicSlug(tx, "memory", "test-was-public")).toEqual(
        await resolvePublicSlug(tx, "memory", "test-never-used"),
      );
      // ...and can never be given to other writing.
      const other = await createTestMemory(tx, { slug: "test-other" });
      await expect(
        changeEntrySlug(tx, other, "test-was-public"),
      ).rejects.toMatchObject({ failure: "slug_taken" });
      await expectRejected(
        tx,
        { code: uniqueViolation, constraint: "entry_slugs_pkey" },
        (sp) => createTestMemory(sp, { slug: "test-was-public" }),
      );
    });
  });

  it("releases slugs that were never public", async () => {
    await inRollbackTransaction(async (tx) => {
      const memoryId = await draftMemory(tx, "test-never-public");
      await softDelete(tx, memoryId);
      await permanentlyDeleteEntry(tx, memoryId);

      expect(await slugRows(tx, "test-never-public")).toEqual([]);
      const reuse = await createTestMemory(tx, { slug: "test-other" });
      await changeEntrySlug(tx, reuse, "test-never-public");
      expect(await slugRows(tx, "test-never-public")).toEqual([
        { entryId: reuse, isCurrent: true, wasPublished: false },
      ]);
    });
  });

  it("keeps the published slugs and releases the others of one entry", async () => {
    await inRollbackTransaction(async (tx) => {
      const memoryId = await draftMemory(tx, "test-first");
      await publishForTest(tx, memoryId, "en");
      await changeEntrySlug(tx, memoryId, "test-second"); // public at once
      await unpublishLanguageVersion(
        tx,
        testAuthor(),
        memoryId,
        "en",
        "private",
      );
      await changeEntrySlug(tx, memoryId, "test-third"); // never public
      await softDelete(tx, memoryId);

      await permanentlyDeleteEntry(tx, memoryId);

      for (const slug of ["test-first", "test-second"]) {
        expect(await slugRows(tx, slug), slug).toEqual([
          { entryId: null, isCurrent: false, wasPublished: true },
        ]);
      }
      expect(await slugRows(tx, "test-third")).toEqual([]);
    });
  });

  it("never serves or reserves a previous slug that was never public", async () => {
    await inRollbackTransaction(async (tx) => {
      const memoryId = await draftMemory(tx, "test-a");
      await publishForTest(tx, memoryId, "en");
      await unpublishLanguageVersion(
        tx,
        testAuthor(),
        memoryId,
        "en",
        "private",
      );
      await changeEntrySlug(tx, memoryId, "test-b"); // chosen while private
      await changeEntrySlug(tx, memoryId, "test-c");
      await publishForTest(tx, memoryId, "en");

      // test-b was never a public address, so it does not become one.
      expect(await resolvePublicSlug(tx, "memory", "test-b")).toEqual({
        outcome: "not_found",
      });
      expect(await resolvePublicSlug(tx, "memory", "test-a")).toEqual({
        outcome: "redirect",
        currentSlug: "test-c",
      });

      await softDelete(tx, memoryId);
      await permanentlyDeleteEntry(tx, memoryId);
      for (const slug of ["test-a", "test-c"]) {
        expect(await slugRows(tx, slug), slug).toEqual([
          { entryId: null, isCurrent: false, wasPublished: true },
        ]);
      }
      // test-b is released and may identify other writing.
      expect(await slugRows(tx, "test-b")).toEqual([]);
      await createTestMemory(tx, { slug: "test-b" });
    });
  });

  it("serves only slugs marked as published", async () => {
    await inRollbackTransaction(async (tx) => {
      const memoryId = await createTestMemory(tx, {
        versions: [{ locale: "en", status: "published" }],
        slug: "test-unmarked",
      });
      await tx
        .update(schema.entrySlugs)
        .set({ wasPublished: false })
        .where(eq(schema.entrySlugs.entryId, memoryId));
      expect(await resolvePublicSlug(tx, "memory", "test-unmarked")).toEqual({
        outcome: "not_found",
      });

      // A redirect would reveal the current slug, so a marked previous slug
      // does not redirect to an unmarked current one either.
      await tx
        .update(schema.entrySlugs)
        .set({ isCurrent: false, wasPublished: true })
        .where(eq(schema.entrySlugs.entryId, memoryId));
      await tx.insert(schema.entrySlugs).values({
        kind: "memory",
        slug: "test-unmarked-current",
        entryId: memoryId,
        isCurrent: true,
      });
      expect(await resolvePublicSlug(tx, "memory", "test-unmarked")).toEqual({
        outcome: "not_found",
      });
    });
  });

  it("refuses to retire the slugs of an entry that is not in Recently deleted", async () => {
    await inRollbackTransaction(async (tx) => {
      const memoryId = await draftMemory(tx, "test-live");
      await publishForTest(tx, memoryId, "en");
      await expect(retireEntrySlugs(tx, memoryId)).rejects.toMatchObject({
        failure: "entry_not_deleted",
      });
      expect(await slugRows(tx, "test-live")).toEqual([
        { entryId: memoryId, isCurrent: true, wasPublished: true },
      ]);
    });
  });

  it("checks the kind of retired slugs", async () => {
    await inRollbackTransaction(async (tx) => {
      await expectRejected(
        tx,
        { code: checkViolation, constraint: "entry_slugs_kind_check" },
        (sp) =>
          sp.execute(
            sql`insert into entry_slugs (kind, slug, entry_id, is_current, was_published)
                values ('bogus', 'test-retired', null, false, true)`,
          ),
      );
    });
  });

  it("refuses to delete an entry that still owns slugs without retiring them", async () => {
    await inRollbackTransaction(async (tx) => {
      const memoryId = await draftMemory(tx);
      await expectRejected(
        tx,
        {
          code: await restrictedDeleteCode(tx),
          constraint: "entry_slugs_entry_fk",
        },
        (sp) =>
          sp.delete(schema.entries).where(eq(schema.entries.id, memoryId)),
      );
    });
  });

  it("allows only published, non-current slugs to be retired", async () => {
    await inRollbackTransaction(async (tx) => {
      await draftMemory(tx, "test-unpublished");
      const published = await draftMemory(tx, "test-published-current");
      await publishForTest(tx, published, "en");

      for (const slug of ["test-unpublished", "test-published-current"]) {
        await expectRejected(
          tx,
          { code: checkViolation, constraint: "entry_slugs_retired_check" },
          (sp) =>
            sp
              .update(schema.entrySlugs)
              .set({ entryId: null })
              .where(eq(schema.entrySlugs.slug, slug)),
        );
      }
    });
  });

  it("permanently deletes only entries already in Recently deleted", async () => {
    await inRollbackTransaction(async (tx) => {
      const memoryId = await draftMemory(tx);
      await expect(permanentlyDeleteEntry(tx, memoryId)).rejects.toMatchObject({
        failure: "entry_not_deleted",
      });
      await expect(
        permanentlyDeleteEntry(tx, "00000000-0000-4000-8000-000000000000"),
      ).rejects.toBeInstanceOf(JournalError);
      expect(
        await tx.$count(schema.entries, eq(schema.entries.id, memoryId)),
      ).toBe(1);
    });
  });
});

describe("slug changes and redirects (ADR 0002, D7.4 and D7.5)", () => {
  it("changes a never-published slug freely, releasing the old one", async () => {
    await inRollbackTransaction(async (tx) => {
      const memoryId = await draftMemory(tx, "test-draft-name");
      await changeEntrySlug(tx, memoryId, "test-better-name");
      expect(await slugRows(tx, "test-draft-name")).toEqual([]);
      expect(await slugRows(tx, "test-better-name")).toEqual([
        { entryId: memoryId, isCurrent: true, wasPublished: false },
      ]);
    });
  });

  it("keeps a published URL as a redirect while the destination is public", async () => {
    await inRollbackTransaction(async (tx) => {
      const memoryId = await draftMemory(tx, "test-old");
      await publishForTest(tx, memoryId, "en");
      await changeEntrySlug(tx, memoryId, "test-new");

      expect(await slugRows(tx, "test-new")).toEqual([
        { entryId: memoryId, isCurrent: true, wasPublished: true },
      ]);
      expect(await resolvePublicSlug(tx, "memory", "test-old")).toEqual({
        outcome: "redirect",
        currentSlug: "test-new",
      });

      // The destination stops being public: the old URL stops redirecting.
      await unpublishLanguageVersion(
        tx,
        testAuthor(),
        memoryId,
        "en",
        "private",
      );
      expect(await resolvePublicSlug(tx, "memory", "test-old")).toEqual({
        outcome: "not_found",
      });
      expect(await resolvePublicSlug(tx, "memory", "test-new")).toEqual({
        outcome: "not_found",
      });

      // Republished, it redirects again.
      await publishForTest(tx, memoryId, "pt-BR");
      expect(await resolvePublicSlug(tx, "memory", "test-old")).toEqual({
        outcome: "redirect",
        currentSlug: "test-new",
      });
    });
  });

  it("marks a slug chosen while unpublished as published only once it is", async () => {
    await inRollbackTransaction(async (tx) => {
      const memoryId = await draftMemory(tx, "test-old");
      await publishForTest(tx, memoryId, "en");
      await unpublishLanguageVersion(tx, testAuthor(), memoryId, "en", "draft");
      await changeEntrySlug(tx, memoryId, "test-new");
      expect((await slugRows(tx, "test-new"))[0]?.wasPublished).toBe(false);

      await publishForTest(tx, memoryId, "en");
      expect((await slugRows(tx, "test-new"))[0]?.wasPublished).toBe(true);
    });
  });

  it("marks a previous, never-public slug as published when it returns while public", async () => {
    await inRollbackTransaction(async (tx) => {
      const memoryId = await draftMemory(tx, "test-a");
      await publishForTest(tx, memoryId, "en");
      await unpublishLanguageVersion(
        tx,
        testAuthor(),
        memoryId,
        "en",
        "private",
      );
      await changeEntrySlug(tx, memoryId, "test-b"); // chosen while private
      await changeEntrySlug(tx, memoryId, "test-c");
      await publishForTest(tx, memoryId, "en");
      expect((await slugRows(tx, "test-b"))[0]?.wasPublished).toBe(false);

      await changeEntrySlug(tx, memoryId, "test-b");
      expect(await slugRows(tx, "test-b")).toEqual([
        { entryId: memoryId, isCurrent: true, wasPublished: true },
      ]);
    });
  });

  it("returns to the entry's own previous slug, and refuses other entries' slugs", async () => {
    await inRollbackTransaction(async (tx) => {
      const { albumId } = await createTestAlbum(tx);
      const memoryId = await draftMemory(tx, "test-a");
      await publishForTest(tx, memoryId, "en");
      await changeEntrySlug(tx, memoryId, "test-b");
      await changeEntrySlug(tx, memoryId, "test-a");

      expect(await resolvePublicSlug(tx, "memory", "test-a")).toEqual({
        outcome: "found",
        entryId: memoryId,
      });
      expect(await resolvePublicSlug(tx, "memory", "test-b")).toEqual({
        outcome: "redirect",
        currentSlug: "test-a",
      });

      const other = await draftMemory(tx, "test-other");
      await expect(changeEntrySlug(tx, other, "test-b")).rejects.toMatchObject({
        failure: "slug_taken",
      });
      await expect(
        changeEntrySlug(tx, other, "Not A Slug"),
      ).rejects.toMatchObject({ failure: "invalid_slug" });
      // The same slug is free for another kind of entry.
      const journalId = await createTestAlbumJournal(tx, {
        albumId,
        slug: "test-journal",
      });
      await changeEntrySlug(tx, journalId, "test-b");
    });
  });
});
