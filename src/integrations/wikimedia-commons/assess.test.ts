import { describe, expect, it } from "vitest";

import { providerResponse } from "@/testing/provider-mock";
import { virtualRuntime } from "@/testing/provider-runtime";
import { PHOTO } from "@/testing/wikimedia-fixtures";

import { assessCommonsFile, photoPlanOf } from "./assess";
import { createWikimediaClient } from "./client";
import type { CommonsFile } from "./contract";
import { photoSourceUrl, photoThumbnailUrl } from "./photo";

async function fileNamed(name: string): Promise<CommonsFile> {
  const fake = virtualRuntime((url) => providerResponse(url));
  const wm = createWikimediaClient({
    commonsBaseUrl: "http://127.0.0.1:4010/commons/w/",
    runtime: fake.runtime,
  });
  // A lookup by name asks only for photo formats; a search sees every file.
  const found =
    (await wm.getFiles([name])).files[0] ??
    [...(await wm.searchFiles("ink")), ...(await wm.searchFiles("paper"))].find(
      (file) => file.fileName === name,
    );
  if (!found) {
    throw new Error(`no fixture ${name}`);
  }
  return found;
}

describe("assessing a Commons file", () => {
  it("accepts a CC BY-SA photograph, crediting the creator, never the uploader", async () => {
    const assessment = assessCommonsFile(await fileNamed(PHOTO.onStage));
    expect(assessment).toMatchObject({
      refusals: [],
      credit: "[Test] Photographer One",
      creator: "[Test] Photographer One",
      creditFromAttribution: false,
      sourceCredit: "Own work",
      license: { name: "CC BY-SA 4.0", shareAlike: true },
      restrictions: ["personality"],
      title: "Test Ink Quartet on stage.jpg",
      sourceUrl: photoSourceUrl(PHOTO.onStage),
      image: { src: photoThumbnailUrl(PHOTO.onStage, 330) },
      width: 2000,
      height: 2500,
      mime: "image/jpeg",
      timestamp: "2019-05-04T12:00:00.000Z",
    });
    expect(photoPlanOf(assessment)).toEqual({
      fileName: PHOTO.onStage,
      sha1: assessment.sha1,
      timestamp: "2019-05-04T12:00:00.000Z",
      photoUrl: photoThumbnailUrl(PHOTO.onStage, 330),
      photoSourceUrl: photoSourceUrl(PHOTO.onStage),
      photoLicense: "CC BY-SA 4.0",
      photoCredit: "[Test] Photographer One",
    });
  });

  it("uses the designated attribution when the file has one", async () => {
    const assessment = assessCommonsFile(await fileNamed(PHOTO.attributed));
    expect(assessment).toMatchObject({
      refusals: [],
      credit: "Photo: [Test] Photographer Three / [Test] Studio Archive",
      creator: "[Test] Photographer Three",
      creditFromAttribution: true,
      license: { name: "CC BY 4.0" },
    });
  });

  it("accepts CC0 and public-domain photographs, still credited", async () => {
    expect(assessCommonsFile(await fileNamed(PHOTO.portrait))).toMatchObject({
      refusals: [],
      credit: "[Test] Photographer Two",
      license: { name: "CC0" },
      mime: "image/png",
    });
    expect(
      assessCommonsFile(await fileNamed(PHOTO.publicDomain)),
    ).toMatchObject({
      refusals: [],
      credit: "[Test] Photographer Twelve",
      license: { name: "Public domain" },
    });
  });

  it.each([
    [PHOTO.nonCommercial, ["unsupported_license"]],
    [PHOTO.ported, ["unsupported_license"]],
    [PHOTO.mismatch, ["license_mismatch"]],
    [PHOTO.unknownAuthor, ["no_creator"]],
    [PHOTO.hostile, ["credit_not_plain"]],
    [PHOTO.small, ["too_small"]],
    [PHOTO.animated, ["unsupported_format"]],
    [PHOTO.elsewhere, ["unexpected_address"]],
  ])("refuses %s, offers no image, and has no plan", async (name, refusals) => {
    const assessment = assessCommonsFile(await fileNamed(name));
    expect(assessment.refusals).toEqual(refusals);
    expect(assessment.image).toBeNull();
    expect(photoPlanOf(assessment)).toBeNull();
  });

  it("never lets hostile markup through as a credit", async () => {
    const assessment = assessCommonsFile(await fileNamed(PHOTO.hostile));
    expect(assessment.credit).toBeNull();
    expect(assessment.creator).not.toMatch(/script|onerror|<img/i);
  });

  it("refuses a file nominated for deletion, and a missing creator even when attribution is optional", async () => {
    const base = await fileNamed(PHOTO.portrait);
    expect(
      assessCommonsFile({
        ...base,
        metadata: { ...base.metadata, DeletionReason: "Copyright violation" },
      }).refusals,
    ).toEqual(["deletion_requested"]);
    expect(
      assessCommonsFile({ ...base, metadata: { ...base.metadata, Artist: "" } })
        .refusals,
    ).toEqual(["no_creator"]);
    expect(
      assessCommonsFile({
        ...base,
        metadata: { ...base.metadata, Artist: "x".repeat(301) },
      }).refusals,
    ).toEqual(["credit_too_long"]);
  });

  it("refuses addresses Refrain could not rebuild exactly", async () => {
    const base = await fileNamed(PHOTO.onStage);
    for (const changed of [
      { thumbUrl: photoThumbnailUrl(PHOTO.onStage, 400), thumbWidth: 400 },
      { thumbUrl: photoThumbnailUrl(PHOTO.portrait, 330) },
      {
        descriptionUrl:
          "https://evil.example/wiki/File:Test_Ink_Quartet_on_stage.jpg",
      },
      { descriptionUrl: `${photoSourceUrl(PHOTO.onStage)}?action=raw` },
      { mediaType: "DRAWING" },
    ]) {
      expect(assessCommonsFile({ ...base, ...changed }).refusals.length).toBe(
        1,
      );
    }
    // A larger standard thumbnail, as the API may return, is fine.
    expect(
      assessCommonsFile({
        ...base,
        thumbUrl: photoThumbnailUrl(PHOTO.onStage, 500),
        thumbWidth: 500,
      }).refusals,
    ).toEqual([]);
  });
});
