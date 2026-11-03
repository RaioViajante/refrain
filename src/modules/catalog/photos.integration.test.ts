import { eq, inArray, sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import { getDb, schema, type Transaction } from "@/db";
import {
  createTestAlbum,
  createTestAlbumJournal,
  createTestArtist,
  captureFailure,
  inRollbackTransaction,
  rowChecksum,
  setPrivacyForTest,
  testAuthor,
  uniqueLabel,
  withConnections,
} from "@/testing";
import {
  isArtistOnPublicPage,
  lockArtistPublicExposure,
} from "@/modules/publication";
import { FIXTURE } from "@/testing/provider-fixtures";
import { providerAnswer, providerResponse } from "@/testing/provider-mock";
import { fixtureProviders, json } from "@/testing/provider-runtime";
import {
  commonsThumbnail,
  PHOTO,
  PHOTO_SCENARIO,
  photoSha1,
} from "@/testing/wikimedia-fixtures";

import { restoreArtist, updateAlbum, updateArtist } from "./commands";
import { CatalogError } from "./errors";
import {
  listArtistPhotoChoices,
  photoStateOf,
  removeArtistPhoto,
  reviewArtistPhoto,
  setArtistPhoto,
} from "./photos";
import { getArtist } from "./queries";

// Artist photographs from Wikimedia Commons (M3.3), on real PostgreSQL, with
// the real Wikimedia adapter answering from deterministic, synthetic
// fixtures (no network). Everything is rolled back, except the concurrency
// test, which commits and removes its own rows.

const author = testAuthor();

function failureOf(error: unknown) {
  return error instanceof CatalogError ? error.failure : error;
}

async function refusal(
  tx: Transaction,
  work: (tx: Transaction) => Promise<unknown>,
) {
  return failureOf(await captureFailure(tx, work));
}

async function photoColumns(tx: Transaction, artistId: string) {
  const [row] = await tx
    .select({
      name: schema.artists.name,
      photoUrl: schema.artists.photoUrl,
      photoCredit: schema.artists.photoCredit,
      photoLicense: schema.artists.photoLicense,
      photoSourceUrl: schema.artists.photoSourceUrl,
      photoFileSha1: schema.artists.photoFileSha1,
      photoFileTimestamp: schema.artists.photoFileTimestamp,
      photoChosenAt: schema.artists.photoChosenAt,
      updatedAt: schema.artists.updatedAt,
    })
    .from(schema.artists)
    .where(eq(schema.artists.id, artistId));
  return row!;
}

async function linkedArtist(
  tx: Transaction,
  mbArtistId: string = FIXTURE.inkQuartet,
) {
  const id = await createTestArtist(tx, "[Test] Ink Quartet");
  await tx
    .update(schema.artists)
    .set({ mbArtistId })
    .where(eq(schema.artists.id, id));
  return id;
}

/** Reviews a file, as the studio's review page does. */
async function reviewed(
  tx: Transaction,
  artistId: string,
  file: string,
  providers = fixtureProviders().providers,
) {
  const review = await reviewArtistPhoto(
    tx,
    author,
    { artistId, file },
    providers,
  );
  return {
    review: review!.review!,
    expectedPhoto: review!.current.state,
  };
}

async function choose(
  tx: Transaction,
  artistId: string,
  file: string,
  providers = fixtureProviders().providers,
) {
  const { review, expectedPhoto } = await reviewed(
    tx,
    artistId,
    file,
    providers,
  );
  await setArtistPhoto(
    tx,
    author,
    { artistId, file, review, expectedPhoto },
    providers,
  );
}

describe("finding a photograph", () => {
  it("offers only usable files from a search, and counts the others", async () => {
    await inRollbackTransaction(async (tx) => {
      const artistId = await createTestArtist(tx, "[Test] Ink Quartet");
      const { providers } = fixtureProviders();
      const found = await listArtistPhotoChoices(
        tx,
        author,
        { artistId, query: "Ink Quartet" },
        providers,
      );
      expect(found!.results!.map((choice) => choice.fileName)).toEqual([
        PHOTO.onStage,
        PHOTO.portrait,
        PHOTO.attributed,
      ]);
      expect(found!.refused).toBe(8);
      expect(found!.results![0]).toMatchObject({
        title: "Test Ink Quartet on stage.jpg",
        credit: "[Test] Photographer One",
        license: { name: "CC BY-SA 4.0" },
        image: { src: commonsThumbnail(PHOTO.onStage, 330) },
      });
      expect(found!.suggestionState).toBe("not_linked");
      expect(found!.current).toMatchObject({ photo: null, state: null });
    });
  });

  it("searches nothing until words are given", async () => {
    await inRollbackTransaction(async (tx) => {
      const artistId = await createTestArtist(tx);
      const { providers, calls } = fixtureProviders();
      const found = await listArtistPhotoChoices(
        tx,
        author,
        { artistId, query: "   " },
        providers,
      );
      expect(found!.results).toBeNull();
      expect(calls).toHaveLength(0);
    });
  });

  it("suggests through Wikidata for a linked artist, without choosing anything", async () => {
    await inRollbackTransaction(async (tx) => {
      const artistId = await linkedArtist(tx);
      const before = await photoColumns(tx, artistId);
      const { providers } = fixtureProviders();
      const found = await listArtistPhotoChoices(
        tx,
        author,
        { artistId, query: "" },
        providers,
      );
      expect(found!.suggestionState).toBe("found");
      // The item's image first (its deleted second image is gone), then a
      // file that depicts it; the non-commercial one is not offered.
      expect(found!.suggestions.map((choice) => choice.fileName)).toEqual([
        PHOTO.onStage,
        PHOTO.portrait,
      ]);
      expect(found!.suggestionsRefused).toBe(1);
      expect(await photoColumns(tx, artistId)).toEqual(before);
    });
  });

  it("suggests nothing when two Wikidata items share the identifier, or none has it", async () => {
    await inRollbackTransaction(async (tx) => {
      const { providers } = fixtureProviders();
      const ambiguous = await linkedArtist(tx, FIXTURE.paperSinger);
      const unknown = await createTestArtist(tx, "[Test] Unknown");
      await tx
        .update(schema.artists)
        .set({ mbArtistId: FIXTURE.paperMoon })
        .where(eq(schema.artists.id, unknown));
      for (const artistId of [ambiguous, unknown]) {
        const found = await listArtistPhotoChoices(
          tx,
          author,
          { artistId, query: "" },
          providers,
        );
        expect(found!.suggestionState).toBe("no_item");
        expect(found!.suggestions).toEqual([]);
      }
    });
  });

  it("says when Commons cannot be reached, and when it answers outside its contract", async () => {
    await inRollbackTransaction(async (tx) => {
      const artistId = await createTestArtist(tx);
      const { providers } = fixtureProviders();
      for (const query of [
        PHOTO_SCENARIO.unavailable,
        PHOTO_SCENARIO.malformed,
      ]) {
        const found = await listArtistPhotoChoices(
          tx,
          author,
          { artistId, query },
          providers,
        );
        expect(found!.searchUnavailable).toBe(true);
        expect(found!.results).toEqual([]);
      }
      const nothing = await listArtistPhotoChoices(
        tx,
        author,
        { artistId, query: PHOTO_SCENARIO.nothing },
        providers,
      );
      expect(nothing!.results).toEqual([]);
      expect(nothing!.searchUnavailable).toBe(false);
    });
  });

  it("asks nothing more of Wikimedia for the page once it has failed", async () => {
    await inRollbackTransaction(async (tx) => {
      const artistId = await linkedArtist(tx);
      await choose(tx, artistId, PHOTO.onStage);
      const { providers, calls } = fixtureProviders(() =>
        json({}, 503, { "retry-after": "0" }),
      );
      const found = await listArtistPhotoChoices(
        tx,
        author,
        { artistId, query: "ink" },
        providers,
      );
      expect(found!.currentCheck).toBe("unavailable");
      expect(found!.suggestionState).toBe("unavailable");
      expect(found!.searchUnavailable).toBe(true);
      // One lookup and its two retries; no suggestion or search request.
      expect(calls).toHaveLength(3);
    });
  });

  it("asks nothing of Commons for an archived artist, and nothing for an unknown one", async () => {
    await inRollbackTransaction(async (tx) => {
      const artistId = await linkedArtist(tx);
      await tx
        .update(schema.artists)
        .set({ archivedAt: new Date() })
        .where(eq(schema.artists.id, artistId));
      const { providers, calls } = fixtureProviders();
      const found = await listArtistPhotoChoices(
        tx,
        author,
        { artistId, query: "ink" },
        providers,
      );
      expect(found!.artist.archived).toBe(true);
      expect(found!.results).toBeNull();
      expect(
        await listArtistPhotoChoices(
          tx,
          author,
          { artistId: "00000000-0000-4000-8000-000000000000", query: "ink" },
          providers,
        ),
      ).toBeNull();
      expect(
        await listArtistPhotoChoices(
          tx,
          author,
          { artistId: "nope", query: "" },
          providers,
        ),
      ).toBeNull();
      expect(calls).toHaveLength(0);
    });
  });
});

describe("reviewing a photograph", () => {
  it("shows the attribution and a fingerprint, and writes nothing", async () => {
    await inRollbackTransaction(async (tx) => {
      const artistId = await createTestArtist(tx);
      const before = await photoColumns(tx, artistId);
      const writing = await rowChecksum(tx);
      const review = await reviewArtistPhoto(
        tx,
        author,
        { artistId, file: "Test Ink Quartet on stage.jpg" },
        fixtureProviders().providers,
      );
      expect(review!.review).toMatch(/^[0-9a-f]{64}$/);
      expect(review!.assessment).toMatchObject({
        fileName: PHOTO.onStage,
        credit: "[Test] Photographer One",
        creator: "[Test] Photographer One",
        sourceCredit: "Own work",
        restrictions: ["personality"],
        license: { name: "CC BY-SA 4.0" },
        refusals: [],
      });
      expect(review!.isCurrent).toBe(false);
      expect(await photoColumns(tx, artistId)).toEqual(before);
      expect(await rowChecksum(tx)).toEqual(writing);
    });
  });

  it("explains a file that cannot be used, offers no fingerprint, and loads no image", async () => {
    await inRollbackTransaction(async (tx) => {
      const artistId = await createTestArtist(tx);
      for (const [file, reason] of [
        [PHOTO.unknownAuthor, "no_creator"],
        [PHOTO.nonCommercial, "unsupported_license"],
        [PHOTO.hostile, "credit_not_plain"],
      ] as const) {
        const review = await reviewArtistPhoto(
          tx,
          author,
          { artistId, file },
          fixtureProviders().providers,
        );
        expect(review!.review).toBeNull();
        expect(review!.assessment!.image).toBeNull();
        expect(review!.assessment!.refusals).toEqual([reason]);
      }
    });
  });

  it("says when Commons has no such file, and refuses a name that is not a photo file", async () => {
    await inRollbackTransaction(async (tx) => {
      const artistId = await createTestArtist(tx);
      const missing = await reviewArtistPhoto(
        tx,
        author,
        { artistId, file: PHOTO.removed },
        fixtureProviders().providers,
      );
      expect(missing!.assessment).toBeNull();
      expect(missing!.review).toBeNull();
      for (const file of ["../etc/passwd.jpg", "x.svg", "a|b.jpg", ""]) {
        expect(
          await refusal(tx, (sp) =>
            reviewArtistPhoto(
              sp,
              author,
              { artistId, file },
              fixtureProviders().providers,
            ),
          ),
        ).toBe("invalid_input");
      }
    });
  });
});

describe("choosing a photograph", () => {
  it("stores the photograph with its attribution and provenance", async () => {
    await inRollbackTransaction(async (tx) => {
      const artistId = await createTestArtist(tx);
      await tx.execute(
        sql`update artists set updated_at = now() - interval '1 day' where id = ${artistId}`,
      );
      const writing = await rowChecksum(tx);
      await choose(tx, artistId, PHOTO.onStage);
      const row = await photoColumns(tx, artistId);
      expect(row).toMatchObject({
        name: "[Test] Artist",
        photoUrl: commonsThumbnail(PHOTO.onStage, 330),
        photoCredit: "[Test] Photographer One",
        photoLicense: "CC BY-SA 4.0",
        photoSourceUrl: `https://commons.wikimedia.org/wiki/File:${PHOTO.onStage}`,
        photoFileSha1: photoSha1(PHOTO.onStage),
        photoFileTimestamp: new Date("2019-05-04T12:00:00Z"),
      });
      const [{ now }] = (await tx.execute<{ now: Date }>(sql`select now()`))
        .rows as [{ now: Date }];
      expect(row.photoChosenAt).toEqual(new Date(now));
      expect(row.updatedAt).toEqual(new Date(now));
      // Nothing authored changed.
      expect(await rowChecksum(tx)).toEqual(writing);

      const detail = await getArtist(tx, author, artistId);
      expect(detail!.photo.photo).toMatchObject({
        fileName: PHOTO.onStage,
        credit: "[Test] Photographer One",
        license: { name: "CC BY-SA 4.0" },
        modifications:
          "Resized, and cropped to fit the frame. No other changes.",
      });
      expect(detail!.photo.sha1).toBe(photoSha1(PHOTO.onStage));
      expect(detail!.photo.unreadable).toBe(false);
    });
  });

  it("stores the designated attribution, and a public-domain file's creator", async () => {
    await inRollbackTransaction(async (tx) => {
      const one = await createTestArtist(tx, "[Test] One");
      const two = await createTestArtist(tx, "[Test] Two");
      await choose(tx, one, PHOTO.attributed);
      await choose(tx, two, PHOTO.publicDomain);
      expect((await photoColumns(tx, one)).photoCredit).toBe(
        "Photo: [Test] Photographer Three / [Test] Studio Archive",
      );
      expect(await photoColumns(tx, two)).toMatchObject({
        photoCredit: "[Test] Photographer Twelve",
        photoLicense: "Public domain",
      });
    });
  });

  it("refuses a stale review: a forged fingerprint, or a file that changed since", async () => {
    await inRollbackTransaction(async (tx) => {
      const artistId = await createTestArtist(tx);
      const before = await photoColumns(tx, artistId);
      expect(
        await refusal(tx, (sp) =>
          setArtistPhoto(
            sp,
            author,
            {
              artistId,
              file: PHOTO.onStage,
              review: "0".repeat(64),
              expectedPhoto: null,
            },
            fixtureProviders().providers,
          ),
        ),
      ).toBe("review_stale");
      // A new version of the file on every lookup (the approval asks again).
      const { providers } = fixtureProviders();
      const { review } = await reviewed(
        tx,
        artistId,
        PHOTO.changing,
        providers,
      );
      expect(
        await refusal(tx, (sp) =>
          setArtistPhoto(
            sp,
            author,
            { artistId, file: PHOTO.changing, review, expectedPhoto: null },
            providers,
          ),
        ),
      ).toBe("review_stale");
      expect(await photoColumns(tx, artistId)).toEqual(before);
    });
  });

  it("asks Commons again at approval, so a cached answer is never what is written", async () => {
    await inRollbackTransaction(async (tx) => {
      const artistId = await createTestArtist(tx);
      let license = "cc-by-sa-4.0";
      const { providers, calls } = fixtureProviders((url) =>
        license === "cc-by-sa-4.0"
          ? providerResponse(url)
          : json(relicensed(url, license)),
      );
      const { review } = await reviewed(tx, artistId, PHOTO.onStage, providers);
      license = "cc-by-nc-sa-4.0";
      expect(
        await refusal(tx, (sp) =>
          setArtistPhoto(
            sp,
            author,
            { artistId, file: PHOTO.onStage, review, expectedPhoto: null },
            providers,
          ),
        ),
      ).toBe("photo_not_usable");
      expect(calls).toHaveLength(2);
      expect((await photoColumns(tx, artistId)).photoUrl).toBeNull();
    });
  });

  it("refuses an approval when a personality-rights warning was added after the review", async () => {
    await inRollbackTransaction(async (tx) => {
      const artistId = await createTestArtist(tx);
      let warned = false;
      const { providers } = fixtureProviders((url) => {
        if (!warned) {
          return providerResponse(url);
        }
        const body = structuredClone(providerAnswer(new URL(url)).body) as {
          query: {
            pages: {
              imageinfo: { extmetadata: Record<string, { value: string }> }[];
            }[];
          };
        };
        body.query.pages[0]!.imageinfo[0]!.extmetadata.Restrictions = {
          value: "personality",
        };
        return json(body);
      });
      const { review } = await reviewed(
        tx,
        artistId,
        PHOTO.portrait,
        providers,
      );
      warned = true;
      expect(
        await refusal(tx, (sp) =>
          setArtistPhoto(
            sp,
            author,
            { artistId, file: PHOTO.portrait, review, expectedPhoto: null },
            providers,
          ),
        ),
      ).toBe("review_stale");
      expect((await photoColumns(tx, artistId)).photoUrl).toBeNull();
    });
  });

  it("refuses a file Commons no longer has, and writes nothing when Commons is down", async () => {
    await inRollbackTransaction(async (tx) => {
      const artistId = await createTestArtist(tx);
      const { review } = await reviewed(tx, artistId, PHOTO.onStage);
      const gone = fixtureProviders((url) =>
        providerResponse(url.replace(PHOTO.onStage, PHOTO.removed)),
      ).providers;
      expect(
        await refusal(tx, (sp) =>
          setArtistPhoto(
            sp,
            author,
            { artistId, file: PHOTO.onStage, review, expectedPhoto: null },
            gone,
          ),
        ),
      ).toBe("provider_not_found");
      const down = fixtureProviders(() =>
        json({}, 503, { "retry-after": "0" }),
      ).providers;
      expect(
        await refusal(tx, (sp) =>
          setArtistPhoto(
            sp,
            author,
            { artistId, file: PHOTO.onStage, review, expectedPhoto: null },
            down,
          ),
        ),
      ).toBe("provider_unavailable");
      expect((await photoColumns(tx, artistId)).photoUrl).toBeNull();
    });
  });

  it("never replaces a photograph the author did not see", async () => {
    await inRollbackTransaction(async (tx) => {
      const artistId = await createTestArtist(tx);
      const stale = await reviewed(tx, artistId, PHOTO.portrait);
      await choose(tx, artistId, PHOTO.onStage);
      const after = await photoColumns(tx, artistId);
      // The review was made when there was no photograph.
      expect(stale.expectedPhoto).toBeNull();
      expect(
        await refusal(tx, (sp) =>
          setArtistPhoto(
            sp,
            author,
            { artistId, file: PHOTO.portrait, ...stale },
            fixtureProviders().providers,
          ),
        ),
      ).toBe("review_stale");
      expect(await photoColumns(tx, artistId)).toEqual(after);
      // Reviewed again, with the photograph on file, it replaces it.
      await choose(tx, artistId, PHOTO.portrait);
      expect((await photoColumns(tx, artistId)).photoLicense).toBe("CC0");
    });
  });

  it("refuses an archived artist and an unknown one, and invalid input", async () => {
    await inRollbackTransaction(async (tx) => {
      const artistId = await createTestArtist(tx);
      const { review } = await reviewed(tx, artistId, PHOTO.onStage);
      await tx
        .update(schema.artists)
        .set({ archivedAt: new Date() })
        .where(eq(schema.artists.id, artistId));
      const input = {
        artistId,
        file: PHOTO.onStage,
        review,
        expectedPhoto: null,
      };
      expect(
        await refusal(tx, (sp) =>
          setArtistPhoto(sp, author, input, fixtureProviders().providers),
        ),
      ).toBe("archived_reference");
      expect(
        await refusal(tx, (sp) =>
          setArtistPhoto(
            sp,
            author,
            { ...input, artistId: "00000000-0000-4000-8000-000000000000" },
            fixtureProviders().providers,
          ),
        ),
      ).toBe("not_found");
      for (const bad of [
        { ...input, review: "x" },
        { ...input, expectedPhoto: "x" },
        { ...input, file: "Test.gif" },
        { ...input, artistId: "nope" },
        {},
      ]) {
        expect(
          await refusal(tx, (sp) =>
            setArtistPhoto(sp, author, bad, fixtureProviders().providers),
          ),
        ).toBe("invalid_input");
      }
      expect((await photoColumns(tx, artistId)).photoUrl).toBeNull();
    });
  });

  it("keeps the photograph when the artist's details are edited, and the details when the photograph changes", async () => {
    await inRollbackTransaction(async (tx) => {
      const artistId = await createTestArtist(tx);
      await choose(tx, artistId, PHOTO.onStage);
      const photo = await photoColumns(tx, artistId);
      await updateArtist(tx, author, artistId, {
        name: "[Test] Renamed",
        sortName: "Renamed, [Test]",
      });
      const renamed = await photoColumns(tx, artistId);
      expect({
        ...renamed,
        name: photo.name,
        updatedAt: photo.updatedAt,
      }).toEqual(photo);
      // The manual form cannot write photo columns at all.
      expect(
        await refusal(tx, (sp) =>
          updateArtist(sp, author, artistId, {
            photoUrl: "https://evil.example/x.jpg",
          }),
        ),
      ).toBe("invalid_input");
      await choose(tx, artistId, PHOTO.portrait);
      expect((await photoColumns(tx, artistId)).name).toBe("[Test] Renamed");
    });
  });
});

describe("removing a photograph", () => {
  it("removes the photograph and its provenance, after the author saw it", async () => {
    await inRollbackTransaction(async (tx) => {
      const artistId = await createTestArtist(tx);
      await choose(tx, artistId, PHOTO.onStage);
      const detail = await getArtist(tx, author, artistId);
      const expectedPhoto = detail!.photo.state;
      // Cancelling a removal sends nothing; a stale one is refused.
      expect(
        await refusal(tx, (sp) =>
          removeArtistPhoto(sp, author, {
            artistId,
            expectedPhoto: "0".repeat(64),
          }),
        ),
      ).toBe("review_stale");
      expect(
        await refusal(tx, (sp) =>
          removeArtistPhoto(sp, author, { artistId, expectedPhoto: null }),
        ),
      ).toBe("review_stale");
      expect((await photoColumns(tx, artistId)).photoUrl).not.toBeNull();
      await removeArtistPhoto(tx, author, { artistId, expectedPhoto });
      expect(await photoColumns(tx, artistId)).toMatchObject({
        photoUrl: null,
        photoCredit: null,
        photoLicense: null,
        photoSourceUrl: null,
        photoFileSha1: null,
        photoFileTimestamp: null,
        photoChosenAt: null,
      });
      // Nothing to remove is not an error.
      await removeArtistPhoto(tx, author, { artistId, expectedPhoto: null });
    });
  });

  it("removes for an archived artist too, and removes values Refrain did not write", async () => {
    await inRollbackTransaction(async (tx) => {
      const artistId = await createTestArtist(tx);
      // Written by hand (psql, a restore): not the stored form.
      await tx.execute(sql`
        update artists set photo_url = 'https://evil.example/x.jpg',
          photo_credit = '<b>x</b>', photo_license = 'CC BY-NC 4.0',
          photo_source_url = 'https://evil.example/', photo_file_sha1 = ${"b".repeat(40)},
          photo_file_timestamp = now(), photo_chosen_at = now()
         where id = ${artistId}`);
      const detail = await getArtist(tx, author, artistId);
      expect(detail!.photo).toMatchObject({ photo: null, unreadable: true });
      const expectedPhoto = detail!.photo.state;
      await tx
        .update(schema.artists)
        .set({ archivedAt: new Date() })
        .where(eq(schema.artists.id, artistId));
      // Removing only takes something away: a rights holder's request does
      // not wait for a restore, and the artist stays archived.
      await removeArtistPhoto(tx, author, { artistId, expectedPhoto });
      expect((await photoColumns(tx, artistId)).photoUrl).toBeNull();
      const [row] = await tx
        .select({ archivedAt: schema.artists.archivedAt })
        .from(schema.artists)
        .where(eq(schema.artists.id, artistId));
      expect(row!.archivedAt).not.toBeNull();
    });
  });
});

describe("the photograph on file, compared with Commons", () => {
  async function stored(
    tx: Transaction,
    file: string,
    changes: Record<string, unknown> = {},
  ) {
    const artistId = await createTestArtist(tx);
    await choose(tx, artistId, PHOTO.onStage);
    await tx
      .update(schema.artists)
      .set({
        photoUrl: commonsThumbnail(file, 330),
        photoSourceUrl: `https://commons.wikimedia.org/wiki/File:${file}`,
        ...changes,
      })
      .where(eq(schema.artists.id, artistId));
    const found = await listArtistPhotoChoices(
      tx,
      author,
      { artistId, query: "" },
      fixtureProviders().providers,
    );
    return found!.currentCheck;
  }

  it("says whether it is unchanged, a new version, changed, gone, or no longer usable", async () => {
    await inRollbackTransaction(async (tx) => {
      expect(await stored(tx, PHOTO.onStage)).toBe("unchanged");
      expect(
        await stored(tx, PHOTO.onStage, { photoFileSha1: "f".repeat(40) }),
      ).toBe("new_version");
      expect(
        await stored(tx, PHOTO.onStage, {
          photoCredit: "[Test] Earlier credit",
        }),
      ).toBe("details_changed");
      expect(await stored(tx, PHOTO.removed)).toBe("missing");
      expect(await stored(tx, PHOTO.unknownAuthor)).toBe("not_usable");
    });
  });
});

describe("concurrent changes", () => {
  const created: string[] = [];

  afterAll(async () => {
    if (created.length > 0) {
      await getDb()
        .delete(schema.artists)
        .where(inArray(schema.artists.id, created));
    }
  });

  it("reads the photograph on file under the row lock, so a change committed meanwhile is seen", async () => {
    const db = getDb();
    const [artist] = await db
      .insert(schema.artists)
      .values({ name: uniqueLabel("Photographed locked"), kind: "person" })
      .returning({ id: schema.artists.id });
    const artistId = artist!.id;
    created.push(artistId);
    const { providers } = fixtureProviders();
    const review = await reviewArtistPhoto(
      db,
      author,
      { artistId, file: PHOTO.onStage },
      providers,
    );
    expect(review!.current.state).toBeNull();

    await withConnections(2, async ([holder, chooser]) => {
      let release!: () => void;
      const held = new Promise<void>((resolve) => (release = resolve));
      let locked!: () => void;
      const isLocked = new Promise<void>((resolve) => (locked = resolve));
      // Another change holds the row and writes a photograph, then commits.
      const other = holder!.transaction(async (tx) => {
        await tx.execute(
          sql`select id from artists where id = ${artistId} for no key update`,
        );
        locked();
        await held;
        await tx.execute(sql`
          update artists set photo_url = ${commonsThumbnail(PHOTO.portrait, 330)},
            photo_credit = '[Test] Photographer Two', photo_license = 'CC0',
            photo_source_url = ${`https://commons.wikimedia.org/wiki/File:${PHOTO.portrait}`},
            photo_file_sha1 = ${"2".repeat(40)},
            photo_file_timestamp = now(), photo_chosen_at = now()
           where id = ${artistId}`);
      });
      await isLocked;
      // This change was reviewed with no photograph on file. It must wait
      // for the row, then see the photograph and refuse; without the lock it
      // would read "no photograph" at once and overwrite it.
      const choosing = setArtistPhoto(
        chooser!,
        author,
        {
          artistId,
          file: PHOTO.onStage,
          review: review!.review!,
          expectedPhoto: null,
        },
        providers,
      ).then(
        () => "written",
        (error: unknown) => failureOf(error),
      );
      await new Promise((resolve) => setTimeout(resolve, 300));
      release();
      await other;
      expect(await choosing).toBe("review_stale");
    });
    const [row] = await db
      .select({ photoLicense: schema.artists.photoLicense })
      .from(schema.artists)
      .where(eq(schema.artists.id, artistId));
    expect(row!.photoLicense).toBe("CC0");
  });

  it("lets one of two changes made from the same view win, and refuses the other", async () => {
    const db = getDb();
    const [artist] = await db
      .insert(schema.artists)
      .values({ name: uniqueLabel("Photographed"), kind: "person" })
      .returning({ id: schema.artists.id });
    const artistId = artist!.id;
    created.push(artistId);

    const { providers } = fixtureProviders();
    const first = await reviewArtistPhoto(
      db,
      author,
      { artistId, file: PHOTO.onStage },
      providers,
    );
    const second = await reviewArtistPhoto(
      db,
      author,
      { artistId, file: PHOTO.portrait },
      providers,
    );
    expect(first!.current.state).toBeNull();

    const outcomes = await withConnections(2, ([one, two]) =>
      Promise.allSettled([
        setArtistPhoto(
          one!,
          author,
          {
            artistId,
            file: PHOTO.onStage,
            review: first!.review!,
            expectedPhoto: null,
          },
          providers,
        ),
        setArtistPhoto(
          two!,
          author,
          {
            artistId,
            file: PHOTO.portrait,
            review: second!.review!,
            expectedPhoto: null,
          },
          providers,
        ),
      ]),
    );
    const fulfilled = outcomes.filter(
      (outcome) => outcome.status === "fulfilled",
    );
    const rejected = outcomes.filter(
      (outcome): outcome is PromiseRejectedResult =>
        outcome.status === "rejected",
    );
    expect(fulfilled).toHaveLength(1);
    expect(rejected.map((outcome) => failureOf(outcome.reason))).toEqual([
      "review_stale",
    ]);
    const [row] = await db
      .select({ photoSourceUrl: schema.artists.photoSourceUrl })
      .from(schema.artists)
      .where(eq(schema.artists.id, artistId));
    expect(
      [PHOTO.onStage, PHOTO.portrait].map(
        (file) => `https://commons.wikimedia.org/wiki/File:${file}`,
      ),
    ).toContain(row!.photoSourceUrl);
  });
});

describe("the stored-photo fingerprint", () => {
  it("is null with no photograph, and changes with every column", () => {
    const base = {
      photoUrl: "u",
      photoCredit: "c",
      photoLicense: "l",
      photoSourceUrl: "s",
      photoFileSha1: "a".repeat(40),
      photoFileTimestamp: "2019-05-04T12:00:00.000Z",
      photoChosenAt: "2026-11-02T12:00:00.000Z",
    };
    expect(
      photoStateOf({
        photoUrl: null,
        photoCredit: null,
        photoLicense: null,
        photoSourceUrl: null,
        photoFileSha1: null,
        photoFileTimestamp: null,
        photoChosenAt: null,
      }),
    ).toBeNull();
    const state = photoStateOf(base);
    for (const key of Object.keys(base) as (keyof typeof base)[]) {
      const changed =
        key === "photoFileTimestamp" || key === "photoChosenAt"
          ? "2020-01-01T00:00:00.000Z"
          : `${base[key]}x`;
      expect(photoStateOf({ ...base, [key]: changed }), key).not.toBe(state);
    }
  });
});

// The public artist page (M3.5) shows the photograph, so setting or replacing
// one is refused while the artist's page is public (gate G8 not widened), and
// removing one is always allowed (a strict reduction: the takedown path).
// Visibility is the publication predicate's: a served album journal about an
// album that credits the artist.
describe("the public page guard", () => {
  async function creditedJournal(
    tx: Transaction,
    artistId: string,
    status: "draft" | "private" | "published",
    options: { deletedAt?: Date } = {},
  ) {
    const album = await createTestAlbum(tx, { artistIds: [artistId] });
    return createTestAlbumJournal(tx, {
      albumId: album.albumId,
      versions: [{ locale: "en", status }],
      slug: `photo-guard-${status}-${uniqueLabel("x").slice(-8)}`,
      deletedAt: options.deletedAt,
    });
  }

  it("refuses to set or replace a photograph while the artist's page is public, and writes nothing", async () => {
    await inRollbackTransaction(async (tx) => {
      const artistId = await createTestArtist(tx, uniqueLabel("Guarded"));
      await creditedJournal(tx, artistId, "published");
      const before = await rowChecksum(tx);
      const columns = await photoColumns(tx, artistId);
      expect(await refusal(tx, (t) => choose(t, artistId, PHOTO.onStage))).toBe(
        "public_page",
      );
      expect(await rowChecksum(tx)).toEqual(before);
      expect(await photoColumns(tx, artistId)).toEqual(columns);

      // The studio is told before it tries.
      const choices = await listArtistPhotoChoices(
        tx,
        author,
        { artistId, query: "" },
        fixtureProviders().providers,
      );
      expect(choices!.artist.onPublicPage).toBe(true);
      const review = await reviewArtistPhoto(
        tx,
        author,
        { artistId, file: PHOTO.onStage },
        fixtureProviders().providers,
      );
      expect(review!.artist.onPublicPage).toBe(true);
    });
  });

  it("refuses to replace a photograph chosen before the page became public", async () => {
    await inRollbackTransaction(async (tx) => {
      const artistId = await createTestArtist(tx, uniqueLabel("Replaced"));
      await choose(tx, artistId, PHOTO.onStage);
      await creditedJournal(tx, artistId, "published");
      const columns = await photoColumns(tx, artistId);
      expect(
        await refusal(tx, (t) => choose(t, artistId, PHOTO.portrait)),
      ).toBe("public_page");
      expect(await photoColumns(tx, artistId)).toEqual(columns);
    });
  });

  it("allows a photograph while only draft, private, deleted, or no writing credits the artist", async () => {
    await inRollbackTransaction(async (tx) => {
      for (const setup of [
        (id: string) => creditedJournal(tx, id, "draft"),
        (id: string) => creditedJournal(tx, id, "private"),
        (id: string) =>
          creditedJournal(tx, id, "published", { deletedAt: new Date() }),
        async () => undefined,
      ]) {
        const artistId = await createTestArtist(tx, uniqueLabel("Unguarded"));
        await setup(artistId);
        await choose(tx, artistId, PHOTO.onStage);
        expect((await photoColumns(tx, artistId)).photoUrl).toBe(
          commonsThumbnail(PHOTO.onStage, 330),
        );
      }
    });
  });

  it("allows removal while the page is public, and leaves every piece of writing as it was", async () => {
    await inRollbackTransaction(async (tx) => {
      const artistId = await createTestArtist(tx, uniqueLabel("Takedown"));
      await choose(tx, artistId, PHOTO.onStage);
      await creditedJournal(tx, artistId, "published");
      const writing = await rowChecksum(tx);
      const detail = await getArtist(tx, author, artistId);
      await removeArtistPhoto(tx, author, {
        artistId,
        expectedPhoto: detail!.photo.state,
      });
      expect((await photoColumns(tx, artistId)).photoUrl).toBeNull();
      // The writing and its publication are untouched: only the catalog row
      // changed (rowChecksum covers the authored tables).
      expect(await rowChecksum(tx)).toEqual(writing);
    });
  });
});

describe("restoring an archived artist (reviews of PR #46)", () => {
  async function archivedOnAlbum(
    tx: Transaction,
    status: "published" | "private",
  ) {
    const artistId = await createTestArtist(tx, uniqueLabel("Archived"));
    const album = await createTestAlbum(tx, { artistIds: [artistId] });
    const entryId = await createTestAlbumJournal(tx, {
      albumId: album.albumId,
      versions: [{ locale: "en", status }],
      slug: `restore-guard-${uniqueLabel("x").slice(-8)}`,
    });
    await tx.execute(
      sql`update artists set archived_at = now() where id = ${artistId}`,
    );
    return { artistId, entryId };
  }

  async function archivedAt(tx: Transaction, artistId: string) {
    const [row] = await tx
      .select({ archivedAt: schema.artists.archivedAt })
      .from(schema.artists)
      .where(eq(schema.artists.id, artistId));
    return row!.archivedAt;
  }

  it("is refused when it would give the artist a public page, with or without a photograph, and writes nothing", async () => {
    await inRollbackTransaction(async (tx) => {
      const withPhoto = await archivedOnAlbum(tx, "private");
      await tx.execute(
        sql`update artists set archived_at = null where id = ${withPhoto.artistId}`,
      );
      await choose(tx, withPhoto.artistId, PHOTO.onStage);
      await tx.execute(
        sql`update artists set archived_at = now() where id = ${withPhoto.artistId}`,
      );
      await tx.execute(sql`
        update entry_texts set status = 'published', published_at = now(),
               first_published_at = now()
         where entry_id = ${withPhoto.entryId}`);
      await tx.execute(sql`
        update entry_slugs set was_published = true
         where entry_id = ${withPhoto.entryId}`);
      const withoutPhoto = await archivedOnAlbum(tx, "published");

      for (const { artistId } of [withPhoto, withoutPhoto]) {
        const before = await rowChecksum(tx);
        const photo = await photoColumns(tx, artistId);
        expect(
          await refusal(tx, (t) => restoreArtist(t, author, artistId)),
        ).toBe("public_page");
        expect(await rowChecksum(tx)).toEqual(before);
        expect(await photoColumns(tx, artistId)).toEqual(photo);
        expect(await archivedAt(tx, artistId)).not.toBeNull();
      }
      // Removing the photograph is still allowed, and does not by itself
      // let the restore through: the page would still appear.
      const detail = await getArtist(tx, author, withPhoto.artistId);
      await removeArtistPhoto(tx, author, {
        artistId: withPhoto.artistId,
        expectedPhoto: detail!.photo.state,
      });
      expect(
        await refusal(tx, (t) => restoreArtist(t, author, withPhoto.artistId)),
      ).toBe("public_page");
    });
  });

  it("is allowed when no public journal credits the artist, and after the journals are unpublished", async () => {
    await inRollbackTransaction(async (tx) => {
      const privateOnly = await archivedOnAlbum(tx, "private");
      await restoreArtist(tx, author, privateOnly.artistId);
      expect(await archivedAt(tx, privateOnly.artistId)).toBeNull();
      expect(await isArtistOnPublicPage(tx, privateOnly.artistId)).toBe(false);

      // The confirmed way: unpublish, restore, and publish again through
      // the publication review.
      const shown = await archivedOnAlbum(tx, "published");
      await setPrivacyForTest(tx, author, {
        entryId: shown.entryId,
        locale: "en",
        status: "private",
      });
      await restoreArtist(tx, author, shown.artistId);
      expect(await archivedAt(tx, shown.artistId)).toBeNull();
      expect(await isArtistOnPublicPage(tx, shown.artistId)).toBe(false);
    });
  });
});

describe("changing an album's credits (review of PR #46)", () => {
  async function publishedAlbum(
    tx: Transaction,
    status = "published" as "published" | "private" | "draft",
  ) {
    const credited = await createTestArtist(tx, uniqueLabel("Credited"));
    const album = await createTestAlbum(tx, { artistIds: [credited] });
    const entryId = await createTestAlbumJournal(tx, {
      albumId: album.albumId,
      versions: [{ locale: "en", status }],
      slug: `credit-guard-${uniqueLabel("x").slice(-8)}`,
    });
    return { credited, albumId: album.albumId, entryId };
  }

  async function creditsOf(tx: Transaction, albumId: string) {
    const rows = await tx
      .select({
        artistId: schema.albumArtists.artistId,
        creditedAs: schema.albumArtists.creditedAs,
        position: schema.albumArtists.position,
      })
      .from(schema.albumArtists)
      .where(eq(schema.albumArtists.albumId, albumId));
    return rows.sort((a, b) => a.position - b.position);
  }

  it("refuses a credit that would put an artist on a public page for the first time, and writes nothing", async () => {
    await inRollbackTransaction(async (tx) => {
      const { credited, albumId } = await publishedAlbum(tx);
      const newcomer = await createTestArtist(tx, uniqueLabel("Newcomer"));
      await choose(tx, newcomer, PHOTO.onStage);
      const before = await creditsOf(tx, albumId);
      const checksum = await rowChecksum(tx);
      for (const credits of [
        [{ artistId: credited }, { artistId: newcomer }],
        [{ artistId: newcomer }],
        [{ artistId: newcomer }, { artistId: credited }],
      ]) {
        expect(
          await refusal(tx, (t) =>
            updateAlbum(t, author, albumId, {
              title: "[Test] Renamed while refused",
              credits,
            }),
          ),
        ).toBe("public_page");
        // Nothing of the patch is written, not even the title.
        expect(await creditsOf(tx, albumId)).toEqual(before);
        expect(await rowChecksum(tx)).toEqual(checksum);
      }
      expect(await isArtistOnPublicPage(tx, newcomer)).toBe(false);
    });
  });

  it("allows every change that exposes no new artist", async () => {
    await inRollbackTransaction(async (tx) => {
      const { credited, albumId } = await publishedAlbum(tx);
      // An artist that already has a page, through another public album.
      const elsewhere = await publishedAlbum(tx);
      await updateAlbum(tx, author, albumId, {
        credits: [{ artistId: credited }, { artistId: elsewhere.credited }],
      });
      // Reordering, renaming a credit, and removing one.
      await updateAlbum(tx, author, albumId, {
        credits: [
          { artistId: elsewhere.credited },
          { artistId: credited, creditedAs: "[Test] Alias" },
        ],
      });
      await updateAlbum(tx, author, albumId, {
        credits: [{ artistId: credited }],
      });
      // The album's other fields, without credits.
      await updateAlbum(tx, author, albumId, { title: "[Test] Retitled" });
      expect((await creditsOf(tx, albumId)).map((c) => c.artistId)).toEqual([
        credited,
      ]);

      // Any credit on an album with no public journal.
      for (const status of ["draft", "private"] as const) {
        const hidden = await publishedAlbum(tx, status);
        const newcomer = await createTestArtist(tx, uniqueLabel("Newcomer"));
        await updateAlbum(tx, author, hidden.albumId, {
          credits: [{ artistId: hidden.credited }, { artistId: newcomer }],
        });
        expect(await isArtistOnPublicPage(tx, newcomer)).toBe(false);
      }
    });
  });

  it("still refuses an archived artist, as before", async () => {
    await inRollbackTransaction(async (tx) => {
      const { credited, albumId } = await publishedAlbum(tx, "draft");
      const archived = await createTestArtist(tx, uniqueLabel("Archived"));
      await tx.execute(
        sql`update artists set archived_at = now() where id = ${archived}`,
      );
      expect(
        await refusal(tx, (t) =>
          updateAlbum(t, author, albumId, {
            credits: [{ artistId: credited }, { artistId: archived }],
          }),
        ),
      ).toBe("archived_reference");
    });
  });
});

describe("the public page guard, over real connections", () => {
  const created: {
    entryIds: string[];
    albumIds: string[];
    artistIds: string[];
  } = { entryIds: [], albumIds: [], artistIds: [] };

  afterAll(async () => {
    const db = getDb();
    if (created.entryIds.length > 0) {
      await db
        .delete(schema.entrySlugs)
        .where(inArray(schema.entrySlugs.entryId, created.entryIds));
      await db
        .delete(schema.entries)
        .where(inArray(schema.entries.id, created.entryIds));
    }
    if (created.albumIds.length > 0) {
      await db
        .delete(schema.albums)
        .where(inArray(schema.albums.id, created.albumIds));
    }
    if (created.artistIds.length > 0) {
      await db
        .delete(schema.artists)
        .where(inArray(schema.artists.id, created.artistIds));
    }
  });

  /** A committed artist credited on `albums` albums, each with a draft journal. */
  async function committedArtist(label: string, albums: number) {
    const db = getDb();
    const [artist] = await db
      .insert(schema.artists)
      .values({ name: uniqueLabel(label), kind: "person" })
      .returning({ id: schema.artists.id });
    created.artistIds.push(artist!.id);
    const entryIds: string[] = [];
    const albumIds: string[] = [];
    for (let n = 0; n < albums; n++) {
      const [album] = await db
        .insert(schema.albums)
        .values({ title: uniqueLabel(`${label} album`) })
        .returning({ id: schema.albums.id });
      created.albumIds.push(album!.id);
      albumIds.push(album!.id);
      await db
        .insert(schema.albumArtists)
        .values({ albumId: album!.id, artistId: artist!.id, position: 1 });
      const [entry] = await db
        .insert(schema.entries)
        .values({ kind: "album_journal" })
        .returning({ id: schema.entries.id });
      created.entryIds.push(entry!.id);
      entryIds.push(entry!.id);
      await db
        .insert(schema.entryTexts)
        .values({ entryId: entry!.id, locale: "en", isOriginal: true });
      await db
        .insert(schema.albumJournals)
        .values({ entryId: entry!.id, albumId: album!.id });
      await db.insert(schema.entrySlugs).values({
        kind: "album_journal",
        slug: `photo-race-${entry!.id.slice(0, 8)}`,
        entryId: entry!.id,
        isCurrent: true,
      });
    }
    return { artistId: artist!.id, entryIds, albumIds };
  }

  async function backendPid(db: Parameters<typeof waitsOnLock>[0]) {
    const result = await db.execute<{ pid: number }>(
      sql`select pg_backend_pid() as pid`,
    );
    return result.rows[0]!.pid;
  }

  /** Whether the backend `pid` is seen waiting on a lock within ~5 s. */
  async function waitsOnLock(
    db: ReturnType<typeof getDb>,
    pid: number,
  ): Promise<boolean> {
    for (let tries = 0; tries < 100; tries++) {
      const waiting = await getDb().execute<{ n: number }>(sql`
        select count(*)::int as n from pg_stat_activity
         where pid = ${pid} and wait_event_type = 'Lock'`);
      if (waiting.rows[0]!.n > 0) {
        return true;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    void db;
    return false;
  }

  it("holds every journal entry that could show the artist, so a publish of any of them waits", async () => {
    const { artistId, entryIds } = await committedArtist("Held", 2);
    await withConnections(2, async ([first, second]) => {
      let release!: () => void;
      const held = new Promise<void>((resolve) => (release = resolve));
      let locked!: () => void;
      const isLocked = new Promise<void>((resolve) => (locked = resolve));
      const guard = first!.transaction(async (tx) => {
        expect(await lockArtistPublicExposure(tx, artistId)).toBe(false);
        locked();
        await held;
      });
      await isLocked;
      const outcomes: string[] = [];
      for (const entryId of entryIds) {
        // The lock a publish takes cannot be granted meanwhile, for either.
        outcomes.push(
          await second!
            .transaction(async (tx) => {
              await tx.execute(sql`set local lock_timeout = '300ms'`);
              await tx.execute(
                sql`select id from entries where id = ${entryId} for update`,
              );
            })
            .then(
              () => "granted",
              (error: unknown) =>
                (error as { cause?: { code?: string } }).cause?.code ??
                String(error),
            ),
        );
      }
      release();
      await guard;
      expect(outcomes).toEqual(["55P03", "55P03"]);
    });
  });

  it("refuses the photograph once a publish that held a journal has committed", async () => {
    const db = getDb();
    const { artistId, entryIds } = await committedArtist("Raced", 2);
    const entryId = entryIds[1]!;
    const { providers } = fixtureProviders();
    const review = await reviewArtistPhoto(
      db,
      author,
      { artistId, file: PHOTO.onStage },
      providers,
    );
    expect(review!.artist.onPublicPage).toBe(false);

    await withConnections(2, async ([first, second]) => {
      const chooserPid = await backendPid(second!);
      let commit!: () => void;
      const committing = new Promise<void>((resolve) => (commit = resolve));
      let locked!: () => void;
      const isLocked = new Promise<void>((resolve) => (locked = resolve));
      // A publish in progress (raw SQL, as the artwork test does): the
      // entry locked, the version and the address published.
      const publish = first!.transaction(async (tx) => {
        await tx.execute(
          sql`select id from entries where id = ${entryId} for update`,
        );
        await tx.execute(sql`
          update entry_texts
             set status = 'published', published_at = now(),
                 first_published_at = now()
           where entry_id = ${entryId}`);
        await tx.execute(sql`
          update entry_slugs set was_published = true
           where entry_id = ${entryId}`);
        locked();
        await committing;
      });
      await isLocked;
      const change = setArtistPhoto(
        second!,
        author,
        {
          artistId,
          file: PHOTO.onStage,
          review: review!.review!,
          expectedPhoto: null,
        },
        providers,
      ).then(
        () => "changed",
        (error: unknown) => failureOf(error),
      );
      // The photograph change itself must be seen waiting on a lock, so the
      // test cannot pass by timing alone.
      // Always release the stand-in, even when the assertion fails, so a
      // failing run never leaves a transaction holding locks.
      let waited = false;
      try {
        waited = await waitsOnLock(db, chooserPid);
      } finally {
        commit();
      }
      await publish;
      expect(waited).toBe(true);
      expect(await change).toBe("public_page");
    });
    const [row] = await db
      .select({ photoUrl: schema.artists.photoUrl })
      .from(schema.artists)
      .where(eq(schema.artists.id, artistId));
    expect(row!.photoUrl).toBeNull();
  });

  /** A stand-in for a publish: holds the entry, publishes it, and waits. */
  function holdPublish(
    connection: Parameters<typeof backendPid>[0],
    entryId: string,
  ) {
    let commit!: () => void;
    const committing = new Promise<void>((resolve) => (commit = resolve));
    let locked!: () => void;
    const isLocked = new Promise<void>((resolve) => (locked = resolve));
    const done = (
      connection as unknown as ReturnType<typeof getDb>
    ).transaction(async (tx) => {
      await tx.execute(
        sql`select id from entries where id = ${entryId} for update`,
      );
      await tx.execute(sql`
        update entry_texts
           set status = 'published', published_at = now(),
               first_published_at = now()
         where entry_id = ${entryId}`);
      await tx.execute(sql`
        update entry_slugs set was_published = true
         where entry_id = ${entryId}`);
      locked();
      await committing;
    });
    return { isLocked, commit, done };
  }

  it("refuses a credit once a publish of the album's journal has committed while it waited", async () => {
    const db = getDb();
    const owner = await committedArtist("Credit owner", 1);
    const newcomer = await committedArtist("Credit newcomer", 0);
    const albumId = owner.albumIds[0]!;
    await withConnections(2, async ([first, second]) => {
      const editorPid = await backendPid(second!);
      const publish = holdPublish(first!, owner.entryIds[0]!);
      await publish.isLocked;
      const change = updateAlbum(second!, author, albumId, {
        credits: [
          { artistId: owner.artistId },
          { artistId: newcomer.artistId },
        ],
      }).then(
        () => "changed",
        (error: unknown) => failureOf(error),
      );
      let waited = false;
      try {
        waited = await waitsOnLock(db, editorPid);
      } finally {
        publish.commit();
      }
      await publish.done;
      expect(waited).toBe(true);
      expect(await change).toBe("public_page");
    });
    const credits = await db
      .select({ artistId: schema.albumArtists.artistId })
      .from(schema.albumArtists)
      .where(eq(schema.albumArtists.albumId, albumId));
    expect(credits.map((row) => row.artistId)).toEqual([owner.artistId]);
  });

  it("refuses a restore of the artist once a publish of its album's journal has committed while it waited", async () => {
    const db = getDb();
    const { artistId, entryIds } = await committedArtist("Restore waits", 1);
    await db.execute(
      sql`update artists set archived_at = now() where id = ${artistId}`,
    );
    await withConnections(2, async ([first, second]) => {
      const restorerPid = await backendPid(second!);
      const publish = holdPublish(first!, entryIds[0]!);
      await publish.isLocked;
      const restore = restoreArtist(second!, author, artistId).then(
        () => "restored",
        (error: unknown) => failureOf(error),
      );
      let waited = false;
      try {
        waited = await waitsOnLock(db, restorerPid);
      } finally {
        publish.commit();
      }
      await publish.done;
      expect(waited).toBe(true);
      expect(await restore).toBe("public_page");
    });
    const [row] = await db
      .select({ archivedAt: schema.artists.archivedAt })
      .from(schema.artists)
      .where(eq(schema.artists.id, artistId));
    expect(row!.archivedAt).not.toBeNull();
  });

  it("refuses the photograph once a restore of the archived artist has committed", async () => {
    // The artist is credited on a published journal, so it is hidden only
    // because it is archived. A restore that commits while the photograph
    // command waits would make the page public with a photograph nobody
    // confirmed (review of PR #46): the command decides after the artist's
    // row lock, so it sees the restore.
    const db = getDb();
    const { artistId, entryIds } = await committedArtist("Restored", 1);
    await db.execute(sql`
      update entry_texts set status = 'published', published_at = now(),
             first_published_at = now()
       where entry_id = ${entryIds[0]!}`);
    await db.execute(sql`
      update entry_slugs set was_published = true
       where entry_id = ${entryIds[0]!}`);
    await db.execute(
      sql`update artists set archived_at = now() where id = ${artistId}`,
    );
    const { providers } = fixtureProviders();
    const review = await reviewArtistPhoto(
      db,
      author,
      { artistId, file: PHOTO.onStage },
      providers,
    );
    expect(review!.artist.onPublicPage).toBe(false);

    await withConnections(2, async ([first, second]) => {
      const chooserPid = await backendPid(second!);
      let commit!: () => void;
      const committing = new Promise<void>((resolve) => (commit = resolve));
      let locked!: () => void;
      const isLocked = new Promise<void>((resolve) => (locked = resolve));
      // A restore of the artist in progress, as `restoreArtist` writes it.
      const restore = first!.transaction(async (tx) => {
        await tx.execute(sql`
          update artists set archived_at = null, updated_at = now()
           where id = ${artistId}`);
        locked();
        await committing;
      });
      await isLocked;
      const change = setArtistPhoto(
        second!,
        author,
        {
          artistId,
          file: PHOTO.onStage,
          review: review!.review!,
          expectedPhoto: null,
        },
        providers,
      ).then(
        () => "changed",
        (error: unknown) => failureOf(error),
      );
      let waited = false;
      try {
        waited = await waitsOnLock(db, chooserPid);
      } finally {
        commit();
      }
      await restore;
      expect(waited).toBe(true);
      expect(await change).toBe("public_page");
    });
    const [row] = await db
      .select({ photoUrl: schema.artists.photoUrl })
      .from(schema.artists)
      .where(eq(schema.artists.id, artistId));
    expect(row!.photoUrl).toBeNull();
  });
});

/** The same file's answer, under another license (a later change on Commons). */
function relicensed(url: string, license: string) {
  const body = structuredClone(providerAnswer(new URL(url)).body) as {
    query: {
      pages: {
        imageinfo: { extmetadata: Record<string, { value: string }> }[];
      }[];
    };
  };
  const meta = body.query.pages[0]!.imageinfo[0]!.extmetadata;
  meta.License = { value: license };
  meta.LicenseShortName = { value: "CC BY-NC-SA 4.0" };
  meta.LicenseUrl = {
    value: "https://creativecommons.org/licenses/by-nc-sa/4.0",
  };
  return body;
}
