import { describe, expect, it } from "vitest";

import { normalizeText } from "@/lib/text";

import { noteSchema, siteTextBodySchema } from "./schemas";

describe("text fields", () => {
  it("store line breaks as \\n, whatever the browser sends", () => {
    expect(siteTextBodySchema.parse(" a\r\n\r\nb\rc ")).toBe("a\n\nb\nc");
    expect(noteSchema.parse({ note: "x\r\ny", noteSide: "left" }).note).toBe(
      "x\ny",
    );
  });
});

describe("normalizeText", () => {
  it("matches what the server stores, so a saved text is not left dirty", () => {
    for (const typed of [
      "uma frase ",
      "uma frase\n",
      " \r\nprimeiro\r\n\r\nsegundo\r\n ",
      "sem mudança",
      "   ",
      "",
    ]) {
      expect(normalizeText(typed)).toBe(siteTextBodySchema.parse(typed));
    }
  });
});
