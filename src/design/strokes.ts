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
const QUIET = "#ABABAB"; // frame-quiet, the writing surface outline
const RULE = "#CFCFCF"; // rule, the light divider
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

function rectangle(
  width: number,
  height: number,
  seed: number,
  roughness = 0.9,
): string {
  const inset = 3;
  const drawable = generator.rectangle(
    inset,
    inset,
    width - inset * 2,
    height - inset * 2,
    { seed, roughness, bowing: 0.8 },
  );
  return round(
    generator
      .toPaths(drawable)
      .map((path) => path.d)
      .join(" "),
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
          roughness: 0.6,
          bowing: 0.5,
          single: true,
        }),
        stroke: RULE,
        width: 1,
      },
    ]),
    underline: svg(200, 10, [
      {
        d: line(2, 6, 197, 5, 71, { roughness: 0.7, single: true }),
        stroke: INK,
        width: 1.6,
      },
      {
        d: line(1, 7.5, 196, 6.5, 72, { roughness: 0.7, single: true }),
        stroke: INK,
        width: 1.2,
      },
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
