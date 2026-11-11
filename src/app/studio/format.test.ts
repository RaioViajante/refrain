import { describe, expect, it } from "vitest";

import { studioEn } from "@/i18n/studio/en";
import { studioPtBR } from "@/i18n/studio/pt-BR";

import { formatDuration, parseDuration } from "./format";

describe("formatDuration", () => {
  it.each([
    [null, ""],
    [222_000, "3:42"],
    [59_000, "0:59"],
    [3_723_000, "1:02:03"],
    [1_000, "0:01"],
  ])("formats %s", (ms, text) => {
    expect(formatDuration(ms)).toBe(text);
  });
});

describe("parseDuration", () => {
  it.each([
    ["", null],
    ["  ", null],
    ["3:42", 222_000],
    ["03:42", 222_000],
    ["1:02:03", 3_723_000],
    ["90", 90_000],
    ["0:01", 1_000],
  ])("reads %j", (text, ms) => {
    expect(parseDuration(text)).toBe(ms);
  });

  it.each([
    "abc",
    "3:60",
    "3:4",
    "-1",
    "0",
    "0:00",
    "1:2:3:4",
    "3.5",
    "99999999",
  ])("refuses %j", (text) => {
    expect(parseDuration(text)).toBeUndefined();
  });

  it("round-trips what it formats", () => {
    for (const ms of [1_000, 61_000, 222_000, 3_600_000, 5_999_000]) {
      expect(parseDuration(formatDuration(ms))).toBe(ms);
    }
  });
});

// Counting moved to the Studio's dictionaries (src/i18n/studio), through the
// shared `counted` (src/i18n/format.ts): the same counts, in each language.
describe("counts", () => {
  it("counts", () => {
    expect(studioEn.counts.albums(1)).toBe("1 album");
    expect(studioEn.counts.albums(0)).toBe("0 albums");
    expect(studioEn.albums.usedIn(2)).toBe("used in 2 entries");
  });

  it("counts in Portuguese, zero with the plural", () => {
    expect(studioPtBR.counts.albums(1)).toBe("1 álbum");
    expect(studioPtBR.counts.albums(0)).toBe("0 álbuns");
    expect(studioPtBR.albums.usedIn(2)).toBe("usado em 2 entradas");
  });
});
