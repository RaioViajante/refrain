"use server";

import { headers } from "next/headers";

import { denied, perform } from "@/app/studio/perform";
import type { ActionResult } from "@/app/studio/results";
import { authorizeAuthor } from "@/modules/identity";
import {
  previewAlbumJournalPublicChange,
  type PublicChangePreviewReview,
} from "@/modules/journals";

// The preview of a save that may change a public page (ADR 0006 § 5). This is
// the only place a studio request mints a `change_public` token, and it is in
// its own file so that nothing else can reach it. It takes the save's input,
// reads, writes nothing, and never consumes the token it returns: the change
// dialog sends it with the save, in a separate request, when the author
// presses its confirm control.
//
// The answer names the author's private writing and carries a token, for this
// authorized request only.

export async function previewPublicChangeAction(
  input: unknown,
): Promise<ActionResult<PublicChangePreviewReview>> {
  const authorization = await authorizeAuthor(await headers());
  if (!authorization.ok) {
    return denied(authorization.reason);
  }
  return perform(
    () => previewAlbumJournalPublicChange(authorization.author, input),
    "none",
  );
}
