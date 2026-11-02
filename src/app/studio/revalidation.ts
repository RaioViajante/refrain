import "server-only";

import { revalidatePath } from "next/cache";

// The one place where the studio asks Next.js to drop cached data (ADR 0006
// § 11). Nothing else under src/app may call a revalidation function; a test
// enforces it.
//
// What each kind of action changes:
//
//   none        a preview or other read. Nothing is written, so nothing is
//               refreshed.
//   writing     authored writing or the catalog changed. Only the studio's
//               own pages (private, never shared-cached) are refreshed.
//   visibility  who can read something changed: a version was published or
//               unpublished, a journal was deleted or restored, or a save
//               changed what a public page shows.
//
// A public album-journal page exists since M3.1, and it caches nothing: every
// public response is rendered per request with `Cache-Control: no-store` (ADR
// 0006 § 11), the build holds no journal data, and src/app/public-surface.test.ts
// fails on any cache directive in a public file. So there is still nothing
// public to revalidate, and this module does NOT claim that public
// invalidation is done: the HTTP tests of M3.1 show that the next request
// reflects every change instead. `PUBLIC_REVALIDATION_PATHS` stays empty on
// purpose; any cache introduced later needs its own ADR that defines the
// invalidation of every event above, and a test fails if the list is filled
// without that work.

export type StudioEffect = "none" | "writing" | "visibility";

/** Public paths to revalidate after a visibility change. Empty: see above. */
export const PUBLIC_REVALIDATION_PATHS: readonly string[] = [];

export function revalidateAfter(effect: StudioEffect): void {
  if (effect === "none") {
    return;
  }
  revalidatePath("/studio", "layout");
  if (effect === "visibility") {
    for (const path of PUBLIC_REVALIDATION_PATHS) {
      revalidatePath(path);
    }
  }
}
