// The canonical-host redirect (Hosted Launch § 7, item 2), read by
// next.config.ts at build time. Pure: no `server-only`, no `@/` imports, so the
// framework's configuration loader can import it.
//
// Off unless `REFRAIN_CANONICAL_REDIRECT_HOSTS` names, comma-separated, the exact
// production hostnames that must not serve the site under their own name
// (for example the project's `*.vercel.app` production addresses). Each gets
// a `308` to the same path and query on the one canonical origin, which is
// `BETTER_AUTH_URL`'s: a configured value, never the request's `Host` or any
// part of the address, so no request can choose where it is sent. Preview and
// generated deployment addresses are never listed, so they keep their own
// origin. The configuration fails closed: a malformed value stops the build.
const HOSTNAME =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

export function canonicalHostRedirects(
  env: Readonly<Record<string, string | undefined>>,
) {
  const listed = env.REFRAIN_CANONICAL_REDIRECT_HOSTS?.trim();
  if (!listed) {
    return [];
  }
  let canonical: URL;
  try {
    canonical = new URL(env.BETTER_AUTH_URL ?? "");
  } catch {
    throw new Error(
      "REFRAIN_CANONICAL_REDIRECT_HOSTS needs BETTER_AUTH_URL, the canonical origin.",
    );
  }
  if (
    canonical.protocol !== "https:" ||
    canonical.pathname !== "/" ||
    canonical.search !== "" ||
    canonical.hash !== "" ||
    canonical.username !== "" ||
    canonical.password !== "" ||
    canonical.port !== ""
  ) {
    throw new Error(
      "The canonical origin (BETTER_AUTH_URL) must be an https origin with no path, query, credentials, or port.",
    );
  }
  const hosts = listed.split(",").map((host) => host.trim().toLowerCase());
  for (const host of hosts) {
    if (!HOSTNAME.test(host)) {
      throw new Error(
        `REFRAIN_CANONICAL_REDIRECT_HOSTS: "${host}" is not an exact hostname.`,
      );
    }
    if (host === canonical.hostname) {
      throw new Error(
        "REFRAIN_CANONICAL_REDIRECT_HOSTS must not name the canonical host: it would redirect to itself.",
      );
    }
  }
  return [...new Set(hosts)].map((host) => ({
    source: "/:path*",
    // `has` values are regular expressions matched against the whole value:
    // the dots are escaped, so the host matches exactly.
    has: [{ type: "host" as const, value: host.replaceAll(".", "\\.") }],
    destination: `${canonical.origin}/:path*`,
    permanent: true,
  }));
}

/** The rules for this build's environment (next.config.ts). */
export function canonicalHostRedirectsFromEnvironment() {
  return canonicalHostRedirects(process.env);
}
