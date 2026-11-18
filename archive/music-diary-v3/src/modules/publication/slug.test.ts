import { describe, expect, it } from "vitest";

import {
  isNormalizedSlug,
  MAX_SLUG_LENGTH,
  normalizeSlug,
  suffixSlug,
} from "./slug";

describe("normalizeSlug (ADR 0002, D7.2)", () => {
  it.each([
    ["Saudade de março", "saudade-de-marco"],
    ["Grace", "grace"],
    ["  Lover, You Should've Come Over  ", "lover-you-should-ve-come-over"],
    ["Ação & Reação — 1994", "acao-reacao-1994"],
    ["Ｆｕｌｌｗｉｄｔｈ", "fullwidth"],
    ["---[Test]---", "test"],
    ["Mojo Pin/Grace", "mojo-pin-grace"],
  ])("%s → %s", (input, expected) => {
    expect(normalizeSlug(input)).toBe(expected);
  });

  it("returns an empty string when nothing usable remains", () => {
    expect(normalizeSlug("サウダージ")).toBe("");
    expect(normalizeSlug("!!!")).toBe("");
  });

  it("limits the result to 80 characters without a trailing hyphen", () => {
    const slug = normalizeSlug(`${"a".repeat(79)} b c`);
    expect(slug).toBe("a".repeat(79));
    expect(isNormalizedSlug(slug)).toBe(true);

    const long = normalizeSlug("word ".repeat(40));
    expect(long.length).toBeLessThanOrEqual(MAX_SLUG_LENGTH);
    expect(isNormalizedSlug(long)).toBe(true);
  });

  it("is idempotent", () => {
    for (const input of [
      "Saudade de março",
      "Ação & Reação",
      "x".repeat(100),
    ]) {
      const once = normalizeSlug(input);
      expect(normalizeSlug(once)).toBe(once);
    }
  });
});

describe("suffixSlug (ADR 0002, D7.3)", () => {
  it("keeps the base for the first attempt and suffixes later ones", () => {
    expect(suffixSlug("grace", 1)).toBe("grace");
    expect(suffixSlug("grace", 2)).toBe("grace-2");
    expect(suffixSlug("grace", 13)).toBe("grace-13");
  });

  it("shortens a long base so the result stays within 80 characters", () => {
    const base = `${"a".repeat(77)}-bc`;
    const slug = suffixSlug(base, 2);
    expect(slug).toBe(`${"a".repeat(77)}-2`);
    expect(slug.length).toBeLessThanOrEqual(MAX_SLUG_LENGTH);
    expect(isNormalizedSlug(slug)).toBe(true);
  });

  it("rejects an attempt that is not a positive integer", () => {
    expect(() => suffixSlug("grace", 0)).toThrow(RangeError);
    expect(() => suffixSlug("grace", 1.5)).toThrow(RangeError);
  });
});

describe("isNormalizedSlug", () => {
  it.each(["grace", "grace-2", "a", "saudade-de-marco", "a".repeat(80)])(
    "accepts %s",
    (slug) => {
      expect(isNormalizedSlug(slug)).toBe(true);
    },
  );

  it.each([
    "",
    "Grace",
    "-grace",
    "grace-",
    "gr--ace",
    "março",
    "a b",
    "a".repeat(81),
  ])("rejects %j", (slug) => {
    expect(isNormalizedSlug(slug)).toBe(false);
  });
});
