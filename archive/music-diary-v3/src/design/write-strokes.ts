import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { STAR_INK_FILES, starInkModule, strokesCss } from "./strokes";

// `pnpm design:strokes`: regenerates src/app/strokes.css and both copies of the
// rating star. Deterministic: the drawings use fixed seeds, so running it twice
// changes nothing.
const target = fileURLToPath(new URL("../app/strokes.css", import.meta.url));
writeFileSync(target, strokesCss());
console.log(`Wrote ${target}`);

for (const file of STAR_INK_FILES) {
  const star = fileURLToPath(new URL(`../../${file}`, import.meta.url));
  writeFileSync(star, starInkModule());
  console.log(`Wrote ${star}`);
}
