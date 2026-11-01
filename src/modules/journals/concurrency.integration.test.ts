import { eq, sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import { getDb, schema } from "@/db";
import {
  createAlbum,
  createArtist,
  deleteAlbum,
  deleteArtist,
} from "@/modules/catalog";
import {
  changeEntrySlug,
  normalizeSlug,
  PublicationError,
} from "@/modules/publication";
import {
  publishForTest,
  raceAll,
  testAuthor,
  uniqueLabel,
  withConnections,
} from "@/testing";

import {
  createAlbumJournal,
  deleteAlbumJournal,
  permanentlyDeleteEntry,
  restoreAlbumJournal,
  saveAlbumJournal,
} from "./commands";
import { JournalError } from "./errors";
import { getAlbumJournal } from "./queries";

// Concurrent writes over real, separate database connections (issue #6). The
// rows are committed and removed at the end; everything is synthetic.

const author = testAuthor();
const created: { entries: string[]; albums: string[]; artists: string[] } = {
  entries: [],
  albums: [],
  artists: [],
};

afterAll(async () => {
  const db = getDb();
  for (const entryId of created.entries) {
    await deleteAlbumJournal(db, author, entryId).catch(() => undefined);
    await permanentlyDeleteEntry(db, entryId).catch(() => undefined);
  }
  for (const albumId of created.albums) {
    await deleteAlbum(author, albumId).catch(() => undefined);
  }
  for (const artistId of created.artists) {
    await deleteArtist(author, artistId).catch(() => undefined);
  }
});

async function newAlbum(title: string): Promise<string> {
  const artist = await createArtist(author, {
    name: uniqueLabel("Artist"),
    kind: "person",
  });
  created.artists.push(artist.id);
  const { id } = await createAlbum(author, {
    title,
    credits: [{ artistId: artist.id }],
  });
  created.albums.push(id);
  return id;
}

async function newJournal(albumId: string, body = "[Test] x"): Promise<string> {
  const { entryId } = await createAlbumJournal(getDb(), author, {
    albumId,
    locale: "en",
    body,
  });
  created.entries.push(entryId);
  return entryId;
}

function fulfilled<Value>(outcomes: PromiseSettledResult<Value>[]): Value[] {
  return outcomes.flatMap((o) => (o.status === "fulfilled" ? [o.value] : []));
}

function rejections(outcomes: PromiseSettledResult<unknown>[]): unknown[] {
  return outcomes.flatMap((o) => (o.status === "rejected" ? [o.reason] : []));
}

describe("creating journals at the same moment", () => {
  it("gives eight simultaneous journals eight distinct slugs, each complete", async () => {
    const title = uniqueLabel("Same title");
    const albumId = await newAlbum(title);
    const base = normalizeSlug(title);

    const outcomes = await withConnections(8, (dbs) =>
      raceAll(
        dbs.map(
          (db, index) => () =>
            createAlbumJournal(db, author, {
              albumId,
              locale: "en",
              body: `[Test] Journal ${index}`,
            }),
        ),
      ),
    );
    expect(rejections(outcomes)).toEqual([]);
    const entryIds = fulfilled(outcomes).map((result) => result.entryId);
    created.entries.push(...entryIds);
    expect(new Set(entryIds).size).toBe(8);

    const slugs = await getDb()
      .select({
        slug: schema.entrySlugs.slug,
        isCurrent: schema.entrySlugs.isCurrent,
      })
      .from(schema.entrySlugs)
      .where(eq(schema.entrySlugs.kind, "album_journal"));
    const mine = slugs.filter(
      (row) => row.slug === base || row.slug.startsWith(`${base}-`),
    );
    expect(mine.map((row) => row.slug).sort()).toEqual(
      [base, ...Array.from({ length: 7 }, (_, i) => `${base}-${i + 2}`)].sort(),
    );
    expect(mine.every((row) => row.isCurrent)).toBe(true);

    // No partial entries: each has its version, subtype row, and one current slug.
    for (const entryId of entryIds) {
      const journal = await getAlbumJournal(getDb(), author, entryId);
      expect(journal?.versions).toHaveLength(1);
      expect(journal?.slug).toMatch(new RegExp(`^${base}(-\\d+)?$`));
    }
  });

  it("settles a claim on a slug between a new journal and an explicit change without an error", async () => {
    for (let round = 0; round < 6; round++) {
      const title = uniqueLabel(`Mixed ${round}`);
      const albumId = await newAlbum(title);
      const base = normalizeSlug(title);
      const other = await newAlbum(uniqueLabel("Other"));
      const existing = await newJournal(other);

      const outcomes = await withConnections(2, (dbs) =>
        raceAll([
          () =>
            createAlbumJournal(dbs[0]!, author, {
              albumId,
              locale: "en",
              body: "[Test] new",
            }),
          () => changeEntrySlug(dbs[1]!, existing, base),
        ]),
      );
      const [create, change] = outcomes;
      expect(create?.status, `round ${round}`).toBe("fulfilled");
      created.entries.push(
        (create as PromiseFulfilledResult<{ entryId: string }>).value.entryId,
      );

      const slugOfNew = (
        await getAlbumJournal(
          getDb(),
          author,
          (create as PromiseFulfilledResult<{ entryId: string }>).value.entryId,
        )
      )?.slug;
      const slugOfExisting = (await getAlbumJournal(getDb(), author, existing))
        ?.slug;
      expect(slugOfNew).not.toBe(slugOfExisting);
      if (change?.status === "fulfilled") {
        // The change won the slug, so the new journal moved on to the next one.
        expect(slugOfExisting).toBe(base);
        expect(slugOfNew).toBe(`${base}-2`);
      } else {
        const reason = (change as PromiseRejectedResult).reason;
        expect(reason).toBeInstanceOf(PublicationError);
        expect((reason as PublicationError).failure).toBe("slug_taken");
        expect(slugOfNew).toBe(base);
      }
    }
  });
});

describe("saving a journal from two editors at the same moment", () => {
  it("lets exactly one save through and refuses the rest as version conflicts", async () => {
    const albumId = await newAlbum(uniqueLabel("Save race"));
    const entryId = await newJournal(albumId, "[Test] Original");

    const outcomes = await withConnections(5, (dbs) =>
      raceAll(
        dbs.map(
          (db, index) => () =>
            saveAlbumJournal(db, author, {
              entryId,
              expectedVersion: 1,
              body: `[Test] Editor ${index}`,
            }),
        ),
      ),
    );
    const winners = outcomes
      .map((outcome, index) => ({ outcome, index }))
      .filter(({ outcome }) => outcome.status === "fulfilled");
    expect(winners).toHaveLength(1);
    for (const reason of rejections(outcomes)) {
      expect(reason).toBeInstanceOf(JournalError);
      expect((reason as JournalError).failure).toBe("version_conflict");
    }

    // The stored text is exactly the winner's: nothing was overwritten or mixed.
    const journal = await getAlbumJournal(getDb(), author, entryId);
    expect(journal?.version).toBe(2);
    expect(journal?.body).toBe(`[Test] Editor ${winners[0]!.index}`);
  });

  it("never loses a save to a concurrent deletion, and never saves into a deleted journal", async () => {
    for (let round = 0; round < 6; round++) {
      const albumId = await newAlbum(uniqueLabel(`Delete race ${round}`));
      const entryId = await newJournal(albumId, "[Test] Before");
      const outcomes = await withConnections(2, (dbs) =>
        raceAll([
          () =>
            saveAlbumJournal(dbs[0]!, author, {
              entryId,
              expectedVersion: 1,
              body: "[Test] After",
            }),
          () => deleteAlbumJournal(dbs[1]!, author, entryId),
        ]),
      );
      const [save, remove] = outcomes;
      expect(remove?.status, `round ${round}`).toBe("fulfilled");
      const journal = await getAlbumJournal(getDb(), author, entryId);
      expect(journal?.deletedAt).toBeInstanceOf(Date);
      if (save?.status === "fulfilled") {
        // The save happened before the deletion, and is kept in the deleted journal.
        expect(journal?.body).toBe("[Test] After");
        expect(journal?.version).toBe(2);
      } else {
        const reason = (save as PromiseRejectedResult).reason;
        expect(reason).toBeInstanceOf(JournalError);
        expect((reason as JournalError).failure).toBe("entry_deleted");
        expect(journal?.body).toBe("[Test] Before");
        expect(journal?.version).toBe(1);
      }
    }
  });
});

describe("patches saved from two editors at the same moment", () => {
  it("lets one opening-only save through, and never touches the body", async () => {
    const albumId = await newAlbum(uniqueLabel("Patch race"));
    const entryId = await newJournal(
      albumId,
      "[Test] The words that must stay",
    );
    const outcomes = await withConnections(4, (dbs) =>
      raceAll(
        dbs.map(
          (db, index) => () =>
            saveAlbumJournal(db, author, {
              entryId,
              expectedVersion: 1,
              opening: `[Test] Opening ${index}`,
            }),
        ),
      ),
    );
    expect(outcomes.filter((o) => o.status === "fulfilled")).toHaveLength(1);
    for (const reason of rejections(outcomes)) {
      expect((reason as JournalError).failure).toBe("version_conflict");
    }
    const journal = await getAlbumJournal(getDb(), author, entryId);
    expect(journal?.body).toBe("[Test] The words that must stay");
    expect(journal?.version).toBe(2);
  });
});

// A journal that was published, then moved to Recently deleted: the state a
// restore starts from. Committed, so several connections can race on it.
async function newDeletedPublishedJournal(albumId: string): Promise<string> {
  const db = getDb();
  const entryId = await newJournal(albumId, "[Test] Once published");
  await publishForTest(db, entryId, "en");
  await deleteAlbumJournal(db, author, entryId);
  return entryId;
}

async function storedState(entryId: string) {
  const result = await getDb().execute<{
    deleted: boolean;
    status: string;
    published_at: string | null;
    first_published_at: string | null;
    entry_first_published_at: string | null;
    body_text: string;
    version: number;
  }>(sql`
    select e.deleted_at is not null as deleted, t.status, t.published_at,
           t.first_published_at,
           e.first_published_at as entry_first_published_at,
           t.body_text, e.version
      from entries e join entry_texts t on t.entry_id = e.id
     where e.id = ${entryId}`);
  return result.rows[0];
}

describe("restoring journals at the same moment", () => {
  it("lets exactly one of eight simultaneous restores win; the others are told it is not deleted", async () => {
    const albumId = await newAlbum(uniqueLabel("Restore race"));
    const entryId = await newDeletedPublishedJournal(albumId);
    const before = await storedState(entryId);
    expect(before).toMatchObject({ deleted: true, status: "published" });

    const outcomes = await withConnections(8, (dbs) =>
      raceAll(dbs.map((db) => () => restoreAlbumJournal(db, author, entryId))),
    );

    const winners = fulfilled(outcomes);
    expect(winners).toEqual([{ madePrivate: ["en"] }]);
    const losses = rejections(outcomes);
    expect(losses).toHaveLength(7);
    for (const loss of losses) {
      expect(loss).toBeInstanceOf(JournalError);
      expect((loss as JournalError).failure).toBe("entry_not_deleted");
    }

    // One restore: live, private, and the writing and history exactly as
    // they were.
    const after = await storedState(entryId);
    expect(after).toMatchObject({
      deleted: false,
      status: "private",
      published_at: null,
      body_text: "[Test] Once published",
      version: before!.version,
    });
    expect(after!.first_published_at).toBe(before!.first_published_at);
    expect(after!.entry_first_published_at).toBe(
      before!.entry_first_published_at,
    );
  });

  it("never leaves a restored journal both live and published, whatever the order of a restore and a publication", async () => {
    const albumId = await newAlbum(uniqueLabel("Restore versus publish"));
    for (let round = 0; round < 6; round++) {
      const entryId = await newDeletedPublishedJournal(albumId);
      const outcomes = await withConnections(2, (dbs) =>
        raceAll([
          () => restoreAlbumJournal(dbs[0]!, author, entryId),
          () => publishForTest(dbs[1]!, entryId, "en"),
        ]),
      );
      const [restored, published] = outcomes;
      expect(restored?.status).toBe("fulfilled");
      const after = await storedState(entryId);
      expect(after!.deleted).toBe(false);
      if (published?.status === "fulfilled") {
        // The author's publication ran after the restore: public by choice.
        expect(after!.status).toBe("published");
      } else {
        // Refused because the entry was still deleted, with the domain's
        // fixed code. The restore alone leaves it private.
        expect(published?.reason).toBeInstanceOf(PublicationError);
        expect((published?.reason as PublicationError).failure).toBe(
          "entry_deleted",
        );
        expect(after!.status).toBe("private");
      }
    }
  });

  it("settles a restore against a permanent deletion one way or the other, never both", async () => {
    const albumId = await newAlbum(uniqueLabel("Restore versus delete now"));
    for (let round = 0; round < 6; round++) {
      const entryId = await newDeletedPublishedJournal(albumId);
      const outcomes = await withConnections(2, (dbs) =>
        raceAll([
          () => restoreAlbumJournal(dbs[0]!, author, entryId),
          () => permanentlyDeleteEntry(dbs[1]!, entryId),
        ]),
      );
      const [restored, removed] = outcomes;
      const remains = await storedState(entryId);
      if (restored?.status === "fulfilled") {
        // Restored first: the entry is live, so "Delete now" is refused.
        expect(removed?.status).toBe("rejected");
        expect(
          ((removed as PromiseRejectedResult).reason as JournalError).failure,
        ).toBe("entry_not_deleted");
        expect(remains).toMatchObject({ deleted: false, status: "private" });
      } else {
        // Deleted first: nothing is left to restore.
        expect(removed?.status).toBe("fulfilled");
        expect(
          ((restored as PromiseRejectedResult).reason as JournalError).failure,
        ).toBe("entry_not_found");
        expect(remains).toBeUndefined();
      }
    }
  });

  it("keeps the text when a restore and a save of an open editor cross", async () => {
    const albumId = await newAlbum(uniqueLabel("Restore versus save"));
    for (let round = 0; round < 6; round++) {
      const entryId = await newJournal(albumId, "[Test] Before");
      await deleteAlbumJournal(getDb(), author, entryId);
      const outcomes = await withConnections(2, (dbs) =>
        raceAll([
          () => restoreAlbumJournal(dbs[0]!, author, entryId),
          () =>
            saveAlbumJournal(dbs[1]!, author, {
              entryId,
              expectedVersion: 1,
              body: "[Test] After",
            }),
        ]),
      );
      const [restored, saved] = outcomes;
      expect(restored?.status).toBe("fulfilled");
      const after = await storedState(entryId);
      expect(after!.deleted).toBe(false);
      if (saved?.status === "fulfilled") {
        expect(after).toMatchObject({ body_text: "[Test] After", version: 2 });
      } else {
        // Saved while it was still deleted: refused, and nothing was lost.
        expect(
          ((saved as PromiseRejectedResult).reason as JournalError).failure,
        ).toBe("entry_deleted");
        expect(after).toMatchObject({ body_text: "[Test] Before", version: 1 });
      }
    }
  });
});
