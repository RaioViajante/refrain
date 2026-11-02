import "server-only";

import type { DatabaseExecutor } from "@/db";

import { publicReadsEnabled } from "./public-reads";
import { resolvePublicSlug } from "./queries";
import { isNormalizedSlug } from "./slug";

// What a public album-journal address answers (ADR 0006 § 11, gate G1). It is
// decided before any response byte is sent, because a streamed page cannot
// change its status: under Cache Components a page answers `200` and streams
// a redirect or a not-found view afterwards (M3.1 spike, docs/evidence/m3-1.md).
// The proxy applies this decision, so the status is real.
//
// The order is fixed, and each step depends on nothing that comes later, so
// the answer to a request never reveals more than the step that produced it:
//
//  1. the switch: disabled answers the unknown-address `404` to every method;
//  2. the method: only GET and HEAD, for every address alike;
//  3. the slug's form: a malformed slug is the unknown-address `404`, without
//     reading the database;
//  4. the publication queries: found, a redirect to the current address, or
//     the unknown-address `404`. A draft, private, deleted, unpublished-
//     translation, retired, or never-public address is `not_found`, exactly
//     as an unknown one is (INV-5).

export type AlbumJournalRouting =
  /** The unknown-address 404. */
  | { action: "not_found" }
  /** 405 with `Allow: GET, HEAD`, the same for every address. */
  | { action: "method_not_allowed" }
  /** 308 to the current address of a publicly visible journal. */
  | { action: "redirect"; currentSlug: string }
  /** Render the page. The page resolves the address again, itself. */
  | { action: "serve" }
  /** The database could not answer. A generic 503, never a 404. */
  | { action: "unavailable" };

export interface AlbumJournalRequest {
  method: string;
  /** The slug as the path carries it, already percent-decoded. */
  slug: string;
}

export async function routeAlbumJournalRequest(
  db: () => DatabaseExecutor,
  request: AlbumJournalRequest,
  env: Record<string, string | undefined> = process.env,
): Promise<AlbumJournalRouting> {
  if (!publicReadsEnabled(env)) {
    return { action: "not_found" };
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    return { action: "method_not_allowed" };
  }
  if (!isNormalizedSlug(request.slug)) {
    return { action: "not_found" };
  }
  try {
    const resolution = await resolvePublicSlug(
      db(),
      "album_journal",
      request.slug,
    );
    switch (resolution.outcome) {
      case "found":
        return { action: "serve" };
      case "redirect":
        return { action: "redirect", currentSlug: resolution.currentSlug };
      case "not_found":
        return { action: "not_found" };
    }
  } catch {
    // Never log the error: a driver message can carry connection details.
    return { action: "unavailable" };
  }
}

/**
 * The same first two steps for the public documents that are not a journal
 * (the sitemap and `robots.txt`): the switch, then the method. They list or
 * describe only public addresses, and their routes read through the
 * publication queries.
 */
export function routePublicDocumentRequest(
  request: { method: string },
  env: Record<string, string | undefined> = process.env,
): Extract<
  AlbumJournalRouting,
  { action: "not_found" | "method_not_allowed" | "serve" }
> {
  if (!publicReadsEnabled(env)) {
    return { action: "not_found" };
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    return { action: "method_not_allowed" };
  }
  return { action: "serve" };
}
