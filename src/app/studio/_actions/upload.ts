// Upload of one photograph from a Studio form: validated and cleaned from its
// bytes, then stored with its record in PostgreSQL. Not a Server Action itself (no "use server"):
// only the actions that call it are reachable, and it authorizes again.
import "server-only";

import { getDatabase } from "@/db/client";
import { requireStudio } from "@/server/auth/studio";
import { ImageFileError, inspectImage } from "@/server/media/image-file";
import type { ActionResult } from "@/server/studio/errors";
import { createImage } from "@/server/studio/images";
import { imageFieldsSchema } from "@/server/studio/schemas";

import { attempt, field } from "./support";

export async function uploadImage(formData: FormData): Promise<ActionResult> {
  await requireStudio();
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "escolha uma foto." };
  }
  const meta = imageFieldsSchema
    .pick({ alt: true, rightsConfirmed: true, rightsNote: true })
    .safeParse({
      alt: field(formData, "alt"),
      rightsConfirmed: field(formData, "rightsConfirmed") === "on",
      rightsNote: field(formData, "rightsNote"),
    });
  if (!meta.success) return { ok: false, error: meta.error.issues[0]!.message };

  return attempt(async () => {
    if (file.size > 4 * 1024 * 1024) {
      throw new ImageFileError("A foto passa de 4 MB.");
    }
    const image = inspectImage(new Uint8Array(await file.arrayBuffer()));
    const id = await createImage(
      getDatabase(),
      { width: image.width, height: image.height, ...meta.data },
      {
        bytes: image.bytes,
        contentType: image.kind === "jpeg" ? "image/jpeg" : "image/png",
      },
    );
    return { message: "foto enviada.", id };
  });
}
