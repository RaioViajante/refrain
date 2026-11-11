import { describe, expect, it } from "vitest";

import { isBlankText } from "@/validation";

import { saveAlbumJournalInput } from "./input";

// Issue #54: the Studio's editor asks before a save takes a public
// reflection's text away, so it must know exactly when the server stores no
// text. Both use `isBlankText`; this holds the save's own validation to it.

const TRACK = "00000000-0000-4000-8000-000000000001";
const ENTRY = "00000000-0000-4000-8000-000000000002";

function storedText(text: string): string | null | undefined {
  const parsed = saveAlbumJournalInput.parse({
    entryId: ENTRY,
    expectedVersion: 1,
    reflections: [{ trackId: TRACK, texts: { en: text } }],
  });
  return parsed.reflections?.[0]?.texts?.en;
}

describe("a reflection's text the server stores no text for", () => {
  const blank = [
    "",
    " ",
    "\n\n\t",
    "  ",
    "​‌‍⁠﻿",
    // Control characters are removed before the test (Codex review).
    "\u0001",
    "\u007F",
    "\u0001​",
    "\u0000 \u001F\r\n",
  ];
  const kept = ["a", " a ", "\u0001a", "​a", "[Test] words"];

  it.each(blank)("%j is blank to the server and to the editor", (text) => {
    expect(storedText(text)).toBeNull();
    expect(isBlankText(text)).toBe(true);
  });

  it.each(kept)("%j is text to the server and to the editor", (text) => {
    expect(storedText(text)).not.toBeNull();
    expect(isBlankText(text)).toBe(false);
  });
});

describe("the published versions an editor showed", () => {
  const save = (expectedPublished: unknown) =>
    saveAlbumJournalInput.safeParse({
      entryId: ENTRY,
      expectedVersion: 1,
      albumRating: null,
      expectedPublished,
    }).success;

  it("accepts a set of known languages, empty included, or nothing", () => {
    for (const shown of [[], ["en"], ["pt-BR"], ["en", "pt-BR"], undefined]) {
      expect(save(shown), JSON.stringify(shown)).toBe(true);
    }
  });

  it("refuses duplicates, unknown or miscased languages, and other types", () => {
    for (const shown of [
      ["en", "en"],
      ["es"],
      ["EN"],
      ["pt"],
      "en",
      null,
      [null],
      ["en", "pt-BR", "en"],
    ]) {
      expect(save(shown), JSON.stringify(shown)).toBe(false);
    }
  });
});
