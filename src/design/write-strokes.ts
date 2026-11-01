import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { strokesCss } from "./strokes";

// `pnpm design:strokes`: regenerates src/app/strokes.css. Deterministic: the
// drawings use fixed seeds, so running it twice changes nothing.
const target = fileURLToPath(new URL("../app/strokes.css", import.meta.url));
writeFileSync(target, strokesCss());
console.log(`Wrote ${target}`);
