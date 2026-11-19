import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("..", import.meta.url));

// docs/assets.md is the provenance record for every shipped artwork file.
function recordedAssets(): Map<string, string> {
  const record = readFileSync(`${root}docs/assets.md`, "utf8");
  const rows = record.matchAll(
    /^\| `(public\/[^`]+)` \| .* \| `([0-9a-f]{64})` \|$/gm,
  );
  return new Map([...rows].map((m) => [m[1]!, m[2]!]));
}

describe("shipped artwork", () => {
  const recorded = recordedAssets();

  it("matches its recorded provenance byte for byte", () => {
    expect(recorded.size).toBeGreaterThan(0);
    for (const [path, sha256] of recorded) {
      const actual = createHash("sha256")
        .update(readFileSync(`${root}${path}`))
        .digest("hex");
      expect(actual, path).toBe(sha256);
    }
  });

  it("has no file without a provenance record", () => {
    for (const dir of ["public/marcas", "public/icones"]) {
      for (const name of readdirSync(`${root}${dir}`)) {
        expect(recorded.has(`${dir}/${name}`), `${dir}/${name}`).toBe(true);
      }
    }
  });
});
