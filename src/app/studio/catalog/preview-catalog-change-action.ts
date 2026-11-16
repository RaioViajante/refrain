"use server";

import { headers } from "next/headers";

import { denied, perform } from "@/app/studio/perform";
import type { ActionResult } from "@/app/studio/results";
import {
  CatalogError,
  previewAlbumChange,
  previewArtistChange,
  previewTrackChange,
  type CatalogChangePreview,
} from "@/modules/catalog";
import { authorizeAuthor } from "@/modules/identity";

// The review of a catalog edit that would change a served page (ADR 0013
// § 2, step 3). This is the only place a Studio request mints a
// `catalog_change` token, and it is alone in its own file so that nothing
// else can reach it. It reads, writes nothing to a shared table, and never
// consumes the token it returns: the review dialog sends it with the edit, in
// a separate request, when the author presses its confirm control.

/** The review and its token: the dialog's state, and nothing else. */
export type CatalogChangeReviewResult = CatalogChangePreview;

export async function previewCatalogChangeAction(
  kind: unknown,
  recordId: unknown,
  input: unknown,
): Promise<ActionResult<CatalogChangeReviewResult>> {
  const authorization = await authorizeAuthor(await headers());
  if (!authorization.ok) {
    return denied(authorization.reason);
  }
  const author = authorization.author;
  return perform(() => {
    switch (kind) {
      case "artist":
        return previewArtistChange(author, recordId, input);
      case "album":
        return previewAlbumChange(author, recordId, input);
      case "track":
        return previewTrackChange(author, recordId, input);
      default:
        throw new CatalogError("invalid_input");
    }
  }, "none");
}
