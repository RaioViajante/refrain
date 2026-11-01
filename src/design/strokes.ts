import rough from "roughjs";

// The hand-drawn outlines of the Writing Studio (docs/design-system.md
// § Rough.js implementation): generated once, with fixed seeds, and shipped as
// plain CSS. Nothing is drawn at render time, so nothing can differ between
// the server and the browser, and Rough.js never reaches the application's
// bundle. `pnpm design:strokes` writes src/app/strokes.css from this file, and
// a unit test fails if the two ever disagree.
//
// Every shape is an SVG with `preserveAspectRatio="none"` and
// `vector-effect: non-scaling-stroke`, so one drawing fits any width or height
// and its line keeps the same thickness at every size.

const INK = "#111111";
// frame-quiet: the quiet outline of the writing surface and of the opening
// sentence. 4.54:1 on white, so it clears the 3:1 that WCAG 2.2 (1.4.11 Non-text
// Contrast) asks of a control boundary with room for a thin, anti-aliased line.
// The V4.4 mockups used #ABABAB (2.3:1), which does not.
const QUIET = "#767676";
const RULE = "#CFCFCF"; // rule, the light divider (decorative, never a control)
const DISABLED = "#C8C8C8";

const generator = rough.generator();

interface Layer {
  d: string;
  stroke?: string;
  width?: number;
  fill?: string;
  dash?: string;
  shift?: [number, number];
}

/** One decimal is plenty for a hand-drawn line, and keeps the CSS small. */
function round(d: string): string {
  return d.replace(/-?\d+\.\d+/g, (n) => String(Number(Number(n).toFixed(1))));
}

/** The largest distance by which any coordinate of a path leaves its box. */
function overshoot(d: string, width: number, height: number): number {
  const numbers = (d.match(/-?\d+\.?\d*/g) ?? []).map(Number);
  let worst = 0;
  numbers.forEach((value, index) => {
    const limit = index % 2 === 0 ? width : height;
    worst = Math.max(worst, -value, value - limit);
  });
  return worst;
}

// How far a drawing may leave its box. The reference's outlines stay within
// about 0.2 units of it; beyond a unit the stretched SVG would be clipped.
const MAX_OVERSHOOT = 1;

/**
 * A hand-drawn rectangle. The outline runs close to the edge of its box, as
 * the reference's does (its strokes span x -0.2 to 159.9 in a 160-unit box); a
 * larger inset made every control look smaller and quieter than the design.
 * Rough.js jitters the corners, so from the given seed the first drawing that
 * stays within MAX_OVERSHOOT of the box is used: still fixed and reproducible,
 * and never clipped.
 */
function rectangle(
  width: number,
  height: number,
  seed: number,
  roughness = 0.9,
): string {
  const inset = 0.8;
  for (let attempt = seed; attempt < seed + 400; attempt += 1) {
    const drawable = generator.rectangle(
      inset,
      inset,
      width - inset * 2,
      height - inset * 2,
      { seed: attempt, roughness, bowing: 0.8 },
    );
    const d = round(
      generator
        .toPaths(drawable)
        .map((path) => path.d)
        .join(" "),
    );
    if (overshoot(d, width, height) <= MAX_OVERSHOOT) {
      return d;
    }
  }
  throw new Error(
    `No ${width}x${height} outline fits its box from seed ${seed}.`,
  );
}

function line(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  seed: number,
  options: { roughness?: number; bowing?: number; single?: boolean } = {},
): string {
  const drawable = generator.line(x1, y1, x2, y2, {
    seed,
    roughness: options.roughness ?? 0.8,
    bowing: options.bowing ?? 0.6,
    disableMultiStroke: options.single ?? false,
  });
  return round(
    generator
      .toPaths(drawable)
      .map((path) => path.d)
      .join(" "),
  );
}

/** A slightly irregular quadrilateral: the ink behind a primary button. */
function inkBlock(width: number, height: number, seed: number): string {
  let state = seed;
  const next = () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
  const jitter = () => next() * 2.4;
  const p = [
    [0.6 + jitter(), 0.4 + jitter()],
    [width - 1 - jitter(), 1 + jitter()],
    [width - 0.6 - jitter(), height - 1.5 - jitter()],
    [0.4 + jitter(), height - 0.6 - jitter()],
  ] as const;
  return round(
    `M${p[0][0].toFixed(2)} ${p[0][1].toFixed(2)} ` +
      p
        .slice(1)
        .map(([x, y]) => `L${x.toFixed(2)} ${y.toFixed(2)}`)
        .join(" ") +
      " Z",
  );
}

/** A small seeded random generator, so a drawing never changes between runs. */
function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

/**
 * A hand-drawn underline: one stroke that rises and falls along its length,
 * through points that wobble by a seeded amount. The reference's underline is
 * a visible swoosh about 4 units tall in a 10-unit box, not a flat line.
 */
function swoosh(seed: number, baseY: number, amplitude: number): string {
  const next = seeded(seed);
  const xs = [2, 62, 132, 197];
  const ys = [baseY + 0.5, baseY - 1, baseY + 0.6, baseY - 0.7].map(
    (y, index) =>
      y +
      (index % 2 === 0 ? 1 : -1) * amplitude * (0.5 + next() * 0.5) * 0.4 +
      (next() - 0.5) * 0.6,
  );
  const points = xs.map((x, i) => [x, ys[i]!] as const);
  const at = (i: number) =>
    points[Math.max(0, Math.min(points.length - 1, i))]!;
  let d = `M${points[0]![0]} ${points[0]![1].toFixed(1)}`;
  for (let i = 0; i < points.length - 1; i += 1) {
    const [p0, p1, p2, p3] = [at(i - 1), at(i), at(i + 1), at(i + 2)];
    d += ` C${(p1[0] + (p2[0] - p0[0]) / 6).toFixed(1)} ${(p1[1] + (p2[1] - p0[1]) / 6).toFixed(1)}, ${(p2[0] - (p3[0] - p1[0]) / 6).toFixed(1)} ${(p2[1] - (p3[1] - p1[1]) / 6).toFixed(1)}, ${p2[0]} ${p2[1].toFixed(1)}`;
  }
  return round(d);
}

function svg(width: number, height: number, layers: Layer[]): string {
  const paths = layers
    .map((layer) => {
      const attributes = [
        `d='${layer.d}'`,
        `fill='${layer.fill ?? "none"}'`,
        layer.stroke ? `stroke='${layer.stroke}'` : "stroke='none'",
        layer.stroke ? `stroke-width='${layer.width ?? 1.15}'` : "",
        layer.stroke
          ? "stroke-linecap='round' stroke-linejoin='round' vector-effect='non-scaling-stroke'"
          : "",
        layer.dash ? `stroke-dasharray='${layer.dash}'` : "",
        layer.shift
          ? `transform='translate(${layer.shift[0]} ${layer.shift[1]})'`
          : "",
      ];
      return `<path ${attributes.filter(Boolean).join(" ")}/>`;
    })
    .join("");
  return (
    `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 ${width} ${height}' ` +
    `preserveAspectRatio='none'>${paths}</svg>`
  );
}

function url(markup: string): string {
  return `url("data:image/svg+xml,${encodeURIComponent(markup)}")`;
}

const BUTTON = { w: 160, h: 44 };
const FIELD = { w: 600, h: 48 };
const AREA = { w: 760, h: 440 };
const DIALOG = { w: 540, h: 300 };

/** Every stroke, by the name its CSS custom property gets. */
export function strokes(): Record<string, string> {
  const button = (seed: number) => rectangle(BUTTON.w, BUTTON.h, seed, 1.15);
  const field = (seed: number) => rectangle(FIELD.w, FIELD.h, seed, 1.3);
  const area = (seed: number) => rectangle(AREA.w, AREA.h, seed, 1.6);
  return {
    button: svg(BUTTON.w, BUTTON.h, [{ d: button(11), stroke: INK }]),
    "button-hover": svg(BUTTON.w, BUTTON.h, [{ d: button(12), stroke: INK }]),
    "button-focus": svg(BUTTON.w, BUTTON.h, [
      { d: button(11), stroke: INK, width: 1.9 },
    ]),
    "button-disabled": svg(BUTTON.w, BUTTON.h, [
      { d: button(11), stroke: DISABLED, dash: "3 5" },
    ]),
    "button-primary": svg(BUTTON.w, BUTTON.h, [
      { d: inkBlock(BUTTON.w, BUTTON.h, 21), fill: INK },
      { d: button(11), stroke: INK },
    ]),
    "button-primary-hover": svg(BUTTON.w, BUTTON.h, [
      { d: inkBlock(BUTTON.w, BUTTON.h, 21), fill: INK },
      { d: button(11), stroke: INK },
      { d: button(12), stroke: INK, shift: [2, 2] },
    ]),
    field: svg(FIELD.w, FIELD.h, [{ d: field(31), stroke: INK, width: 1.3 }]),
    "field-hover": svg(FIELD.w, FIELD.h, [
      { d: field(32), stroke: INK, width: 1.3 },
    ]),
    "field-focus": svg(FIELD.w, FIELD.h, [
      { d: field(31), stroke: INK, width: 1.9 },
    ]),
    area: svg(AREA.w, AREA.h, [{ d: area(41), stroke: QUIET, width: 1.2 }]),
    "area-hover": svg(AREA.w, AREA.h, [
      { d: area(42), stroke: QUIET, width: 1.2 },
    ]),
    "area-focus": svg(AREA.w, AREA.h, [
      { d: area(41), stroke: INK, width: 1.6 },
    ]),
    dialog: svg(DIALOG.w, DIALOG.h, [
      { d: rectangle(DIALOG.w, DIALOG.h, 51, 0.8), stroke: INK, width: 1.4 },
    ]),
    rule: svg(1200, 8, [
      {
        d: line(2, 4, 1198, 4, 61, {
          roughness: 0.9,
          bowing: 1.1,
          single: true,
        }),
        stroke: RULE,
        width: 1,
      },
    ]),
    "opening-line": svg(1200, 8, [
      {
        d: line(2, 4, 1198, 4, 62, {
          roughness: 0.9,
          bowing: 1.1,
          single: true,
        }),
        stroke: QUIET,
        width: 1.2,
      },
    ]),
    "rule-focus": svg(1200, 8, [
      {
        d: line(2, 4, 1198, 4, 62, {
          roughness: 0.9,
          bowing: 1.1,
          single: true,
        }),
        stroke: INK,
        width: 1.6,
      },
    ]),
    underline: svg(200, 10, [
      { d: swoosh(71, 5.2, 4), stroke: INK, width: 1.6 },
      { d: swoosh(72, 6.6, 4), stroke: INK, width: 1.2 },
    ]),
  };
}

/** The contents of src/app/strokes.css. */
export function strokesCss(): string {
  const lines = Object.entries(strokes()).map(
    ([name, markup]) => `  --stroke-${name}: ${url(markup)};`,
  );
  return [
    "/*",
    " * GENERATED by `pnpm design:strokes` from src/design/strokes.ts. Do not edit.",
    " * Hand-drawn outlines (Rough.js, fixed seeds) as inline SVG, so a drawing",
    " * never changes between renders. See docs/design-system.md § Rough.js",
    " * implementation and docs/design/studio-visual-fidelity.md.",
    " */",
    ":root {",
    ...lines,
    "}",
    "",
  ].join("\n");
}
