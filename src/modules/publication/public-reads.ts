import "server-only";

// The public-reads switch (ADR 0006, D4). It is defense in depth: it can hide
// public content and can never reveal any. When it is on, every read still
// goes through the publication predicate.
//
// - Server-only: never a `NEXT_PUBLIC_` variable, never in a client bundle,
//   never controlled by a request.
// - Disabled by default and fail closed: unset, empty, or anything other than
//   exactly `true` (so `TRUE`, `1`, `yes`, and ` true` too) means disabled.
// - Read when a request is served, never at build time: Next.js inlines only
//   `NEXT_PUBLIC_` variables into a build, and a test serves one build with
//   several values to prove it.

export const PUBLIC_READS_VARIABLE = "REFRAIN_PUBLIC_READS_ENABLED";

type Environment = Record<string, string | undefined>;

/** Whether public content may be served. Exactly `true` enables it. */
export function publicReadsEnabled(env: Environment = process.env): boolean {
  return env[PUBLIC_READS_VARIABLE] === "true";
}

/**
 * The application's own origin, for the absolute addresses of a sitemap. It is
 * the variable that the authentication handler already requires
 * (`BETTER_AUTH_URL`), so this adds no configuration. Anything that is not a
 * plain `http` or `https` origin is refused (null), and the caller then fails
 * closed.
 */
export function publicSiteOrigin(
  env: Environment = process.env,
): string | null {
  const value = env.BETTER_AUTH_URL;
  if (!value) {
    return null;
  }
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }
    if (url.username || url.password) {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}
