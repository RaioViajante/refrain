"use server";

import { headers } from "next/headers";

import { denied, perform } from "@/app/studio/perform";
import type { ActionResult } from "@/app/studio/results";
import { authorizeAuthor } from "@/modules/identity";
import {
  previewAlbumJournalPublication,
  type PublicationPreview,
} from "@/modules/journals";

// The preview of publishing one language version (ADR 0006 §§ 2 and 3). This
// is the only place a studio request mints a `publish` token, and it is in its
// own file so that nothing else can reach it. It reads, writes nothing,
// changes no visibility, and never consumes the token it returns: the dialog
// that shows the disclosure decides whether to send it to the publish action,
// in a separate request, when the author presses its confirm control.
//
// The answer is private writing and a token, for this authorized request only.

export async function previewPublicationAction(
  input: unknown,
): Promise<ActionResult<PublicationPreview>> {
  const authorization = await authorizeAuthor(await headers());
  if (!authorization.ok) {
    return denied(authorization.reason);
  }
  return perform(
    () => previewAlbumJournalPublication(authorization.author, input),
    "none",
  );
}
