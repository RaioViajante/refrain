"use server";

import { getDatabase } from "@/db/client";
import { requireStudio } from "@/server/auth/studio";
import { removeStoredImage } from "@/server/media/storage";
import type { ActionResult } from "@/server/studio/errors";
import { deleteImage, updateImage } from "@/server/studio/images";
import {
  idSchema,
  imageFieldsSchema,
  siteImageSlotSchema,
  siteTextBodySchema,
  siteTextKeySchema,
} from "@/server/studio/schemas";
import {
  saveSiteText,
  setSiteImage,
  setSiteTextPublished,
} from "@/server/studio/site-content";

import { attempt, confirmed, field, invalid } from "./support";
import { uploadImage } from "./upload";

export async function saveSiteTextAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  await requireStudio();
  const key = siteTextKeySchema.safeParse(field(formData, "key"));
  const body = siteTextBodySchema.safeParse(field(formData, "body"));
  if (!key.success) return invalid("texto desconhecido.");
  if (!body.success) return invalid(body.error.issues[0]!.message);
  return attempt(async () => {
    await saveSiteText(getDatabase(), key.data, body.data);
    return body.data ? "texto salvo." : "texto apagado.";
  });
}

export async function setSiteTextPublishedAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  await requireStudio();
  const key = siteTextKeySchema.safeParse(field(formData, "key"));
  if (!key.success) return invalid("texto desconhecido.");
  const published = field(formData, "published") === "true";
  return attempt(async () => {
    await setSiteTextPublished(getDatabase(), key.data, published);
    return published
      ? "o texto está no site."
      : "o texto voltou a ser rascunho.";
  });
}

/** Fills a fixed photo slot with an existing photo, a new upload, or nothing. */
export async function setSiteImageAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  await requireStudio();
  const slot = siteImageSlotSchema.safeParse(field(formData, "slot"));
  if (!slot.success) return invalid("espaço desconhecido.");
  const file = formData.get("file");
  let imageId: string | null = null;
  if (file instanceof File && file.size > 0) {
    const uploaded = await uploadImage(formData);
    if (!uploaded.ok) return uploaded;
    imageId = uploaded.id!;
  } else if (field(formData, "imageId")) {
    const parsed = idSchema.safeParse(field(formData, "imageId"));
    if (!parsed.success) return invalid("foto inválida.");
    imageId = parsed.data;
  }
  return attempt(async () => {
    await setSiteImage(getDatabase(), slot.data, imageId);
    return imageId ? "foto colocada no lugar." : "o lugar ficou vazio.";
  });
}

export async function uploadImageAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  await requireStudio();
  return uploadImage(formData);
}

export async function updateImageAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  await requireStudio();
  const id = idSchema.safeParse(field(formData, "id"));
  if (!id.success) return invalid("foto inválida.");
  const fields = imageFieldsSchema.safeParse({
    alt: field(formData, "alt"),
    focus: field(formData, "focus"),
    treatment: field(formData, "treatment"),
    rightsConfirmed: field(formData, "rightsConfirmed") === "on",
    rightsNote: field(formData, "rightsNote"),
  });
  if (!fields.success) return invalid(fields.error.issues[0]!.message);
  return attempt(async () => {
    await updateImage(getDatabase(), id.data, fields.data);
    return "foto salva.";
  });
}

export async function deleteImageAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  await requireStudio();
  const id = idSchema.safeParse(field(formData, "id"));
  if (!id.success) return invalid("foto inválida.");
  if (!confirmed(formData)) return invalid("confirme a exclusão.");
  return attempt(async () => {
    const url = await deleteImage(getDatabase(), id.data);
    await removeStoredImage(url);
    return "a foto foi excluída.";
  });
}
