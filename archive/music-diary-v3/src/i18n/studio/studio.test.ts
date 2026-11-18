import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import ts from "typescript";
import { describe, expect, it } from "vitest";

import { CHANGE_PLACES } from "@/app/studio/journals/review-parts";
import { studioWords } from "@/i18n/studio";
import { studioEn } from "@/i18n/studio/en";
import { studioPtBR } from "@/i18n/studio/pt-BR";

// The Writing Studio's words (ADR 0008 § 4). The type check already refuses a
// missing or an extra key; these tests also hold what a type cannot: that
// nothing functional is left in English in the Portuguese Studio, that no
// value holds markup, that the fixed names the Journals module gives a
// change's place all have words, and that the Studio's words stay out of the
// public pages.

type Entry = { path: string; value: unknown };

function entries(value: unknown, path = ""): Entry[] {
  if (value !== null && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).flatMap(
      ([key, child]) => entries(child, path ? `${path}.${key}` : key),
    );
  }
  return [{ path, value }];
}

const english = new Map(
  entries(studioEn).map((entry) => [entry.path, entry.value]),
);
const portuguese = new Map(
  entries(studioPtBR).map((entry) => [entry.path, entry.value]),
);

/**
 * What a dictionary value says, with plain sample values for a function's
 * parameters: names, counts of one and of many, both sides of a choice.
 */
function said(value: unknown): string[] {
  if (typeof value === "string") {
    return [value];
  }
  const fn = value as (...args: unknown[]) => unknown;
  const samples: unknown[][] = [
    Array.from({ length: fn.length }, () => "[Test] Name"),
    Array.from({ length: fn.length }, () => 1),
    Array.from({ length: fn.length }, () => 3),
    Array.from({ length: fn.length }, () => true),
    Array.from({ length: fn.length }, () => false),
    Array.from({ length: fn.length }, () => null),
  ];
  return samples.map((args) => JSON.stringify(fn(...args)));
}

// The values that are rightly the same in both languages: each language's
// own name for itself, and the names of the services the Studio credits.
const SAME_IN_BOTH = new Set([
  "languageNames.en",
  "languageNames.pt-BR",
  "photograph.viaCommons",
  "photograph.sourceCommons",
  "journalMargin.coverSource",
]);

describe("the Studio's dictionaries", () => {
  it("have the same keys, of the same kinds", () => {
    expect([...portuguese.keys()].sort()).toEqual([...english.keys()].sort());
    for (const [path, value] of english) {
      expect(typeof portuguese.get(path), path).toBe(typeof value);
    }
    expect(english.size).toBeGreaterThan(600);
  });

  // A sample is left in English when both languages say it identically and
  // it still has words once the sample values (and "original", the same word
  // in both) are taken out: punctuation
  // between links (", ") and a sentence that is only the values it was given
  // are the same in any language. Every sample is compared, so a plural or a
  // branch left untranslated is caught too.
  const words = (text: string) =>
    /\p{L}{2}/u.test(
      text
        .replaceAll("[Test] Name", "")
        // "original" is the same word in Portuguese.
        .replaceAll("(original)", "")
        .replace(/\b(true|false|null)\b/g, ""),
    );

  it("leave nothing functional in English in Portuguese", () => {
    const same = [...english.keys()].filter((path) => {
      if (SAME_IN_BOTH.has(path)) {
        return false;
      }
      const there = said(portuguese.get(path));
      return said(english.get(path)).some(
        (text, index) => there[index] === text && words(text),
      );
    });
    expect(same).toEqual([]);
  });

  it("would notice a value or a branch left in English", () => {
    expect(words("[Test] Name, 3")).toBe(false);
    expect(words(", ")).toBe(false);
    expect(words("1 song found.")).toBe(true);
  });

  it("keep the names that are the same in both languages exactly that", () => {
    for (const path of SAME_IN_BOTH) {
      expect(portuguese.get(path), path).toBe(english.get(path));
    }
  });

  it("hold no markup: every value is rendered as text", () => {
    for (const map of [english, portuguese]) {
      for (const [path, value] of map) {
        for (const text of said(value)) {
          expect(text, path).not.toMatch(/<[a-z/]/i);
        }
      }
    }
  });

  it("are chosen by the interface language alone", () => {
    expect(studioWords("en")).toBe(studioEn);
    expect(studioWords("pt-BR")).toBe(studioPtBR);
  });

  it("write ratings and counts the Portuguese way", () => {
    expect(studioPtBR.rating.stars(1)).toBe("0,5 estrela");
    expect(studioPtBR.rating.stars(3)).toBe("1,5 estrela");
    expect(studioPtBR.rating.stars(9)).toBe("4,5 estrelas");
    expect(studioEn.rating.stars(2)).toBe("1 star");
    expect(studioEn.rating.stars(9)).toBe("4.5 stars");
    expect(studioPtBR.desk.journalsSummary(3, 1, 0, 2)).toBe(
      "3 diários: 1 rascunho, 0 privados, 2 publicados.",
    );
    expect(studioPtBR.desk.memoriesSummary(1, 0, 1, 0)).toBe(
      "1 memória: 0 rascunhos, 1 privada.",
    );
    expect(studioPtBR.counts.tracks(0)).toBe("0 faixas");
  });
});

describe("the places of a change to a public page", () => {
  // Every name `toChangeReview` and `toMemoryChangeReview` can give, read from
  // their source: a `label:` with a string, and the values of the field-label
  // tables.
  function moduleLabels(): string[] {
    const found = new Set<string>();
    for (const file of [
      "src/modules/journals/publishing.ts",
      "src/modules/journals/memory-publishing.ts",
    ]) {
      const source = ts.createSourceFile(
        file,
        readFileSync(file, "utf8"),
        ts.ScriptTarget.Latest,
        true,
      );
      const visit = (node: ts.Node) => {
        if (
          ts.isPropertyAssignment(node) &&
          node.name.getText() === "label" &&
          ts.isStringLiteral(node.initializer)
        ) {
          found.add(node.initializer.text);
        }
        if (
          ts.isVariableDeclaration(node) &&
          /FIELD_LABELS$/.test(node.name.getText()) &&
          node.initializer
        ) {
          let table = node.initializer;
          if (ts.isAsExpression(table)) {
            table = table.expression;
          }
          if (ts.isObjectLiteralExpression(table)) {
            for (const property of table.properties) {
              if (
                ts.isPropertyAssignment(property) &&
                ts.isStringLiteral(property.initializer)
              ) {
                found.add(property.initializer.text);
              }
            }
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
    }
    return [...found].sort();
  }

  it("all have words in both languages", () => {
    const labels = moduleLabels();
    expect(labels.length).toBeGreaterThanOrEqual(10);
    expect(labels.filter((label) => !(label in CHANGE_PLACES))).toEqual([]);
  });

  it("are said in English exactly as the module names them", () => {
    for (const [label, key] of Object.entries(CHANGE_PLACES)) {
      expect(studioEn.review.places[key], label).toBe(label);
    }
  });
});

describe("the Studio's words stay in the Studio", () => {
  function walk(directory: string): string[] {
    return readdirSync(directory, { recursive: true, encoding: "utf8" })
      .map((file) => join(directory, file).split("\\").join("/"))
      .filter((file) => /\.(m?[jt]sx?)$/.test(file));
  }

  it("is imported by no public page and no public dictionary", () => {
    const outside = [
      ...walk("src/app").filter(
        (file) =>
          !file.startsWith("src/app/studio/") &&
          !file.startsWith("src/app/(en)/studio/") &&
          !file.startsWith("src/app/pt/studio/"),
      ),
      ...walk("src/i18n").filter(
        (file) => !file.startsWith("src/i18n/studio/"),
      ),
      "src/proxy.ts",
    ];
    const importers = outside.filter((file) =>
      /from "@\/i18n\/studio/.test(readFileSync(file, "utf8")),
    );
    expect(importers).toEqual([]);
  });

  it("is not where the public pages' words are", () => {
    const studioRoutes = walk("src/app/studio").filter((file) =>
      /from "@\/i18n\/dictionaries/.test(readFileSync(file, "utf8")),
    );
    expect(studioRoutes).toEqual([]);
  });
});
