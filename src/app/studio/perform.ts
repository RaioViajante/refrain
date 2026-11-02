import "server-only";

import { headers } from "next/headers";

import { CatalogError } from "@/modules/catalog";
import {
  hasTrustedOrigin,
  type AuthorizationFailure,
} from "@/modules/identity";
import { JournalError } from "@/modules/journals";

import { revalidateAfter, type StudioEffect } from "./revalidation";
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
 * Runs a domain command and returns its result. The request must name this
 * application's own origin; Next.js accepts an action call without an `Origin`
 * header, so this is checked here (it is `unauthorized`, like a bad session).
 * A success refreshes the
 * Studio's data through the one revalidation module, by the kind of change
 * (`effect`, default "writing"; a preview passes "none"). The studio is
 * private and never cached, so this only drops the browser's copy of pages it
 * has already shown. No public page exists to invalidate. An expected failure becomes a fixed code; anything else is
 * logged by name only (messages from the database can contain query
 * parameters) and reported as `failed`.
 */
export async function perform<Data>(
  work: () => Promise<Data>,
  effect: StudioEffect = "writing",
): Promise<ActionResult<Data>> {
  if (!hasTrustedOrigin(await headers())) {
    return denied("unauthenticated");
  }
  try {
    const data = await work();
    // The work has committed. A failure to refresh the browser's copy of the
    // studio must never be reported as "nothing was changed".
    try {
      revalidateAfter(effect);
    } catch {
      console.error("A studio revalidation failed");
    }
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
      case "entry_not_deleted":
        return { ok: false, code: "not_deleted" };
      case "track_not_in_album":
        return { ok: false, code: "not_found" };
      case "track_archived":
        return { ok: false, code: "archived" };
      case "unavailable":
        return { ok: false, code: "unavailable" };
      // A publication, or a change to a public page, whose confirmation is
      // missing, not authentic, too old, or for another state (ADR 0006
      // § 12). Nothing was written. The code is all the browser gets: no
      // token, and not the private writing the refusal carried. The dialog
      // asks the author to review the current state again, through a new
      // preview request; nothing here retries or confirms on their behalf.
      case "confirmation_required":
      case "confirmation_invalid":
      case "confirmation_expired":
      case "confirmation_stale":
        return { ok: false, code: error.failure };
      case "nothing_to_publish":
        return { ok: false, code: "nothing_to_publish" };
      case "status_changed":
        return { ok: false, code: "status_changed" };
      case "no_current_slug":
        return { ok: false, code: "no_address" };
      case "slug_unavailable":
        return { ok: false, code: "failed" };
    }
  }
  console.error("A studio action failed", {
    name: error instanceof Error ? error.name : typeof error,
  });
  return { ok: false, code: "failed" };
}
