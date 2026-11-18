import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import type { Transaction, VisibilityStatus } from "@/db";
import {
  createTestAlbum,
  createTestMemory,
  inRollbackTransaction,
  isSubsetWithSameValues,
  publicAtomsFromQueries,
  testAuthor,
} from "@/testing";

import { unpublishLanguageVersion } from "./commands";
import { readMemoryMusic } from "./memory-music";
import { getPublicMemory, listPublicMemoryAddresses } from "./public-memory";
import { resolvePublicSlug } from "./queries";
import { publicAtoms, readEntrySurface } from "./surface";

// The public memory page's read model (M3.7) against an independent oracle of
// the publication predicate, over every state that decides visibility, and
// the module's public atoms of a memory against an account built from the
// public queries alone (ADR 0006 § 13, tests 9 and 13).

const author = testAuthor();

const STATUSES: VisibilityStatus[] = ["draft", "private", "published"];

/** The predicate, written from Security § Publication predicate. */
function oracleVisible(state: {
  deleted: boolean;
  statuses: VisibilityStatus[];
}): boolean {
  return !state.deleted && state.statuses.includes("published");
}

describe("the public memory read model, against the predicate's oracle", () => {
  const cases: { deleted: boolean; statuses: VisibilityStatus[] }[] = [];
  for (const deleted of [false, true]) {
    for (const en of STATUSES) {
      cases.push({ deleted, statuses: [en] });
      for (const pt of STATUSES) {
        cases.push({ deleted, statuses: [en, pt] });
      }
    }
  }

  it.each(cases)(
    "deleted %o: visible exactly when the oracle says",
    async (state) => {
      await inRollbackTransaction(async (tx) => {
        const slug = `test-oracle-memory`;
        const entryId = await createTestMemory(tx, {
          slug,
          versions: state.statuses.map((status, index) => ({
            locale: index === 0 ? "en" : "pt-BR",
            status,
            title: `[Test] Memory ${index}`,
          })),
          deletedAt: state.deleted
            ? new Date("2026-02-01T00:00:00Z")
            : undefined,
        });
        const visible = oracleVisible(state);
        const page = await getPublicMemory(tx, entryId, "en");
        expect(page !== null).toBe(visible);
        // The served address: the fixture marks a published slug as
        // published, exactly as a publication does.
        expect(await resolvePublicSlug(tx, "memory", slug)).toEqual(
          visible ? { outcome: "found", entryId } : { outcome: "not_found" },
        );
        expect((await listPublicMemoryAddresses(tx)).includes(slug)).toBe(
          visible,
        );
        if (page) {
          // Never a language that is not public (INV-3): English when it is
          // public, otherwise the public translation.
          const shown = state.statuses[0] === "published" ? "en" : "pt-BR";
          expect(page.locale).toBe(shown);
          expect(page.title).toBe(`[Test] Memory ${shown === "en" ? 0 : 1}`);
        }
      });
    },
  );
});

describe("a memory's public atoms", () => {
  async function published(tx: Transaction) {
    const album = await createTestAlbum(tx, {
      trackTitles: ["[Test] 1", "[Test] 2", "[Test] 3", "[Test] 4"],
    });
    const entryId = await createTestMemory(tx, {
      slug: "test-atoms-memory",
      versions: [{ locale: "en", status: "published" }],
      music: album.trackIds.slice(0, 3).map((trackId) => ({ trackId })),
    });
    await tx.execute(
      sql`update memories set remembered_when = '[Test] Then' where entry_id = ${entryId}`,
    );
    return { entryId, album };
  }

  it("match what the public queries show, in every visibility state", async () => {
    for (const status of STATUSES) {
      await inRollbackTransaction(async (tx) => {
        const { entryId } = await published(tx);
        if (status !== "published") {
          await tx.execute(sql`
            update entry_texts set status = ${status}, published_at = null
             where entry_id = ${entryId}`);
        }
        const fromModule = publicAtoms(await readEntrySurface(tx, entryId));
        const fromQueries = await publicAtomsFromQueries(tx, entryId);
        expect(new Map([...fromModule].sort()), status).toEqual(
          new Map([...fromQueries].sort()),
        );
        expect(fromModule.size > 0).toBe(status === "published");
      });
    }
  });

  it.each<
    [
      string,
      (
        tx: Transaction,
        f: { entryId: string; album: { trackIds: string[] } },
      ) => Promise<unknown>,
    ]
  >([
    [
      "a link removed from the middle, positions renumbered",
      async (tx, f) => {
        await tx.execute(sql`
          delete from memory_music
           where memory_id = ${f.entryId} and track_id = ${f.album.trackIds[1]!}`);
        await tx.execute(sql`
          update memory_music set position = position - 1
           where memory_id = ${f.entryId} and position > 2`);
      },
    ],
    [
      "every link removed",
      (tx, f) =>
        tx.execute(
          sql`delete from memory_music where memory_id = ${f.entryId}`,
        ),
    ],
    [
      "the when cleared",
      (tx, f) =>
        tx.execute(
          sql`update memories set remembered_when = null where entry_id = ${f.entryId}`,
        ),
    ],
    [
      "the memory unpublished",
      (tx, f) =>
        unpublishLanguageVersion(tx, author, f.entryId, "en", "private"),
    ],
    [
      "the memory deleted",
      (tx, f) =>
        tx.execute(
          sql`update entries set deleted_at = now() where id = ${f.entryId}`,
        ),
    ],
  ])("strictly reduce what a reader sees: %s", async (_name, removal) => {
    await inRollbackTransaction(async (tx) => {
      const fixture = await published(tx);
      const before = await publicAtomsFromQueries(tx, fixture.entryId);
      await removal(tx, fixture);
      const after = await publicAtomsFromQueries(tx, fixture.entryId);
      expect(isSubsetWithSameValues(after, before)).toBe(true);
      expect(after.size).toBeLessThan(before.size);
    });
  });

  it.each<
    [
      string,
      (
        tx: Transaction,
        f: { entryId: string; album: { trackIds: string[] } },
      ) => Promise<unknown>,
    ]
  >([
    [
      "a link added",
      (tx, f) =>
        tx.execute(sql`insert into memory_music (memory_id, position, track_id)
                        values (${f.entryId}, 4, ${f.album.trackIds[3]!})`),
    ],
    [
      "two links swapped",
      (tx, f) =>
        tx.execute(sql`update memory_music set position = case position
                                    when 1 then 2 when 2 then 1 else position end
                        where memory_id = ${f.entryId}`),
    ],
    [
      "the when changed",
      (tx, f) =>
        tx.execute(
          sql`update memories set remembered_when = '[Test] Later' where entry_id = ${f.entryId}`,
        ),
    ],
  ])("are not a reduction when %s", async (_name, change) => {
    await inRollbackTransaction(async (tx) => {
      const fixture = await published(tx);
      const before = await publicAtomsFromQueries(tx, fixture.entryId);
      await change(tx, fixture);
      const after = await publicAtomsFromQueries(tx, fixture.entryId);
      expect(isSubsetWithSameValues(after, before)).toBe(false);
    });
  });
});

describe("the public reader's music", () => {
  it("reads a memory's songs only while it is public, so a memory unpublished between two statements shows none", async () => {
    await inRollbackTransaction(async (tx) => {
      const album = await createTestAlbum(tx);
      const entryId = await createTestMemory(tx, {
        slug: "test-music-guard",
        versions: [{ locale: "en", status: "published" }],
        music: [{ trackId: album.trackIds[0]! }],
      });
      expect(
        await readMemoryMusic(tx, entryId, { onlyIfPublic: true }),
      ).toHaveLength(1);
      await unpublishLanguageVersion(tx, author, entryId, "en", "private");
      expect(
        await readMemoryMusic(tx, entryId, { onlyIfPublic: true }),
      ).toEqual([]);
      // The review reads them whatever the state.
      expect(await readMemoryMusic(tx, entryId)).toHaveLength(1);
    });
  });
});
