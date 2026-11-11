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

/** The Studio's route trees, English and Brazilian Portuguese (ADR 0008 § 2). */
export const STUDIO_ROUTE_PATHS = ["/(en)/studio", "/pt/studio"] as const;

/** Public paths to revalidate after a visibility change. Empty: see above. */
export const PUBLIC_REVALIDATION_PATHS: readonly string[] = [];

export function revalidateAfter(effect: StudioEffect): void {
  if (effect === "none") {
    return;
  }
  // Each tree's own route path: a layout's cache tag is built from the route
  // file (`/(en)/studio/layout`, `/pt/studio/layout`), not from the address
  // (ADR 0008 § 9). The language takes no part in what is refreshed: both
  // Studios show the same data, so a change made in one is current in the
  // other.
  for (const path of STUDIO_ROUTE_PATHS) {
    revalidatePath(path, "layout");
  }
  if (effect === "visibility") {
    for (const path of PUBLIC_REVALIDATION_PATHS) {
      revalidatePath(path);
    }
  }
}
