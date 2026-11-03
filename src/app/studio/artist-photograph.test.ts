import { describe, expect, it } from "vitest";

import { creditCaption } from "./artist-photograph";

describe("a photograph's credit as a caption", () => {
  it("prefixes a plain credit", () => {
    expect(creditCaption("[Test] Photographer One")).toBe(
      "Photo: [Test] Photographer One",
    );
    // A name that merely starts with the word is still prefixed.
    expect(creditCaption("Photon Studio")).toBe("Photo: Photon Studio");
  });

  it("never doubles a prefix the file's attribution already has", () => {
    for (const credit of [
      "Photo: [Test] Photographer Three / [Test] Studio Archive",
      "Photograph: [Test] Someone",
      "photo by: [Test] Someone",
      "Foto: [Test] Alguém",
      "Photo © [Test] Someone",
    ]) {
      expect(creditCaption(credit)).toBe(credit);
    }
  });
});
