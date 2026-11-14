// The cover display switch (docs/security.md § Deployment gate, item 6): off
// unless exactly `true`, and the only way any module can build a cover's
// image addresses.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { FIXTURE } from "@/testing/provider-fixtures";

import * as entry from ".";
import {
  COVER_DISPLAY_VARIABLE,
  coverDisplayEnabled,
  displayedCoverFor,
  displayedCoverOf,
  displayedFrontThumbnailFor,
} from "./display";

const RELEASE = FIXTURE.firstPressing;
const IMAGE = FIXTURE.frontImage;
const STORED = `https://coverartarchive.org/release/${RELEASE}/${IMAGE}`;
const SOURCE = "Cover Art Archive";

const ON = { [COVER_DISPLAY_VARIABLE]: "true" };

/** Every value that is not exactly `true`, and an absent variable. */
const OFF: Record<string, string | undefined>[] = [
  {},
  { [COVER_DISPLAY_VARIABLE]: undefined },
  { [COVER_DISPLAY_VARIABLE]: "" },
  { [COVER_DISPLAY_VARIABLE]: "false" },
  { [COVER_DISPLAY_VARIABLE]: "TRUE" },
  { [COVER_DISPLAY_VARIABLE]: "True" },
  { [COVER_DISPLAY_VARIABLE]: "1" },
  { [COVER_DISPLAY_VARIABLE]: "yes" },
  { [COVER_DISPLAY_VARIABLE]: "on" },
  { [COVER_DISPLAY_VARIABLE]: " true" },
  { [COVER_DISPLAY_VARIABLE]: "true " },
  { [COVER_DISPLAY_VARIABLE]: "true\n" },
  { [COVER_DISPLAY_VARIABLE]: '"true"' },
  // A public variant is never read.
  { [`NEXT_PUBLIC_${COVER_DISPLAY_VARIABLE}`]: "true" },
];

describe("the cover display switch", () => {
  it("is named REFRAIN_COVER_DISPLAY_ENABLED", () => {
    expect(COVER_DISPLAY_VARIABLE).toBe("REFRAIN_COVER_DISPLAY_ENABLED");
  });

  it("is on only for exactly `true`", () => {
    expect(coverDisplayEnabled(ON)).toBe(true);
    for (const env of OFF) {
      expect(coverDisplayEnabled(env), JSON.stringify(env)).toBe(false);
    }
  });

  it("reads the process environment when it is given none", () => {
    expect(coverDisplayEnabled()).toBe(
      process.env[COVER_DISPLAY_VARIABLE] === "true",
    );
  });

  it("builds no image address while it is off", () => {
    for (const env of OFF) {
      const what = JSON.stringify(env);
      expect(displayedCoverOf(STORED, SOURCE, env), what).toBeNull();
      expect(
        displayedCoverFor({ releaseId: RELEASE, imageId: IMAGE }, env),
        what,
      ).toBeNull();
      expect(displayedFrontThumbnailFor(RELEASE, env), what).toBeNull();
    }
  });

  it("builds the image sources, and only them, while it is on", () => {
    const cover = displayedCoverOf(STORED, SOURCE, ON);
    expect(cover).toEqual({
      src: `${STORED}-500.jpg`,
      srcSet: `${STORED}-250.jpg 250w, ${STORED}-500.jpg 500w, ${STORED}-1200.jpg 1200w`,
    });
    expect(
      displayedCoverFor({ releaseId: RELEASE, imageId: IMAGE }, ON),
    ).toEqual(cover);
    expect(displayedFrontThumbnailFor(RELEASE, ON)).toEqual({
      src: `https://coverartarchive.org/release/${RELEASE}/front-250`,
      srcSet: `https://coverartarchive.org/release/${RELEASE}/front-250 250w, https://coverartarchive.org/release/${RELEASE}/front-500 500w`,
    });
  });

  it("still refuses, while it is on, anything Refrain does not write", () => {
    for (const [url, source] of [
      [STORED, "Somewhere else"],
      [STORED, null],
      [`${STORED}?size=1`, SOURCE],
      [`http://coverartarchive.org/release/${RELEASE}/${IMAGE}`, SOURCE],
      [`https://example.org/release/${RELEASE}/${IMAGE}`, SOURCE],
      [null, SOURCE],
    ] as const) {
      expect(displayedCoverOf(url, source, ON), String(url)).toBeNull();
    }
    expect(displayedFrontThumbnailFor("not-an-id", ON)).toBeNull();
    expect(
      displayedCoverFor({ releaseId: RELEASE, imageId: "0" }, ON),
    ).toBeNull();
  });
});

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      return sources(path);
    }
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)
      ? [path]
      : [];
  });
}

describe("the only way to build a cover's image addresses", () => {
  it("is the switch: the integration's entry point exports no other builder", () => {
    const exported = Object.keys(entry);
    for (const name of [
      "coverArtworkOf",
      "coverArtworkFor",
      "frontThumbnailFor",
    ]) {
      expect(exported, name).not.toContain(name);
    }
    expect(exported).toEqual(
      expect.arrayContaining([
        "coverDisplayEnabled",
        "displayedCoverOf",
        "displayedCoverFor",
        "displayedFrontThumbnailFor",
      ]),
    );
  });

  it("leaves only the stored address's builder outside the switch, and only the artwork commands call it", () => {
    // `canonicalCoverUrl` builds what the catalog stores for a chosen image
    // (no size, so not an image source); it never reaches a page.
    for (const file of sources("src")) {
      if (file.startsWith(join("src", "integrations", "cover-art-archive"))) {
        continue;
      }
      if (readFileSync(file, "utf8").includes("canonicalCoverUrl")) {
        expect(file).toBe(join("src", "modules", "catalog", "music.ts"));
      }
    }
  });

  it("is reached only through the entry point: no module imports the builders' file", () => {
    for (const file of sources("src")) {
      if (file.startsWith(join("src", "integrations", "cover-art-archive"))) {
        continue;
      }
      const text = readFileSync(file, "utf8");
      expect(text, file).not.toMatch(
        /cover-art-archive\/(artwork|display)["']/,
      );
    }
  });

  it("is never read by a page or a client component directly", () => {
    for (const file of sources(join("src", "app"))) {
      expect(readFileSync(file, "utf8"), file).not.toContain(
        "@/integrations/cover-art-archive",
      );
    }
  });

  it("is never a public variable, and no other module reads it", () => {
    for (const file of [...sources("src"), "next.config.ts"]) {
      const text = readFileSync(file, "utf8");
      expect(text, file).not.toContain(`NEXT_PUBLIC_${COVER_DISPLAY_VARIABLE}`);
      expect(text, file).not.toMatch(
        /process\.env(\.|\[["'`])REFRAIN_COVER_DISPLAY_ENABLED/,
      );
    }
  });

  it("names the image host in the builders' file only (the rest is the CSP and the server-side client)", () => {
    const allowed = new Set([
      join("src", "integrations", "cover-art-archive", "artwork.ts"),
      join("src", "integrations", "cover-art-archive", "client.ts"),
      join("src", "security-headers.ts"),
    ]);
    for (const file of sources("src")) {
      if (file.startsWith(join("src", "testing"))) {
        continue;
      }
      if (/coverartarchive\.org/.test(readFileSync(file, "utf8"))) {
        expect(allowed, file).toContain(file);
      }
    }
  });
});
