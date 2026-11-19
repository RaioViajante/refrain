import { describe, expect, it } from "vitest";

import { connectTestDatabase } from "@/test/db";
import { insertImage, insertMixtape } from "@/test/fixtures";

import { setSiteImage } from "../studio/site-content";
import { setMixtapeImage, setMixtapePublished } from "../studio/mixtapes";
import { updateImage } from "../studio/images";
import {
  PRIVATE_PHOTO_CACHE,
  PUBLIC_PHOTO_CACHE,
  resolvePhoto,
} from "./photos";

const db = connectTestDatabase();
const anonymous = (id: string) => resolvePhoto(db, id, false);
const owner = (id: string) => resolvePhoto(db, id, true);
const fields = {
  alt: "[Test] a photo",
  focus: 4,
  treatment: "mood" as const,
  rightsNote: "",
};

describe("serving photographs", () => {
  it("hides a photo whose rights are not confirmed, even on a published tape", async () => {
    const photo = await insertImage(db);
    await insertMixtape(db, { status: "published", coverImageId: photo.id });
    expect(await anonymous(photo.id)).toEqual({ status: 404 });
    expect(await owner(photo.id)).toMatchObject({
      status: 200,
      cacheControl: PRIVATE_PHOTO_CACHE,
    });
  });

  it("hides a confirmed photo that is unused or only on a draft tape", async () => {
    const unused = await insertImage(db, { rightsConfirmed: true });
    const onDraft = await insertImage(db, { rightsConfirmed: true });
    await insertMixtape(db, { detailImageId: onDraft.id });
    expect(await anonymous(unused.id)).toEqual({ status: 404 });
    expect(await anonymous(onDraft.id)).toEqual({ status: 404 });
  });

  it("serves a confirmed photo of a published tape or a site slot to anyone", async () => {
    const cover = await insertImage(db, { rightsConfirmed: true });
    const road = await insertImage(db, { rightsConfirmed: true });
    await insertMixtape(db, { status: "published", coverImageId: cover.id });
    await setSiteImage(db, "footer.road", road.id);
    for (const id of [cover.id, road.id]) {
      const served = await anonymous(id);
      expect(served).toMatchObject({
        status: 200,
        contentType: "image/png",
        cacheControl: PUBLIC_PHOTO_CACHE,
      });
      if (served.status === 200)
        expect(served.bytes.toString()).toBe("[Test]px");
    }
  });

  it("stops serving at once when rights are revoked or the tape is unpublished", async () => {
    const photo = await insertImage(db, { rightsConfirmed: true });
    const tape = await insertMixtape(db, { status: "published" });
    await setMixtapeImage(db, tape.id, "cover", photo.id);
    expect((await anonymous(photo.id)).status).toBe(200);

    await updateImage(db, photo.id, { ...fields, rightsConfirmed: false });
    expect(await anonymous(photo.id)).toEqual({ status: 404 });

    await updateImage(db, photo.id, { ...fields, rightsConfirmed: true });
    expect((await anonymous(photo.id)).status).toBe(200);
    await setMixtapePublished(db, tape.id, false);
    expect(await anonymous(photo.id)).toEqual({ status: 404 });

    await setMixtapePublished(db, tape.id, true);
    await setMixtapeImage(db, tape.id, "cover", null);
    expect(await anonymous(photo.id)).toEqual({ status: 404 });
  });

  it("answers 404 for unknown or malformed ids, revealing nothing", async () => {
    expect(await anonymous("00000000-0000-4000-8000-000000000000")).toEqual({
      status: 404,
    });
    expect(await owner("../../etc/passwd")).toEqual({ status: 404 });
    expect(await owner("'; drop table images; --")).toEqual({ status: 404 });
  });
});
