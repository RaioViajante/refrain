import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { MARK_FILES, MARKS_CLEARED } from "@/components/marks";

const root = fileURLToPath(new URL("..", import.meta.url));

// docs/assets.md is the record of every shipped artwork file: only rows of its
// "Shipped" table (path in public/ and a SHA-256) count.
function shippedAssets(): Map<string, string> {
  const record = readFileSync(`${root}docs/assets.md`, "utf8");
  const shipped = record.split("## Pending")[0] ?? "";
  const rows = shipped.matchAll(
    /^\| `(public\/[^`]+)` \|.*\| `([0-9a-f]{64})` \|$/gm,
  );
  return new Map([...rows].map((m) => [m[1]!, m[2]!]));
}

function publicFiles(dir = "public"): string[] {
  if (!existsSync(`${root}${dir}`)) return [];
  return readdirSync(`${root}${dir}`, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? publicFiles(`${dir}/${e.name}`) : [`${dir}/${e.name}`],
  );
}

describe("shipped artwork", () => {
  const shipped = shippedAssets();

  it("ships only files recorded with their evidence", () => {
    for (const path of publicFiles()) {
      expect(shipped.has(path), `${path} is not in docs/assets.md`).toBe(true);
    }
  });

  it("matches each record byte for byte", () => {
    for (const [path, sha256] of shipped) {
      const actual = createHash("sha256")
        .update(readFileSync(`${root}${path}`))
        .digest("hex");
      expect(actual, path).toBe(sha256);
    }
  });

  it("renders the drawn marks only once every mark file is shipped", () => {
    if (!MARKS_CLEARED) return;
    for (const src of MARK_FILES) {
      expect(shipped.has(`public${src}`), src).toBe(true);
    }
  });
});
