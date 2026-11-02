// The two address normalizations that Next.js performs with a `308` of its
// own, reproduced so that the proxy can send them with `Cache-Control:
// no-store` (ADR 0006 § 11 and gate G2, as clarified by amendment A2).
//
// Next.js answers a trailing slash with an internal redirect route that runs
// before the proxy, and its redirect responses take no headers from
// `next.config.ts` (the router returns `resHeaders: null` for a redirect), so
// that `308` could never carry `no-store`. With `skipTrailingSlashRedirect`
// the framework leaves it to the proxy, which answers it here, to the same
// address and with the same status. The repeated-slash and backslash `308` is
// sent by the render server after the proxy has run, so answering it here
// first changes only its headers.
//
// Each function returns the address to redirect to, or null when the address
// is already normal. Both mirror the framework exactly (Next.js 16.4.3,
// `normalizeRepeatedSlashes` and the `/:path+/` redirect), so the target of
// every `308` is the one the framework would have chosen: one step at a time,
// the query kept as it was. Neither looks at any journal: the answer depends
// on the characters of the address alone.

/** `a//b` or `a\b` becomes `a/b`; the query is kept. */
function repeatedSlashTarget(pathAndQuery: string): string | null {
  const parts = pathAndQuery.split("?");
  const path = parts[0]!;
  if (!/(\\|\/\/)/.test(path)) {
    return null;
  }
  const query = parts[1] ? `?${parts.slice(1).join("?")}` : "";
  return path.replace(/\\/g, "/").replace(/\/\/+/g, "/") + query;
}

/** `/a/b/` becomes `/a/b`; `/` stays; the query is kept. */
function trailingSlashTarget(pathAndQuery: string): string | null {
  const parts = pathAndQuery.split("?");
  const path = parts[0]!;
  if (path.length <= 1 || !path.endsWith("/")) {
    return null;
  }
  const query = parts[1] ? `?${parts.slice(1).join("?")}` : "";
  return path.slice(0, -1) + query;
}

/**
 * Where a request for `pathAndQuery` (the raw request target, as the client
 * sent it) is redirected with a `308`, or null when it is not. Repeated
 * slashes come first, as in the framework.
 */
export function normalizedAddress(pathAndQuery: string): string | null {
  return repeatedSlashTarget(pathAndQuery) ?? trailingSlashTarget(pathAndQuery);
}
