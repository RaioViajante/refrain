import "server-only";

import { revalidatePath } from "next/cache";

import { CatalogError } from "@/modules/catalog";
import type { AuthorizationFailure } from "@/modules/identity";
import { JournalError } from "@/modules/journals";

import type { ActionResult } from "./results";

// Shared by the Studio's server actions. Authorization is not here: every
// action calls `authorizeAuthor` itself, first (docs/security.md §
// Authorization contract). This only runs the domain command that follows,
// and turns its outcome into a deliberately small result.

/** The result for a request that is not the author's. */
export function denied(reason: AuthorizationFailure): ActionResult<never> {
  return {
    ok: false,
    code: reason === "unavailable" ? "unavailable" : "unauthorized",
  };
}

/**
 * Runs a domain command and returns its result. A success refreshes the
 * Studio's data: the studio is private and never cached, so this only drops
 * the browser's copy of pages it has already shown. No public page exists to
 * invalidate. An expected failure becomes a fixed code; anything else is
 * logged by name only (messages from the database can contain query
 * parameters) and reported as `failed`.
 */
export async function perform<Data>(
  work: () => Promise<Data>,
): Promise<ActionResult<Data>> {
  try {
    const data = await work();
    revalidatePath("/studio", "layout");
    return { ok: true, data };
  } catch (error) {
    return failed(error);
  }
}

function failed(error: unknown): ActionResult<never> {
  if (error instanceof CatalogError) {
    switch (error.failure) {
      case "invalid_input":
        return {
          ok: false,
          code: "invalid_input",
          fields: error.details.fields,
        };
      case "not_found":
        return { ok: false, code: "not_found" };
      case "archived_reference":
        return { ok: false, code: "archived" };
      case "duplicate_identifier":
        return { ok: false, code: "duplicate" };
      case "in_use":
        return {
          ok: false,
          code: "in_use",
          blockedBy: error.details.blockedBy,
        };
    }
  }
  if (error instanceof JournalError) {
    switch (error.failure) {
      case "invalid_input":
        return {
          ok: false,
          code: "invalid_input",
          fields: error.details.fields,
        };
      case "entry_not_found":
      case "album_not_found":
        return { ok: false, code: "not_found" };
      case "album_archived":
        return { ok: false, code: "archived" };
      case "entry_deleted":
        return { ok: false, code: "deleted" };
      case "version_conflict":
        return { ok: false, code: "conflict" };
      case "unsupported_content":
        return { ok: false, code: "unsupported" };
      case "slug_unavailable":
      case "entry_not_deleted":
        return { ok: false, code: "failed" };
    }
  }
  console.error("A studio action failed", {
    name: error instanceof Error ? error.name : typeof error,
  });
  return { ok: false, code: "failed" };
}
