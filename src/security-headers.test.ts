import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { COVER_IMAGE_HOSTS } from "@/integrations/cover-art-archive";
import { PHOTO_IMAGE_HOSTS } from "@/integrations/wikimedia-commons";

import {
  ARTIST_CONTENT_SECURITY_POLICY,
  CONTENT_SECURITY_POLICY,
  STUDIO_CONTENT_SECURITY_POLICY,
} from "./security-headers";

function directivesOf(policy: string) {
  return new Map(
    policy.split(";").map((directive) => {
      const [name, ...values] = directive.trim().split(/\s+/);
      return [name!, values];
    }),
  );
}

describe("the Content-Security-Policy", () => {
  it("is the same in next.config.ts and in the proxy", () => {
    const config = readFileSync("next.config.ts", "utf8");
    expect(config).toContain(JSON.stringify(CONTENT_SECURITY_POLICY));
    expect(config).toContain(JSON.stringify(STUDIO_CONTENT_SECURITY_POLICY));
    expect(config).not.toMatch(/value: "frame-ancestors 'none'"/);
    const proxy = readFileSync("src/proxy.ts", "utf8");
    expect(proxy).toContain(
      '"Content-Security-Policy": CONTENT_SECURITY_POLICY',
    );
  });

  it("forbids framing and allows images only from this site, inline data, and the archive's hosts", () => {
    const directives = directivesOf(CONTENT_SECURITY_POLICY);
    expect(directives.get("frame-ancestors")).toEqual(["'none'"]);
    expect(directives.get("img-src")).toEqual([
      "'self'",
      "data:",
      "blob:",
      ...COVER_IMAGE_HOSTS,
    ]);
  });

  it("adds exactly Wikimedia's thumbnail host for the studio, and only there (M3.3)", () => {
    const studio = directivesOf(STUDIO_CONTENT_SECURITY_POLICY);
    expect(studio.get("frame-ancestors")).toEqual(["'none'"]);
    expect(studio.get("img-src")).toEqual([
      "'self'",
      "data:",
      "blob:",
      ...COVER_IMAGE_HOSTS,
      ...PHOTO_IMAGE_HOSTS,
    ]);
    expect(PHOTO_IMAGE_HOSTS).toEqual(["https://thumb.wikimedia.org"]);
    expect(CONTENT_SECURITY_POLICY).not.toContain("wikimedia");
    // The public headers use the public policy; the studio and the
    // authentication endpoints the studio policy.
    const config = readFileSync("next.config.ts", "utf8");
    const publicBlock = config.slice(
      config.indexOf("const publicHeaders"),
      config.indexOf("return ["),
    );
    const privateBlock = config.slice(
      config.indexOf("const privateHeaders"),
      config.indexOf("const publicHeaders"),
    );
    expect(publicBlock).toContain("value: CONTENT_SECURITY_POLICY }");
    expect(privateBlock).toContain("value: STUDIO_CONTENT_SECURITY_POLICY }");
    expect(readFileSync("src/proxy.ts", "utf8")).not.toContain(
      "STUDIO_CONTENT_SECURITY_POLICY",
    );
  });

  it("adds exactly Wikimedia's thumbnail host for the artist pages, and only under /artists/ (M3.5)", () => {
    const artist = directivesOf(ARTIST_CONTENT_SECURITY_POLICY);
    expect(artist.get("frame-ancestors")).toEqual(["'none'"]);
    expect(artist.get("img-src")).toEqual([
      "'self'",
      "data:",
      "blob:",
      ...COVER_IMAGE_HOSTS,
      ...PHOTO_IMAGE_HOSTS,
    ]);
    const config = readFileSync("next.config.ts", "utf8");
    expect(config).toContain(JSON.stringify(ARTIST_CONTENT_SECURITY_POLICY));
    expect(config).toMatch(
      /\{ source: "\/artists\/:path\*", headers: artistHeaders \}/,
    );
    expect(config).toContain("value: ARTIST_CONTENT_SECURITY_POLICY");
    // The proxy uses it only for an artist address.
    const proxy = readFileSync("src/proxy.ts", "utf8");
    expect(proxy).toContain(
      '"Content-Security-Policy": ARTIST_CONTENT_SECURITY_POLICY',
    );
    expect(proxy).toContain(
      "isArtist ? ARTIST_SECURITY_HEADERS : PUBLIC_SECURITY_HEADERS",
    );
  });
});
