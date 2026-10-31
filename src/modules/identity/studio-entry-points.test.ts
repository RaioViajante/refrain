import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// Every studio entry point authorizes the request itself (docs/security.md §
// Authorization contract). A layout or proxy is never the check, so this
// test looks at each page, route handler, and server-action file, not at
// layouts. It is static: a new entry point that forgets the check fails here
// before any HTTP test is written for it.
const STUDIO = join("src", "app", "studio");
const AUTHORIZATION_CALL = /\b(authorizeAuthor|requireAuthor)\(/;

function entryPoints(): string[] {
  return readdirSync(STUDIO, { recursive: true, encoding: "utf8" })
    .map((file) => join(STUDIO, file))
    .filter((file) => {
      if (!/\.(ts|tsx)$/.test(file) || /\.test\.tsx?$/.test(file)) {
        return false;
      }
      if (/(^|[\\/])(page|route)\.tsx?$/.test(file)) {
        return true;
      }
      return /^\s*["']use server["']/m.test(readFileSync(file, "utf8"));
    });
}

describe("studio entry points", () => {
  it("include the studio page and the sign-in page", () => {
    // Proves the scan finds entry points at all; new ones are checked below.
    expect(entryPoints()).toEqual(
      expect.arrayContaining([
        join(STUDIO, "page.tsx"),
        join(STUDIO, "sign-in", "page.tsx"),
      ]),
    );
  });

  it.each(entryPoints())("%s authorizes the request itself", (file) => {
    expect(readFileSync(file, "utf8")).toMatch(AUTHORIZATION_CALL);
  });
});
