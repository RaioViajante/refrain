import "server-only";

import type { DatabaseExecutor } from "@/db";

import { publicReadsEnabled } from "./public-reads";
import { resolvePublicArtistAddress, resolvePublicSlug } from "./queries";
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
  return routeEntryRequest(db, "album_journal", request, env);
}

/**
 * What a public memory address answers (M3.7), in exactly the album journal's
 * order and with its answers: a memory that is draft, private, deleted,
 * restored, unpublished, retired, or never public, and an unknown or
 * malformed address, all get the same unknown-address `404`; a previous
 * address of a publicly visible memory gets a `308` to its current one.
 */
export async function routeMemoryRequest(
  db: () => DatabaseExecutor,
  request: AlbumJournalRequest,
  env: Record<string, string | undefined> = process.env,
): Promise<AlbumJournalRouting> {
  return routeEntryRequest(db, "memory", request, env);
}

async function routeEntryRequest(
  db: () => DatabaseExecutor,
  kind: "album_journal" | "memory",
  request: AlbumJournalRequest,
  env: Record<string, string | undefined>,
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
    const resolution = await resolvePublicSlug(db(), kind, request.slug);
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
 * What a public artist address answers (M3.5), in the same fixed order as an
 * album journal's: the switch, the method, the address's form, then the
 * publication queries. An artist that is not publicly visible (catalog-only,
 * archived, or credited only on writing that is not public) and a malformed
 * or unknown address all get the same unknown-address `404`. There is no
 * redirect: no previous artist address is stored.
 */
export async function routeArtistRequest(
  db: () => DatabaseExecutor,
  request: AlbumJournalRequest,
  env: Record<string, string | undefined> = process.env,
): Promise<
  Extract<
    AlbumJournalRouting,
    { action: "not_found" | "method_not_allowed" | "serve" | "unavailable" }
  >
> {
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
    const resolution = await resolvePublicArtistAddress(db(), request.slug);
    return resolution.outcome === "found"
      ? { action: "serve" }
      : { action: "not_found" };
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
