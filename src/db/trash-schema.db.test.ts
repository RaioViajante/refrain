import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import {
  images,
  textVersions,
  trashFiles,
  trashImageRefs,
  trashItems,
} from "@/db/schema";
import { connectTestDatabase, pgError } from "@/test/db";
import { insertImage, insertMixtape } from "@/test/fixtures";

const db = connectTestDatabase();

// The trash and text history of decision 0003: PostgreSQL itself keeps the
// 30-day limit, the shapes, and the references to live photos.

const THIRTY_DAYS = 720 * 60 * 60; // seconds

function trashItem(values: Partial<typeof trashItems.$inferInsert> = {}) {
  return db
    .insert(trashItems)
    .values({
      kind: "mixtape",
      subjectId: randomUUID(),
      label: "[Test] tape",
      payload: { title: "[Test] tape" },
      payloadVersion: 1,
      ...values,
    })
    .returning();
}

function textVersion(values: Partial<typeof textVersions.$inferInsert> = {}) {
  return db
    .insert(textVersions)
    .values({
      subject: "site_text",
      subjectKey: "home.quote",
      field: "body",
      label: "[Test] frase",
      body: "[Test] an earlier wording",
      ...values,
    })
    .returning();
}

/** Seconds between a row's start and its purge, as PostgreSQL computes it. */
async function retentionSeconds(
  table: "trash_items" | "text_versions",
  id: string,
) {
  const start = table === "trash_items" ? "deleted_at" : "replaced_at";
  const { rows } = await db.execute<{ s: string }>(
    sql`select extract(epoch from purge_after - ${sql.raw(start)})::text as s
        from ${sql.raw(table)} where id = ${id}`,
  );
  return Number(rows[0]!.s);
}

describe("trash items (PostgreSQL constraints)", () => {
  it("expire 30 days after deletion by default, on the database's clock", async () => {
    const [item] = await trashItem();
    expect(await retentionSeconds("trash_items", item!.id)).toBe(THIRTY_DAYS);
  });

  it("can never be kept longer than 30 days, nor expire before deletion", async () => {
    const deletedAt = new Date("2026-11-01T12:00:00Z");
    expect(
      await pgError(
        trashItem({
          deletedAt,
          purgeAfter: new Date(deletedAt.getTime() + (THIRTY_DAYS + 1) * 1000),
        }),
      ),
    ).toMatchObject({ code: "23514", constraint: "trash_items_retention" });
    expect(
      await pgError(trashItem({ deletedAt, purgeAfter: deletedAt })),
    ).toMatchObject({ constraint: "trash_items_retention" });
    // A carried-over item keeps the original dates, already partly elapsed.
    const [carried] = await trashItem({
      kind: "track",
      deletedAt,
      purgeAfter: new Date(deletedAt.getTime() + THIRTY_DAYS * 1000),
    });
    expect(await retentionSeconds("trash_items", carried!.id)).toBe(
      THIRTY_DAYS,
    );
  });

  it("accepts only known kinds, object snapshots, and real labels", async () => {
    expect(await pgError(trashItem({ kind: "drawing" }))).toMatchObject({
      constraint: "trash_items_kind",
    });
    for (const payload of [[1, 2], "tape", 3, sql`'null'::jsonb`]) {
      expect(
        await pgError(trashItem({ payload: payload as object })),
      ).toMatchObject({
        code: "23514",
        constraint: "trash_items_payload_object",
      });
    }
    expect(await pgError(trashItem({ payload: null }))).toMatchObject({
      code: "23502",
    });
    expect(await pgError(trashItem({ payloadVersion: 0 }))).toMatchObject({
      constraint: "trash_items_payload_version",
    });
    for (const label of ["", "x".repeat(501)]) {
      expect(await pgError(trashItem({ label }))).toMatchObject({
        constraint: "trash_items_label_length",
      });
    }
  });

  it("holds one item per deleted row of each kind", async () => {
    const subjectId = randomUUID();
    await trashItem({ subjectId });
    expect(await pgError(trashItem({ subjectId }))).toMatchObject({
      code: "23505",
      constraint: "trash_items_subject_key",
    });
    await trashItem({ subjectId, kind: "track" });
  });
});

describe("trash files (PostgreSQL constraints)", () => {
  it("take a photo's bytes exactly as stored, with the same checks", async () => {
    const photo = await insertImage(db);
    const [item] = await trashItem({ kind: "image", subjectId: photo.id });
    await db.execute(sql`
      insert into trash_files (trash_item_id, content_type, byte_size, bytes)
      select ${item!.id}, content_type, byte_size, bytes
      from image_files where image_id = ${photo.id}
    `);
    const { rows } = await db.execute<{ same: boolean }>(sql`
      select t.bytes = f.bytes as same
      from trash_files t, image_files f
      where t.trash_item_id = ${item!.id} and f.image_id = ${photo.id}
    `);
    expect(rows[0]!.same).toBe(true);

    const [other] = await trashItem({ kind: "image" });
    expect(
      await pgError(
        db.insert(trashFiles).values({
          trashItemId: other!.id,
          contentType: "image/svg+xml",
          byteSize: 3,
          bytes: Buffer.from("<s>"),
        }),
      ),
    ).toMatchObject({ constraint: "trash_files_content_type" });
    expect(
      await pgError(
        db.insert(trashFiles).values({
          trashItemId: other!.id,
          contentType: "image/png",
          byteSize: 99,
          bytes: Buffer.from("abc"),
        }),
      ),
    ).toMatchObject({ constraint: "trash_files_byte_size" });
  });

  it("go with their item when it is purged", async () => {
    const [item] = await trashItem({ kind: "image" });
    await db.insert(trashFiles).values({
      trashItemId: item!.id,
      contentType: "image/png",
      byteSize: 8,
      bytes: Buffer.from("[Test]px"),
    });
    await db.delete(trashItems).where(eq(trashItems.id, item!.id));
    expect(await db.select().from(trashFiles)).toHaveLength(0);
  });
});

describe("photos a trash item still uses (PostgreSQL constraints)", () => {
  it("cannot be deleted until the item is gone", async () => {
    const cover = await insertImage(db);
    const [item] = await trashItem();
    await db
      .insert(trashImageRefs)
      .values({ trashItemId: item!.id, imageId: cover.id });

    expect(
      await pgError(db.delete(images).where(eq(images.id, cover.id))),
    ).toMatchObject({
      code: "23503",
      constraint: "trash_image_refs_image_id_images_id_fk",
    });
    expect(
      await pgError(
        db
          .insert(trashImageRefs)
          .values({ trashItemId: item!.id, imageId: cover.id }),
      ),
    ).toMatchObject({ code: "23505" });

    // Purging the item releases the photo; the photo itself stays.
    await db.delete(trashItems).where(eq(trashItems.id, item!.id));
    expect(await db.select().from(trashImageRefs)).toHaveLength(0);
    expect(await db.select().from(images)).toHaveLength(1);
    await db.delete(images).where(eq(images.id, cover.id));
  });

  it("still cannot be deleted while a live tape uses them as well", async () => {
    const cover = await insertImage(db);
    await insertMixtape(db, { coverImageId: cover.id });
    const [item] = await trashItem();
    await db
      .insert(trashImageRefs)
      .values({ trashItemId: item!.id, imageId: cover.id });
    await db.delete(trashItems).where(eq(trashItems.id, item!.id));
    expect(
      await pgError(db.delete(images).where(eq(images.id, cover.id))),
    ).toMatchObject({ code: "23503" });
  });

  it("must exist, and must belong to an existing item", async () => {
    const [item] = await trashItem();
    expect(
      await pgError(
        db
          .insert(trashImageRefs)
          .values({ trashItemId: item!.id, imageId: randomUUID() }),
      ),
    ).toMatchObject({ code: "23503" });
    const photo = await insertImage(db);
    expect(
      await pgError(
        db
          .insert(trashImageRefs)
          .values({ trashItemId: randomUUID(), imageId: photo.id }),
      ),
    ).toMatchObject({ code: "23503" });
  });
});

describe("text versions (PostgreSQL constraints)", () => {
  it("expire 30 days after the text was replaced, and never later", async () => {
    const [version] = await textVersion();
    expect(await retentionSeconds("text_versions", version!.id)).toBe(
      THIRTY_DAYS,
    );
    const replacedAt = new Date("2026-11-01T12:00:00Z");
    expect(
      await pgError(
        textVersion({
          replacedAt,
          purgeAfter: new Date(replacedAt.getTime() + (THIRTY_DAYS + 1) * 1000),
        }),
      ),
    ).toMatchObject({ code: "23514", constraint: "text_versions_retention" });
    expect(
      await pgError(textVersion({ replacedAt, purgeAfter: replacedAt })),
    ).toMatchObject({ constraint: "text_versions_retention" });
  });

  it("pair each subject with its own fields only", async () => {
    const tape = randomUUID();
    for (const field of [
      "reflection",
      "description",
      "pull_quote",
      "pull_quote_credit",
      "detail_caption",
    ]) {
      await textVersion({ subject: "mixtape", subjectKey: tape, field });
    }
    await textVersion({
      subject: "track",
      subjectKey: randomUUID(),
      field: "note",
    });
    for (const [subject, field] of [
      ["site_text", "note"],
      ["mixtape", "body"],
      ["mixtape", "title"],
      ["track", "reflection"],
      ["drawing", "body"],
    ] as const) {
      expect(
        await pgError(
          textVersion({ subject, field, subjectKey: randomUUID() }),
        ),
      ).toMatchObject({
        code: "23514",
        constraint: "text_versions_subject_field",
      });
    }
  });

  it("name their subject by a site-text key or a lower-case id", async () => {
    for (const [subject, field, subjectKey] of [
      ["site_text", "body", "Home.Quote"],
      ["site_text", "body", "home"],
      ["mixtape", "reflection", "home.quote"],
      ["track", "note", randomUUID().toUpperCase()],
    ] as const) {
      expect(
        await pgError(textVersion({ subject, field, subjectKey })),
      ).toMatchObject({ constraint: "text_versions_subject_key" });
    }
  });

  it("keep only real wording, within the longest text allowed", async () => {
    for (const body of ["", "x".repeat(20001)]) {
      expect(await pgError(textVersion({ body }))).toMatchObject({
        constraint: "text_versions_body_length",
      });
    }
    await textVersion({ body: "x".repeat(20000) });
    for (const label of ["", "x".repeat(301)]) {
      expect(await pgError(textVersion({ label }))).toMatchObject({
        constraint: "text_versions_label_length",
      });
    }
  });
});

describe("migration 0004", () => {
  it("only adds: it creates tables and indexes and changes no existing table", () => {
    const statements = readFileSync(
      "src/db/migrations/0004_trash_and_text_history.sql",
      "utf8",
    )
      .split("--> statement-breakpoint")
      .map((s) => s.trim())
      .filter(Boolean);
    const added = new Set([
      "trash_items",
      "trash_files",
      "trash_image_refs",
      "text_versions",
    ]);
    for (const statement of statements) {
      const table =
        /^(?:CREATE TABLE|ALTER TABLE|CREATE (?:UNIQUE )?INDEX "[a-z_]+" ON) "([a-z_]+)"/.exec(
          statement,
        )?.[1];
      expect(table, statement).toBeDefined();
      expect(added.has(table!), statement).toBe(true);
      if (statement.startsWith("ALTER TABLE")) {
        expect(statement, statement).toMatch(
          /^ALTER TABLE "[a-z_]+" ADD CONSTRAINT /,
        );
      }
      // Every statement starts as above, so none deletes or updates rows.
      expect(statement).not.toMatch(/\b(DROP|RENAME|TRUNCATE)\b/);
    }
  });
});
