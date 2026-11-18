"use server";

import { headers } from "next/headers";

import { denied, perform } from "@/app/studio/perform";
import type { ActionResult } from "@/app/studio/results";
import { authorizeAuthor } from "@/modules/identity";
import {
  previewMemoryPublication,
  type MemoryPublicationPreview,
} from "@/modules/journals";

// The preview of publishing a memory (M3.7; ADR 0006 §§ 2 and 3). This is the
// only place a studio request mints a `publish` token for a memory, and it is
// in its own file so that nothing else can reach it. It reads, writes
// nothing, changes no visibility, and never consumes the token it returns:
// the dialog that shows the disclosure decides whether to send it to the
// publish action, in a separate request, when the author presses its confirm
// control.
//
// The answer is private writing and a token, for this authorized request only.

export async function previewMemoryPublicationAction(
  input: unknown,
): Promise<ActionResult<MemoryPublicationPreview>> {
  const authorization = await authorizeAuthor(await headers());
  if (!authorization.ok) {
    return denied(authorization.reason);
  }
  return perform(
    () => previewMemoryPublication(authorization.author, input),
    "none",
  );
}
