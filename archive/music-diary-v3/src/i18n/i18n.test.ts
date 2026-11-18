import { describe, expect, it } from "vitest";

import { dictionaryFor } from "@/i18n/dictionaries";
import { en } from "@/i18n/dictionaries/en";
import { ptBR } from "@/i18n/dictionaries/pt-BR";
import { counted, formatDate, ratingText } from "@/i18n/format";
import { INTERFACE_LOCALES, LOCALE_PREFIX } from "@/i18n/locales";
import { addressPair, localizedHref } from "@/i18n/paths";

// The interface's languages (ADR 0008 §§ 4 to 6). The type check already
// refuses a missing or an extra key; these tests also hold what a type cannot:
// that nothing functional is left in English in Portuguese, that the authored
// sentences waiting for the owner are exactly the known ones, and that every
// link keeps its language and stays on this site.

type Entry = { path: string; value: unknown };

function entries(value: unknown, path = ""): Entry[] {
  if (value !== null && typeof value === "object" && !("text" in value)) {
    return Object.entries(value as Record<string, unknown>).flatMap(
      ([key, child]) => entries(child, path ? `${path}.${key}` : key),
    );
  }
  return [{ path, value }];
}

const english = new Map(entries(en).map((entry) => [entry.path, entry.value]));
const portuguese = new Map(
  entries(ptBR).map((entry) => [entry.path, entry.value]),
);

/** A sample call of a dictionary function, with plain values. */
function sample(value: unknown): string {
  if (typeof value === "function") {
    const fn = value as (...args: unknown[]) => string;
    return fn.length >= 2
      ? fn(3, 7)
      : fn.toString().includes("count")
        ? fn(2)
        : fn("Grace");
  }
  if (typeof value === "string") {
    return value;
  }
  return (value as { text: string }).text;
}

// The values that are rightly the same in both languages: names, and the
// separator around a name.
const SAME_IN_BOTH = new Set([
  "site.name",
  "photo.commons",
  "photo.viaCommons",
  "writtenIn",
]);

// The authored sentences that keep their English in Portuguese until the
// owner approves a translation (ADR 0008 § 4). Adding one is a decision for
// the owner, never a way around a missing translation.
const AWAITING_APPROVAL = [
  "archives.artists.lead",
  "archives.memories.lead",
  "home.introduction",
];

describe("the dictionaries", () => {
  it("have the same keys, of the same kinds", () => {
    expect([...portuguese.keys()].sort()).toEqual([...english.keys()].sort());
    for (const [path, value] of english) {
      expect(typeof portuguese.get(path), path).toBe(typeof value);
    }
    expect(english.size).toBeGreaterThan(80);
  });

  it("leave nothing functional in English in Portuguese", () => {
    const same = [...english.keys()].filter(
      (path) =>
        !SAME_IN_BOTH.has(path) &&
        !AWAITING_APPROVAL.includes(path) &&
        sample(english.get(path)) === sample(portuguese.get(path)),
    );
    expect(same).toEqual([]);
  });

  it("keep English only for the authored sentences awaiting approval, marked as English", () => {
    const authored = [...portuguese.entries()].filter(
      ([, value]) =>
        typeof value === "object" && value !== null && "lang" in value,
    );
    const awaiting = authored
      .filter(([, value]) => (value as { lang: string }).lang === "en")
      .map(([path]) => path)
      .sort();
    expect(awaiting).toEqual(AWAITING_APPROVAL);
    for (const path of AWAITING_APPROVAL) {
      expect(portuguese.get(path)).toEqual({
        text: (english.get(path) as { text: string }).text,
        lang: "en",
      });
    }
    // Every other authored sentence is in its page's language.
    for (const [path, value] of authored) {
      if (!AWAITING_APPROVAL.includes(path)) {
        expect((value as { lang: string }).lang, path).toBe("pt-BR");
      }
    }
    for (const [path, value] of english) {
      if (typeof value === "object" && value !== null && "lang" in value) {
        expect((value as { lang: string }).lang, path).toBe("en");
      }
    }
  });

  it("hold no markup: every value is rendered as text", () => {
    for (const map of [english, portuguese]) {
      for (const [path, value] of map) {
        expect(sample(value), path).not.toMatch(/[<>]/);
      }
    }
  });

  it("are chosen by the interface language alone", () => {
    expect(dictionaryFor("en")).toBe(en);
    expect(dictionaryFor("pt-BR")).toBe(ptBR);
  });
});

describe("links in each language", () => {
  it("keep English addresses as they are, and prefix Portuguese ones", () => {
    expect(localizedHref("en", "/")).toBe("/");
    expect(localizedHref("en", "/albums/grace")).toBe("/albums/grace");
    expect(localizedHref("pt-BR", "/")).toBe("/pt");
    expect(localizedHref("pt-BR", "/albums")).toBe("/pt/albums");
    expect(localizedHref("pt-BR", "/albums/grace#tracks")).toBe(
      "/pt/albums/grace#tracks",
    );
    expect(localizedHref("pt-BR", "/#main")).toBe("/pt#main");
  });

  it("name only a path on this site", () => {
    for (const path of ["https://example.com/", "//example.com/x", "albums"]) {
      for (const locale of INTERFACE_LOCALES) {
        expect(() => localizedHref(locale, path), path).toThrow();
      }
    }
  });

  it("give every page the same pair, whatever the language of the page", () => {
    expect(addressPair("/memories/x")).toEqual({
      en: "/memories/x",
      "pt-BR": "/pt/memories/x",
    });
    expect(LOCALE_PREFIX).toEqual({ en: "", "pt-BR": "/pt" });
  });
});

describe("formats", () => {
  const at = new Date("2026-11-10T23:30:00Z");

  it("write dates in UTC, in the interface language", () => {
    expect(formatDate("en", at)).toBe("Nov 10, 2026");
    expect(formatDate("en", at, "long")).toBe("November 10, 2026");
    expect(formatDate("pt-BR", at)).toBe("10 de nov. de 2026");
    expect(formatDate("pt-BR", at, "long")).toBe("10 de novembro de 2026");
  });

  it("write a rating with the language's decimal mark", () => {
    expect(ratingText("en", 9)).toBe("4.5");
    expect(ratingText("pt-BR", 9)).toBe("4,5");
    expect(ratingText("pt-BR", 8)).toBe("4");
  });

  it("count with the plural for every number but one, zero included", () => {
    expect(counted("pt-BR", 0, "faixa", "faixas")).toBe("0 faixas");
    expect(counted("pt-BR", 1, "faixa", "faixas")).toBe("1 faixa");
    expect(counted("pt-BR", 2, "faixa", "faixas")).toBe("2 faixas");
    expect(counted("en", 1, "track", "tracks")).toBe("1 track");
    expect(counted("en", 0, "track", "tracks")).toBe("0 tracks");
  });
});
