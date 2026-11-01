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

/** What a hand-drawn rectangle looks like, in units of its own viewBox. */
interface Character {
  /** How far apart the two passes of one edge start and end. */
  separation: number;
  /** How far one edge's end is from the next edge's start, at a corner. */
  cornerGap: number;
  /** How far the points of an edge wander off a straight line. */
  spread: number;
}

/**
 * Measured on the reference's own outlines (docs/design/studio-visual-fidelity.md
 * § Stroke fidelity) and converted to the units of our viewBoxes by the size each
 * is drawn at. A seeded generator makes outlines that are too even; choosing,
 * from a fixed run of seeds, the one that is nearest to these makes them read as
 * drawn by a hand, and the choice is still the same every time.
 */
const BUTTON_CHARACTER: Character = {
  separation: 2,
  cornerGap: 3,
  spread: 1.1,
};
const FIELD_CHARACTER: Character = {
  separation: 1,
  cornerGap: 1.5,
  spread: 0.7,
};
const DIALOG_CHARACTER: Character = {
  separation: 3.4,
  cornerGap: 5,
  spread: 2.7,
};

const distance = (a: readonly number[], b: readonly number[]) =>
  Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!);

/** The two ends of every stroke of a rectangle: 8 strokes, 2 per edge. */
function strokeEnds(d: string): [number[], number[]][] {
  return d
    .split(/(?=M)/)
    .filter((part) => part.trim() !== "")
    .map((part) => {
      const n = (part.match(/-?\d+\.?\d*/g) ?? []).map(Number);
      return [
        [n[0]!, n[1]!],
        [n[n.length - 2]!, n[n.length - 1]!],
      ];
    });
}

function characterOf(d: string, width: number, height: number): Character {
  const strokes = strokeEnds(d);
  if (strokes.length !== 8) {
    throw new Error(
      `A rectangle outline has 8 strokes (two per edge); this one has ${strokes.length}.`,
    );
  }
  let separation = 0;
  let cornerGap = 0;
  for (let edge = 0; edge < 4; edge += 1) {
    const [first, second] = [strokes[2 * edge]!, strokes[2 * edge + 1]!];
    separation +=
      (distance(first[0], second[0]) + distance(first[1], second[1])) / 2;
    cornerGap += distance(first[1], strokes[(2 * edge + 2) % 8]![0]);
  }
  const points = (d.match(/-?\d+\.?\d*/g) ?? []).map(Number);
  const pairs: [number, number][] = [];
  for (let i = 0; i + 1 < points.length; i += 2) {
    pairs.push([points[i]!, points[i + 1]!]);
  }
  const range = (values: number[]) =>
    values.length > 1 ? Math.max(...values) - Math.min(...values) : 0;
  const spread =
    (range(
      pairs
        .filter(
          ([x, y]) => y < height * 0.35 && x > width * 0.1 && x < width * 0.9,
        )
        .map(([, y]) => y),
    ) +
      range(
        pairs
          .filter(
            ([x, y]) => y > height * 0.65 && x > width * 0.1 && x < width * 0.9,
          )
          .map(([, y]) => y),
      ) +
      range(
        pairs
          .filter(
            ([x, y]) => x < width * 0.2 && y > height * 0.2 && y < height * 0.8,
          )
          .map(([x]) => x),
      ) +
      range(
        pairs
          .filter(
            ([x, y]) => x > width * 0.8 && y > height * 0.2 && y < height * 0.8,
          )
          .map(([x]) => x),
      )) /
    4;
  return { separation: separation / 4, cornerGap: cornerGap / 4, spread };
}

/**
 * A hand-drawn rectangle. The outline runs close to the edge of its box, as
 * the reference's does (its strokes span x -0.2 to 159.9 in a 160-unit box); a
 * larger inset made every control look smaller and quieter than the design.
 *
 * From the given seed, the next 600 seeds are tried. Of the drawings that stay
 * within MAX_OVERSHOOT of the box (so nothing is clipped), the one whose
 * character is nearest the target is used: fixed, reproducible, and never
 * the too-even outline a single seed can give.
 */
function rectangle(
  width: number,
  height: number,
  seed: number,
  roughness: number,
  target: Character,
): string {
  const inset = 0.8;
  let best: { d: string; score: number } | undefined;
  for (let attempt = seed; attempt < seed + 600; attempt += 1) {
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
    if (overshoot(d, width, height) > MAX_OVERSHOOT) {
      continue;
    }
    const found = characterOf(d, width, height);
    const score =
      Math.abs(found.separation - target.separation) +
      Math.abs(found.cornerGap - target.cornerGap) +
      Math.abs(found.spread - target.spread);
    if (!best || score < best.score) {
      best = { d, score };
    }
  }
  if (!best) {
    throw new Error(
      `No ${width}x${height} outline fits its box from seed ${seed}.`,
    );
  }
  return best.d;
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
 * A hand-drawn underline: one stroke that dips and lifts along its length. Its
 * handles are horizontal at every anchor, so it rests flat at the top and
 * bottom of each swing instead of being a continuous sine, as the reference's
 * is: it starts low, rises to a plateau, falls back, and lifts at the end. The
 * anchors wobble by a seeded amount.
 */
function swoosh(seed: number, baseY: number, amplitude: number): string {
  const next = seeded(seed);
  const wobble = () => (next() - 0.5) * 0.7;
  const xs = [2, 61, 131, 197];
  // Low, high, low, high-ish: the reference's 6.6, 2.8, 6.6, 3.4.
  const ys = [
    baseY + amplitude * 0.5 + wobble(),
    baseY - amplitude * 0.5 + wobble(),
    baseY + amplitude * 0.5 + wobble(),
    baseY - amplitude * 0.3 + wobble(),
  ];
  let d = `M${xs[0]} ${ys[0]!.toFixed(1)}`;
  for (let i = 0; i < xs.length - 1; i += 1) {
    const dx = xs[i + 1]! - xs[i]!;
    d += ` C${(xs[i]! + dx * 0.4).toFixed(1)} ${ys[i]!.toFixed(1)}, ${(xs[i + 1]! - dx * 0.4).toFixed(1)} ${ys[i + 1]!.toFixed(1)}, ${xs[i + 1]} ${ys[i + 1]!.toFixed(1)}`;
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
  const button = (seed: number) =>
    rectangle(BUTTON.w, BUTTON.h, seed, 1.5, BUTTON_CHARACTER);
  const field = (seed: number) =>
    rectangle(FIELD.w, FIELD.h, seed, 1.2, FIELD_CHARACTER);
  const area = (seed: number) =>
    rectangle(AREA.w, AREA.h, seed, 1.2, FIELD_CHARACTER);
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
      {
        d: rectangle(DIALOG.w, DIALOG.h, 51, 2.2, DIALOG_CHARACTER),
        stroke: INK,
        width: 1.4,
      },
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
      { d: swoosh(71, 4.9, 3.8), stroke: INK, width: 1.6 },
      // The same wobble, a little lower: the two passes of one hand run together.
      { d: swoosh(71, 6.3, 3.8), stroke: INK, width: 1.2 },
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
