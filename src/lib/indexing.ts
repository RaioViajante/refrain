/**
 * Whether search engines may index the public site. Only a production
 * deployment with SITE_INDEXABLE=true qualifies: previews, local builds, and
 * production before the authorized cutover stay "noindex". The Studio and
 * previews are never indexable, whatever this says.
 */
export function isIndexable(
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return env.VERCEL_ENV === "production" && env.SITE_INDEXABLE === "true";
}

const NOINDEX = { key: "X-Robots-Tag", value: "noindex, nofollow" } as const;

/** The X-Robots-Tag rules for next.config.ts headers(). */
export function robotsHeaderRules(indexable: boolean) {
  return indexable
    ? [{ source: "/studio/:path*", headers: [NOINDEX] }]
    : [{ source: "/:path*", headers: [NOINDEX] }];
}
