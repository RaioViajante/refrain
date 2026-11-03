import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import { getDb, schema, type DatabaseExecutor, type Transaction } from "@/db";
import {
  isArtistOnPublicPage,
  lockArtistPublicExposure,
  previewPublication,
  PublicationError,
  publishLanguageVersion,
  type PublishPreview,
} from "@/modules/publication";
import {
  createTestAlbum,
  createTestAlbumJournal,
  createTestArtist,
  inRollbackTransaction,
  testAuthor,
  uniqueLabel,
  withConnections,
} from "@/testing";
import {
  GRACE_ARTIST_PHOTO,
  setTestArtistPhoto,
} from "@/testing/public-artists";
import { PHOTO } from "@/testing/wikimedia-fixtures";

import { archiveArtist, updateAlbum, updateArtist } from "./commands";
import { removeArtistPhoto } from "./photos";
import { getArtist } from "./queries";

// The artist pages a publication would open (M3.5, the owner's review of PR
// #46; proposed ADR 0006 A5): disclosed in the publication review, bound into
// its confirmation, and checked again under the entry lock, so any change to
// them between the review and the publication makes the confirmation stale.
// On real PostgreSQL; everything is rolled back except the lock test, which
// commits and removes its own rows.

const author = testAuthor();

function preview(db: DatabaseExecutor, entryId: string) {
  return previewPublication(db, author, { entryId, locale: "en" });
}

function publishWith(
  db: DatabaseExecutor,
  entryId: string,
  reviewed: PublishPreview,
) {
  return publishLanguageVersion(db, author, {
    entryId,
    locale: "en",
    expectedVersion: reviewed.disclosure.entryVersion,
    confirmation: reviewed.confirmation,
  });
}

async function failureOf(work: Promise<unknown>) {
  try {
    await work;
  } catch (error) {
    if (error instanceof PublicationError) {
      return error.failure;
    }
    throw error;
  }
  return "published";
}

/** A draft album journal crediting a new, catalog-only artist. */
async function draftWithNewArtist(tx: Transaction, label = "Opening") {
  const name = uniqueLabel(label);
  const artistId = await createTestArtist(tx, name);
  const album = await createTestAlbum(tx, { artistIds: [artistId] });
  const entryId = await createTestAlbumJournal(tx, {
    albumId: album.albumId,
    slug: `exposure-${uniqueLabel("x").slice(-8)}`,
    versions: [{ locale: "en", status: "draft", text: "[Test] words" }],
  });
  return { artistId, name, albumId: album.albumId, entryId };
}

/** A published album journal crediting a new artist: a page that exists. */
async function publicArtist(tx: Transaction, name = uniqueLabel("Public")) {
  const artistId = await createTestArtist(tx, name);
  const album = await createTestAlbum(tx, { artistIds: [artistId] });
  await createTestAlbumJournal(tx, {
    albumId: album.albumId,
    slug: `exposure-public-${uniqueLabel("x").slice(-8)}`,
    versions: [{ locale: "en", status: "published" }],
  });
  return artistId;
}

describe("the artist pages a publication review discloses", () => {
  it("lists every artist page publishing would open, with its address and photograph, and nothing else", async () => {
    await inRollbackTransaction(async (tx) => {
      const opening = await draftWithNewArtist(tx);
      await setTestArtistPhoto(tx, opening.artistId, GRACE_ARTIST_PHOTO);
      const already = await publicArtist(tx);
      const archived = await createTestArtist(tx, uniqueLabel("Archived"));
      await updateAlbum(tx, author, opening.albumId, {
        credits: [
          { artistId: opening.artistId },
          { artistId: already },
          { artistId: archived },
        ],
      });
      await tx.execute(
        sql`update artists set archived_at = now() where id = ${archived}`,
      );

      const reviewed = await preview(tx, opening.entryId);
      expect(reviewed.disclosure.artistPages).toEqual([
        {
          artistId: opening.artistId,
          name: opening.name,
          address: expect.stringMatching(/^test-opening-[0-9a-f]{8}$/),
          photo: {
            title: PHOTO.onStage.replace(/_/g, " "),
            sha1: "a".repeat(40),
            credit: GRACE_ARTIST_PHOTO.credit,
            license: "CC BY-SA 4.0",
          },
        },
      ]);
      expect(reviewed.disclosure.artistAddressChanges).toEqual([]);

      // Publishing opens exactly that page, at that address.
      await publishWith(tx, opening.entryId, reviewed);
      expect(await isArtistOnPublicPage(tx, opening.artistId)).toBe(true);
      const { publicArtistAddresses } =
        await import("@/modules/publication/queries");
      expect((await publicArtistAddresses(tx)).get(opening.artistId)).toBe(
        reviewed.disclosure.artistPages[0]!.address,
      );
      expect(await isArtistOnPublicPage(tx, archived)).toBe(false);
    });
  });

  it("lists nothing when the journal is public already, or the album credits no new artist", async () => {
    await inRollbackTransaction(async (tx) => {
      const opening = await draftWithNewArtist(tx);
      await publishWith(
        tx,
        opening.entryId,
        await preview(tx, opening.entryId),
      );
      // A second journal about the same album: its artists have a page.
      const second = await createTestAlbumJournal(tx, {
        albumId: opening.albumId,
        slug: `exposure-second-${uniqueLabel("x").slice(-8)}`,
        versions: [{ locale: "en", status: "draft", text: "[Test] words" }],
      });
      expect((await preview(tx, second)).disclosure.artistPages).toEqual([]);
    });
  });

  it("names the public page whose address a namesake would change", async () => {
    await inRollbackTransaction(async (tx) => {
      const name = uniqueLabel("Namesake");
      const existing = await publicArtist(tx, name);
      const opening = await draftWithNewArtist(tx);
      await updateArtist(tx, author, opening.artistId, { name });
      const reviewed = await preview(tx, opening.entryId);
      const base = name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");
      expect(reviewed.disclosure.artistPages[0]!.address).toMatch(
        new RegExp(`^${base}-[0-9a-f]{10}$`),
      );
      expect(reviewed.disclosure.artistAddressChanges).toEqual([
        {
          artistId: existing,
          name,
          from: base,
          to: expect.stringMatching(new RegExp(`^${base}-[0-9a-f]{10}$`)),
        },
      ]);
    });
  });
});

describe("a rename of a public artist (audit, the owner's review of PR #46)", () => {
  it("moves the page to the new name's address at once; the old address answers as an unknown one", async () => {
    await inRollbackTransaction(async (tx) => {
      const { publicArtistAddresses, resolvePublicArtistAddress } =
        await import("@/modules/publication/queries");
      const artistId = await publicArtist(tx);
      const before = (await publicArtistAddresses(tx)).get(artistId)!;
      const renamed = uniqueLabel("Renamed");
      await updateArtist(tx, author, artistId, { name: renamed });
      const after = (await publicArtistAddresses(tx)).get(artistId)!;
      expect(after).not.toBe(before);
      expect((await resolvePublicArtistAddress(tx, after)).outcome).toBe(
        "found",
      );
      expect((await resolvePublicArtistAddress(tx, before)).outcome).toBe(
        "not_found",
      );

      // Renamed into a public namesake: both pages take suffixed addresses,
      // and neither keeps the bare name.
      const other = await publicArtist(tx);
      await updateArtist(tx, author, other, { name: renamed });
      const both = await publicArtistAddresses(tx);
      expect(both.get(artistId)).toMatch(new RegExp(`^${after}-[0-9a-f]{10}$`));
      expect(both.get(other)).toMatch(new RegExp(`^${after}-[0-9a-f]{10}$`));
      expect((await resolvePublicArtistAddress(tx, after)).outcome).toBe(
        "not_found",
      );
    });
  });
});

describe("a confirmation is stale after any change to the artist pages it disclosed", () => {
  const changes: [
    string,
    (
      tx: Transaction,
      opening: Awaited<ReturnType<typeof draftWithNewArtist>>,
    ) => Promise<void>,
  ][] = [
    [
      "the artist renamed (the name and the address)",
      (tx, opening) =>
        updateArtist(tx, author, opening.artistId, {
          name: uniqueLabel("Renamed"),
        }),
    ],
    [
      "another artist credited on the album",
      async (tx, opening) => {
        const other = await createTestArtist(tx, uniqueLabel("Other"));
        await updateAlbum(tx, author, opening.albumId, {
          credits: [{ artistId: opening.artistId }, { artistId: other }],
        });
      },
    ],
    [
      "the artist's credit removed",
      async (tx, opening) => {
        const other = await createTestArtist(tx, uniqueLabel("Other"));
        await updateAlbum(tx, author, opening.albumId, {
          credits: [{ artistId: other }],
        });
      },
    ],
    [
      "a photograph chosen for the artist",
      (tx, opening) =>
        setTestArtistPhoto(tx, opening.artistId, GRACE_ARTIST_PHOTO),
    ],
    [
      "the artist archived",
      (tx, opening) => archiveArtist(tx, author, opening.artistId),
    ],
    [
      "the artist given a page by another publication",
      async (tx, opening) => {
        const album = await createTestAlbum(tx, {
          artistIds: [opening.artistId],
        });
        await createTestAlbumJournal(tx, {
          albumId: album.albumId,
          slug: `exposure-elsewhere-${uniqueLabel("x").slice(-8)}`,
          versions: [{ locale: "en", status: "published" }],
        });
      },
    ],
    [
      "a public namesake appearing",
      async (tx, opening) => {
        const [row] = await tx
          .select({ name: schema.artists.name })
          .from(schema.artists)
          .where(sql`id = ${opening.artistId}`);
        await publicArtist(tx, row!.name);
      },
    ],
  ];

  it.each(changes)("%s", async (_, change) => {
    await inRollbackTransaction(async (tx) => {
      const opening = await draftWithNewArtist(tx);
      const reviewed = await preview(tx, opening.entryId);
      expect(reviewed.disclosure.artistPages).toHaveLength(1);
      await change(tx, opening);
      expect(await failureOf(publishWith(tx, opening.entryId, reviewed))).toBe(
        "confirmation_stale",
      );
      // A new review shows the new state, and its confirmation works.
      await publishWith(
        tx,
        opening.entryId,
        await preview(tx, opening.entryId),
      );
    });
  });

  it("is stale when a namesake's page goes away, which changes the disclosed address", async () => {
    await inRollbackTransaction(async (tx) => {
      const opening = await draftWithNewArtist(tx);
      const [row] = await tx
        .select({ name: schema.artists.name })
        .from(schema.artists)
        .where(sql`id = ${opening.artistId}`);
      const namesake = await publicArtist(tx, row!.name);
      const reviewed = await preview(tx, opening.entryId);
      expect(reviewed.disclosure.artistPages[0]!.address).toMatch(
        /-[0-9a-f]{10}$/,
      );
      // Archiving the namesake would give the opening page the bare name.
      await archiveArtist(tx, author, namesake);
      expect(await failureOf(publishWith(tx, opening.entryId, reviewed))).toBe(
        "confirmation_stale",
      );
    });
  });

  it("discloses a photograph that is not in the stored form as none, as the page would show it", async () => {
    await inRollbackTransaction(async (tx) => {
      const opening = await draftWithNewArtist(tx);
      await setTestArtistPhoto(tx, opening.artistId, GRACE_ARTIST_PHOTO);
      await tx.execute(sql`
        update artists set photo_url = 'https://evil.example/x.jpg'
         where id = ${opening.artistId}`);
      const reviewed = await preview(tx, opening.entryId);
      expect(reviewed.disclosure.artistPages[0]!.photo).toBeNull();
    });
  });

  it("is not stale after a change that leaves the disclosed pages as they were", async () => {
    await inRollbackTransaction(async (tx) => {
      const opening = await draftWithNewArtist(tx);
      const unrelated = await createTestArtist(tx, uniqueLabel("Unrelated"));
      const reviewed = await preview(tx, opening.entryId);
      await updateArtist(tx, author, unrelated, { name: uniqueLabel("Else") });
      expect(await publishWith(tx, opening.entryId, reviewed)).toEqual({
        changed: true,
      });
    });
  });

  it("is stale after the photograph is removed", async () => {
    await inRollbackTransaction(async (tx) => {
      const opening = await draftWithNewArtist(tx);
      await setTestArtistPhoto(tx, opening.artistId, GRACE_ARTIST_PHOTO);
      const reviewed = await preview(tx, opening.entryId);
      const detail = await getArtist(tx, author, opening.artistId);
      await removeArtistPhoto(tx, author, {
        artistId: opening.artistId,
        expectedPhoto: detail!.photo.state,
      });
      expect(await failureOf(publishWith(tx, opening.entryId, reviewed))).toBe(
        "confirmation_stale",
      );
    });
  });
});

describe("a rename or an archive while a publication holds the journal", () => {
  const created: {
    artistIds: string[];
    albumIds: string[];
    entryIds: string[];
  } = { artistIds: [], albumIds: [], entryIds: [] };

  afterAll(async () => {
    const db = getDb();
    for (const id of created.entryIds) {
      await db.execute(sql`delete from entry_slugs where entry_id = ${id}`);
      await db.execute(sql`delete from entries where id = ${id}`);
    }
    for (const id of created.albumIds) {
      await db.execute(sql`delete from albums where id = ${id}`);
    }
    for (const id of created.artistIds) {
      await db.execute(sql`delete from artists where id = ${id}`);
    }
  });

  it("waits for it: the artist's share locks block the publication's lock, and the reverse", async () => {
    const db = getDb();
    const [artist] = await db
      .insert(schema.artists)
      .values({ name: uniqueLabel("Held name"), kind: "person" })
      .returning({ id: schema.artists.id });
    created.artistIds.push(artist!.id);
    const [album] = await db
      .insert(schema.albums)
      .values({ title: uniqueLabel("Held album") })
      .returning({ id: schema.albums.id });
    created.albumIds.push(album!.id);
    await db
      .insert(schema.albumArtists)
      .values({ albumId: album!.id, artistId: artist!.id, position: 1 });
    const [entry] = await db
      .insert(schema.entries)
      .values({ kind: "album_journal" })
      .returning({ id: schema.entries.id });
    created.entryIds.push(entry!.id);
    await db
      .insert(schema.entryTexts)
      .values({ entryId: entry!.id, locale: "en", isOriginal: true });
    await db
      .insert(schema.albumJournals)
      .values({ entryId: entry!.id, albumId: album!.id });

    await withConnections(2, async ([first, second]) => {
      let release!: () => void;
      const held = new Promise<void>((resolve) => (release = resolve));
      let locked!: () => void;
      const isLocked = new Promise<void>((resolve) => (locked = resolve));
      // What a rename or an archive holds before it writes.
      const rename = first!.transaction(async (tx) => {
        await lockArtistPublicExposure(tx, artist!.id);
        locked();
        await held;
      });
      await Promise.race([isLocked, rename]);
      let outcome = "granted";
      try {
        outcome = await second!
          .transaction(async (tx) => {
            await tx.execute(sql`set local lock_timeout = '300ms'`);
            await tx.execute(
              sql`select id from entries where id = ${entry!.id} for update`,
            );
          })
          .then(
            () => "granted",
            (error: unknown) =>
              (error as { cause?: { code?: string } }).cause?.code ??
              String(error),
          );
      } finally {
        release();
      }
      await rename;
      // The lock a publication takes is not granted while it is held.
      expect(outcome).toBe("55P03");
    });
    // A real rename and a real archive, each started while a stand-in for
    // a publication holds the journal: each is seen waiting, and completes
    // after it.
    for (const command of [
      (executor: DatabaseExecutor) =>
        updateArtist(executor, author, artist!.id, {
          name: uniqueLabel("Renamed"),
        }),
      (executor: DatabaseExecutor) =>
        archiveArtist(executor, author, artist!.id),
    ]) {
      await withConnections(2, async ([first, second]) => {
        const pid = (
          await second!.execute<{ pid: number }>(
            sql`select pg_backend_pid() as pid`,
          )
        ).rows[0]!.pid;
        let release!: () => void;
        const held = new Promise<void>((resolve) => (release = resolve));
        let locked!: () => void;
        const isLocked = new Promise<void>((resolve) => (locked = resolve));
        const publication = first!.transaction(async (tx) => {
          await tx.execute(
            sql`select id from entries where id = ${entry!.id} for update`,
          );
          locked();
          await held;
        });
        await Promise.race([isLocked, publication]);
        const change = command(second!).then(
          () => "done",
          (error: unknown) => String(error),
        );
        let waited = false;
        try {
          for (let tries = 0; tries < 100 && !waited; tries++) {
            const found = await db.execute<{ n: number }>(sql`
              select count(*)::int as n from pg_stat_activity
               where pid = ${pid} and wait_event_type = 'Lock'`);
            waited = found.rows[0]!.n > 0;
            if (!waited) {
              await new Promise((resolve) => setTimeout(resolve, 50));
            }
          }
        } finally {
          release();
        }
        await publication;
        expect(waited).toBe(true);
        expect(await change).toBe("done");
      });
    }
  });
});
