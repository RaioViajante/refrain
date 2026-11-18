// Helpers for tests that read the public pages over HTTP (anonymous requests
// against the production build). Every response seen is kept in `corpus`, so a
// test can finish by scanning everything a reader was ever sent for content that
// must never be served.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/** Every response body and header seen, scanned for private markers at the end. */
export const corpus: string[] = [];

export interface Snapshot {
  status: number;
  headers: Record<string, string>;
  body: string;
}

export async function request(
  base: string,
  path: string,
  init: RequestInit & { rsc?: boolean } = {},
): Promise<Snapshot> {
  const { rsc, ...rest } = init;
  // The router always sends a cache-busting `_rsc` parameter; without it the
  // framework answers a redirect that adds one.
  const target = rsc
    ? `${path}${path.includes("?") ? "&" : "?"}_rsc=probe`
    : path;
  const send = (to: string) =>
    fetch(`${base}${to}`, {
      redirect: "manual",
      ...rest,
      headers: {
        ...(rsc ? { rsc: "1" } : {}),
        ...(rest.headers as Record<string, string> | undefined),
      },
    });
  let response = await send(target);
  // The router checks the `_rsc` value against its own hash of the request
  // and answers a 307 to the right one; a browser follows it, so a test does.
  const correction = response.headers.get("location");
  if (
    rsc &&
    response.status === 307 &&
    correction?.includes("_rsc") &&
    correction.startsWith(path.split("?")[0]!)
  ) {
    await response.text();
    response = await send(correction);
  }
  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    headers[key.toLowerCase()] = value;
  });
  const body = await response.text();
  corpus.push(JSON.stringify(headers), body);
  return { status: response.status, headers, body };
}

/** The text a reader sees: no scripts, styles, or tags. */
export function visibleText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/g, " ")
    .replace(/<style[\s\S]*?<\/style>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ");
}

// What an unknown address and a hidden one must share. The date, and the
// connection management that the HTTP server decides, are not the answer.
const IGNORED_HEADERS = new Set(["date", "connection", "keep-alive"]);

export function comparable(snapshot: Snapshot) {
  return {
    status: snapshot.status,
    headers: Object.fromEntries(
      Object.entries(snapshot.headers).filter(
        ([name]) => !IGNORED_HEADERS.has(name),
      ),
    ),
    body: snapshot.body,
  };
}

/**
 * The files under a directory whose text contains any of the given strings. A
 * server that wrote journal data to its own disk cache would show up here.
 */
export function filesContaining(
  directory: string,
  needles: string[],
): string[] {
  const found: string[] = [];
  const walk = (path: string) => {
    for (const name of readdirSync(path)) {
      const full = join(path, name);
      const info = statSync(full);
      if (info.isDirectory()) {
        walk(full);
      } else if (info.size < 8_000_000) {
        const text = readFileSync(full, "utf8");
        if (needles.some((needle) => text.includes(needle))) {
          found.push(full);
        }
      }
    }
  };
  walk(directory);
  return found;
}
