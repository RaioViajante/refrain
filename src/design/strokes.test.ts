import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { strokes, strokesCss } from "./strokes";

const committed = readFileSync(
  fileURLToPath(new URL("../app/strokes.css", import.meta.url)),
  "utf8",
);

describe("hand-drawn strokes", () => {
  it("are reproducible: the committed CSS is exactly what the generator writes", () => {
    expect(
      committed,
      "src/app/strokes.css is stale; run `pnpm design:strokes`",
    ).toBe(strokesCss());
  });

  it("are the same on every run, because their seeds are fixed", () => {
    expect(strokesCss()).toBe(strokesCss());
  });

  it("stretch to any size without changing the line's thickness", () => {
    for (const [name, markup] of Object.entries(strokes())) {
      expect(markup, name).toContain("preserveAspectRatio='none'");
      expect(markup, name).toContain("vector-effect='non-scaling-stroke'");
    }
  });

  it("use only the ink and gray tokens of the design system", () => {
    const colors = new Set(
      Object.values(strokes()).flatMap(
        (markup) => markup.match(/#[0-9a-fA-F]{6}/g) ?? [],
      ),
    );
    expect([...colors].sort()).toEqual(
      ["#111111", "#ABABAB", "#C8C8C8", "#CFCFCF"].sort(),
    );
  });
});
