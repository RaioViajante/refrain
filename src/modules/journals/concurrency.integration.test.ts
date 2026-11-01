import { eq } from "drizzle-orm";
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
import { raceAll, testAuthor, uniqueLabel, withConnections } from "@/testing";

import {
  createAlbumJournal,
  deleteAlbumJournal,
  permanentlyDeleteEntry,
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
