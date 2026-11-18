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

  it("always answers a path on this site: never two leading slashes or a backslash", () => {
    // A deterministic sweep of short addresses built from the characters that
    // make open redirects: slashes, backslashes, their encodings, dots, and
    // a query.
    const parts = ["/", "\\", "%2F", "%5C", ".", "evil", "?", "x=//y"];
    let checked = 0;
    const walk = (prefix: string, depth: number) => {
      if (depth === 0) {
        const target = normalizedAddress(prefix);
        if (target !== null) {
          expect(target, prefix).toMatch(/^\/(?![/\\])|^\/$/);
          checked += 1;
        }
        return;
      }
      for (const part of parts) {
        walk(prefix + part, depth - 1);
      }
    };
    for (let depth = 0; depth <= 5; depth += 1) {
      walk("/", depth);
    }
    expect(checked).toBeGreaterThan(1000);
  });
});
