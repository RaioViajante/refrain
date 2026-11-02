import { describe, expect, it } from "vitest";

import { normalizedAddress } from "./address-normalization";

// The proxy's copy of the framework's two address normalizations (ADR 0006,
// amendment A2). The targets are the ones Next.js 16.4.3 chose on the previous
// build, measured over HTTP before the change (docs/evidence/m3-1.md).

describe("the address a request is redirected to", () => {
  it.each([
    ["/albums/grace/", "/albums/grace"],
    ["/albums/grace/?q=1&r=2", "/albums/grace?q=1&r=2"],
    ["/albums/grace/?", "/albums/grace"],
    ["/albums/", "/albums"],
    ["/albums/x/y/", "/albums/x/y"],
    ["/ALBUMS/X/", "/ALBUMS/X"],
    ["/studio/journals/", "/studio/journals"],
    ["/a%2Fb/", "/a%2Fb"],
    ["/sitemap.xml/", "/sitemap.xml"],
    // A repeated slash or a backslash: collapsed first, one step at a time.
    ["//", "/"],
    ["/albums//", "/albums/"],
    ["/albums/x//", "/albums/x/"],
    ["/albums//x", "/albums/x"],
    ["/albums\\x", "/albums/x"],
    ["/a//b?x=//y", "/a/b?x=//y"],
  ])("%s → %s", (from, to) => {
    expect(normalizedAddress(from)).toBe(to);
  });

  it.each(["/", "/albums/grace", "/albums/grace?next=/x/", "/studio"])(
    "leaves %s alone",
    (address) => {
      expect(normalizedAddress(address)).toBeNull();
    },
  );

  it("depends on the address alone: it reads nothing else", () => {
    expect(normalizedAddress.length).toBe(1);
  });
});
