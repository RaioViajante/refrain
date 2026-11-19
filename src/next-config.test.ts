import { afterEach, describe, expect, it, vi } from "vitest";

import { isIndexable, robotsHeaderRules } from "./lib/indexing";

async function load(env: Record<string, string>) {
  vi.resetModules();
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
  return (await import("../next.config")).default;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

/** Headers per source, merging rules that share one (as Next.js does). */
function headersFor(
  rules: { source: string; headers: { key: string; value: string }[] }[],
) {
  const out: Record<string, Record<string, string>> = {};
  for (const r of rules) {
    out[r.source] = {
      ...out[r.source],
      ...Object.fromEntries(r.headers.map((h) => [h.key, h.value])),
    };
  }
  return out;
}

describe("next.config", () => {
  it("sends the baseline headers and noindex everywhere by default", async () => {
    const config = await load({
      VERCEL_ENV: "preview",
      SITE_INDEXABLE: "true",
    });
    expect(headersFor((await config.headers?.()) ?? [])).toEqual({
      "/:path*": {
        "Content-Security-Policy": "frame-ancestors 'none'",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "strict-origin-when-cross-origin",
        "X-Robots-Tag": "noindex, nofollow",
      },
    });
  });

  it("lets an authorized production deployment be indexed, except the Studio", async () => {
    const config = await load({
      VERCEL_ENV: "production",
      SITE_INDEXABLE: "true",
    });
    const rules = headersFor((await config.headers?.()) ?? []);
    expect(rules["/:path*"]).not.toHaveProperty("X-Robots-Tag");
    expect(rules["/studio/:path*"]).toEqual({
      "X-Robots-Tag": "noindex, nofollow",
    });
  });

  it("does not advertise the framework", async () => {
    expect((await load({})).poweredByHeader).toBe(false);
  });
});

describe("isIndexable", () => {
  it("needs both a production deployment and SITE_INDEXABLE=true", () => {
    expect(isIndexable({})).toBe(false);
    expect(isIndexable({ VERCEL_ENV: "production" })).toBe(false);
    expect(isIndexable({ VERCEL_ENV: "preview", SITE_INDEXABLE: "true" })).toBe(
      false,
    );
    expect(isIndexable({ SITE_INDEXABLE: "true" })).toBe(false);
    expect(isIndexable({ VERCEL_ENV: "production", SITE_INDEXABLE: "1" })).toBe(
      false,
    );
    expect(
      isIndexable({ VERCEL_ENV: "production", SITE_INDEXABLE: "true" }),
    ).toBe(true);
    expect(robotsHeaderRules(false)[0]?.source).toBe("/:path*");
  });
});
