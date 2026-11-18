import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { contrastOnWhite } from "./contrast";
import {
  STAR_INK_FILES,
  starDrawing,
  starInkModule,
  strokes,
  strokesCss,
} from "./strokes";

const committed = readFileSync(
  fileURLToPath(new URL("../app/strokes.css", import.meta.url)),
  "utf8",
);

describe("the rating star", () => {
  const numbers = (d: string) => (d.match(/-?\d+\.?\d*/g) ?? []).map(Number);

  it.each(STAR_INK_FILES)(
    "is reproducible, and the same on both sides: %s is what the generator writes",
    (file) => {
      expect(
        readFileSync(
          fileURLToPath(new URL(`../../${file}`, import.meta.url)),
          "utf8",
        ),
        `${file} is stale; run \`pnpm design:strokes\``,
      ).toBe(starInkModule());
    },
  );

  it("is drawn twice round: two passes over each of its ten edges", () => {
    expect(starDrawing().outline.match(/M/g)).toHaveLength(20);
  });

  it("stays inside its square, so nothing is clipped at any size", () => {
    for (const value of numbers(starDrawing().outline)) {
      expect(value).toBeGreaterThanOrEqual(0.5);
      expect(value).toBeLessThanOrEqual(23.5);
    }
  });

  it("is a star with room for its ink: the half fill stays inside the whole", () => {
    const { fill, leftHalfFill } = starDrawing();
    const pairs = (d: string) => {
      const n = numbers(d);
      return Array.from(
        { length: n.length / 2 },
        (_, i) => `${n[2 * i]} ${n[2 * i + 1]}`,
      );
    };
    expect(pairs(fill)).toHaveLength(10);
    for (const point of pairs(leftHalfFill)) {
      expect(pairs(fill)).toContain(point);
    }
    expect(
      Math.max(...numbers(leftHalfFill).filter((_, i) => i % 2 === 0)),
    ).toBe(12);
  });
});

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

  it("draw every control boundary with at least 3:1 contrast on white (WCAG 2.2, 1.4.11)", () => {
    // Decorative lines are not control boundaries, and a disabled control is
    // exempt: it is a dashed gray on purpose.
    // The Home's artwork frame is the edge of a picture inside a link whose
    // text names it, not the boundary of a control.
    const NOT_BOUNDARIES = new Set([
      "rule",
      "underline",
      "button-disabled",
      "frame",
      "frame-small",
    ]);
    for (const [name, markup] of Object.entries(strokes())) {
      if (NOT_BOUNDARIES.has(name)) {
        continue;
      }
      const colors = markup.match(/stroke='(#[0-9a-fA-F]{6})'/g) ?? [];
      expect(colors.length, `${name} has a stroke`).toBeGreaterThan(0);
      for (const color of colors) {
        const hex = color.slice(8, 15);
        expect(
          contrastOnWhite(hex),
          `${name} is drawn in ${hex}`,
        ).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it("stay inside their box, so a stretched drawing is never clipped", () => {
    const sizes: Record<string, [number, number]> = {
      button: [160, 44],
      "button-hover": [160, 44],
      "button-focus": [160, 44],
      "button-primary": [160, 44],
      field: [600, 48],
      "field-hover": [600, 48],
      area: [760, 440],
      frame: [400, 400],
      "frame-small": [60, 60],
      dialog: [540, 300],
    };
    // Generated once: each call redraws every stroke (about 200 ms), and
    // asking for it once per size made this test slow enough to time out on a
    // loaded CI runner. The assertions below are unchanged.
    const drawn = strokes();
    for (const [name, [width, height]] of Object.entries(sizes)) {
      const markup = drawn[name]!;
      const numbers = [...markup.matchAll(/ d='([^']+)'/g)].flatMap((match) =>
        (match[1]!.match(/-?\d+\.?\d*/g) ?? []).map(Number),
      );
      numbers.forEach((value, index) => {
        const limit = index % 2 === 0 ? width : height;
        expect(value, `${name} leaves its box`).toBeGreaterThanOrEqual(-1.001);
        expect(value, `${name} leaves its box`).toBeLessThanOrEqual(
          limit + 1.001,
        );
      });
    }
  });

  it("use only the ink and gray tokens of the design system", () => {
    const colors = new Set(
      Object.values(strokes()).flatMap(
        (markup) => markup.match(/#[0-9a-fA-F]{6}/g) ?? [],
      ),
    );
    expect([...colors].sort()).toEqual(
      ["#111111", "#767676", "#BDBDBD", "#C8C8C8", "#CFCFCF"].sort(),
    );
  });
});
