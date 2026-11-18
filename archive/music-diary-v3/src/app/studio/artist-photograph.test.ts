import { describe, expect, it } from "vitest";

import { creditCaption } from "./artist-photograph";

describe("a photograph's credit as a caption", () => {
  it("prefixes a plain credit", () => {
    expect(creditCaption("en", "[Test] Photographer One")).toBe(
      "Photo: [Test] Photographer One",
    );
    // A name that merely starts with the word is still prefixed.
    expect(creditCaption("en", "Photon Studio")).toBe("Photo: Photon Studio");
    expect(creditCaption("en", "Photobyte Studio")).toBe(
      "Photo: Photobyte Studio",
    );
  });

  it("prefixes it in the page's language, and leaves the credit as it is", () => {
    expect(creditCaption("pt-BR", "[Test] Photographer One")).toBe(
      "Foto: [Test] Photographer One",
    );
    expect(creditCaption("pt-BR", "Photon Studio")).toBe("Foto: Photon Studio");
  });

  it("never doubles a prefix the file's attribution already has", () => {
    for (const credit of [
      "Photo: [Test] Photographer Three / [Test] Studio Archive",
      "Photograph: [Test] Someone",
      "photo by: [Test] Someone",
      "Foto: [Test] Alguém",
      "Photo © [Test] Someone",
      // M3.5 review: "by" without a colon is a prefix too.
      "Photo by [Test] Someone",
      "Photograph by [Test] Someone",
    ]) {
      for (const locale of ["en", "pt-BR"] as const) {
        expect(creditCaption(locale, credit)).toBe(credit);
      }
    }
  });
});
