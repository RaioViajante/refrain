import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { COVER_IMAGE_HOSTS } from "@/integrations/cover-art-archive";

import { CONTENT_SECURITY_POLICY } from "./security-headers";

describe("the Content-Security-Policy", () => {
  it("is the same in next.config.ts and in the proxy", () => {
    const config = readFileSync("next.config.ts", "utf8");
    expect(config).toContain(JSON.stringify(CONTENT_SECURITY_POLICY));
    expect(config).not.toMatch(/value: "frame-ancestors 'none'"/);
    const proxy = readFileSync("src/proxy.ts", "utf8");
    expect(proxy).toContain(
      '"Content-Security-Policy": CONTENT_SECURITY_POLICY',
    );
  });

  it("forbids framing and allows images only from this site, inline data, and the archive's hosts", () => {
    const directives = new Map(
      CONTENT_SECURITY_POLICY.split(";").map((directive) => {
        const [name, ...values] = directive.trim().split(/\s+/);
        return [name!, values];
      }),
    );
    expect(directives.get("frame-ancestors")).toEqual(["'none'"]);
    expect(directives.get("img-src")).toEqual([
      "'self'",
      "data:",
      "blob:",
      ...COVER_IMAGE_HOSTS,
    ]);
  });
});
