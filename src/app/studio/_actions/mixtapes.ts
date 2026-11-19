"use server";

import { redirect } from "next/navigation";

import { getDatabase } from "@/db/client";
import { requireStudio } from "@/server/auth/studio";
import type { ActionResult } from "@/server/studio/errors";
import {
  addTrack,
  createMixtape,
  deleteMixtape,
  moveMixtape,
  moveTrack,
  removeTrack,
  setMixtapeImage,
  setMixtapePublished,
  updateMixtape,
  updateTrackNote,
} from "@/server/studio/mixtapes";
import {
  directionSchema,
  fieldErrors,
  idSchema,
  mixtapeFieldsSchema,
  noteSchema,
  songSchema,
  titleSchema,
} from "@/server/studio/schemas";

import { uploadImage } from "./upload";
import { attempt, confirmed, field, invalid } from "./support";

export async function createMixtapeAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  await requireStudio();
  const title = titleSchema.safeParse(field(formData, "title"));
  if (!title.success) return invalid(title.error.issues[0]!.message);
  const id = await createMixtape(getDatabase(), title.data);
  redirect(`/studio/mixtapes/${id}`);
}

export async function saveMixtapeAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  await requireStudio();
  const id = idSchema.safeParse(field(formData, "id"));
  if (!id.success) return invalid("fita inválida.");
  const parsed = mixtapeFieldsSchema.safeParse(
    Object.fromEntries(
      Object.keys(mixtapeFieldsSchema.shape).map((k) => [
        k,
        field(formData, k),
      ]),
    ),
  );
  if (!parsed.success) {
    return {
      ok: false,
      error: "confira os campos marcados.",
      fieldErrors: fieldErrors(parsed.error),
    };
  }
  return attempt(async () => {
    await updateMixtape(getDatabase(), id.data, parsed.data);
    return "tudo salvo.";
  });
}

export async function setMixtapePublishedAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  await requireStudio();
  const id = idSchema.safeParse(field(formData, "id"));
  if (!id.success) return invalid("fita inválida.");
  const published = field(formData, "published") === "true";
  return attempt(async () => {
    await setMixtapePublished(getDatabase(), id.data, published);
    return published ? "a fita está no site." : "a fita voltou a ser rascunho.";
  });
}

export async function deleteMixtapeAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  await requireStudio();
  const id = idSchema.safeParse(field(formData, "id"));
  if (!id.success) return invalid("fita inválida.");
  if (!confirmed(formData)) return invalid("confirme a exclusão.");
  const result = await attempt(async () => {
    await deleteMixtape(getDatabase(), id.data);
    return "a fita foi excluída.";
  });
  if (!result.ok) return result;
  redirect("/studio/mixtapes");
}

export async function moveMixtapeAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  await requireStudio();
  const id = idSchema.safeParse(field(formData, "id"));
  const direction = directionSchema.safeParse(field(formData, "direction"));
  if (!id.success || !direction.success) return invalid("pedido inválido.");
  return attempt(async () => {
    await moveMixtape(getDatabase(), id.data, direction.data);
    return "ordem da estante salva.";
  });
}

/** Sets a tape's cover or detail photo: an existing one, a new upload, or none. */
export async function setMixtapeImageAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  await requireStudio();
  const id = idSchema.safeParse(field(formData, "id"));
  const slot = field(formData, "slot");
  if (!id.success || (slot !== "cover" && slot !== "detail")) {
    return invalid("pedido inválido.");
  }
  const file = formData.get("file");
  const existing = field(formData, "imageId");
  if (file instanceof File && file.size > 0) {
    const uploaded = await uploadImage(formData);
    if (!uploaded.ok) return uploaded;
    return attempt(async () => {
      await setMixtapeImage(getDatabase(), id.data, slot, uploaded.id!);
      return { message: "foto enviada.", id: uploaded.id! };
    });
  }
  const imageId = existing ? idSchema.safeParse(existing) : null;
  if (imageId && !imageId.success) return invalid("foto inválida.");
  return attempt(async () => {
    await setMixtapeImage(getDatabase(), id.data, slot, imageId?.data ?? null);
    return imageId ? "foto escolhida." : "foto removida da fita.";
  });
}

export async function addTrackAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  await requireStudio();
  const id = idSchema.safeParse(field(formData, "mixtapeId"));
  if (!id.success) return invalid("fita inválida.");
  const song = songSchema.safeParse({
    title: field(formData, "title"),
    artist: field(formData, "artist"),
  });
  if (!song.success) {
    return {
      ok: false,
      error: song.error.issues[0]!.message,
      fieldErrors: fieldErrors(song.error),
    };
  }
  return attempt(async () => {
    await addTrack(getDatabase(), id.data, song.data);
    return `${song.data.title} entrou na fita.`;
  });
}

export async function removeTrackAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  await requireStudio();
  const id = idSchema.safeParse(field(formData, "trackId"));
  if (!id.success) return invalid("faixa inválida.");
  return attempt(async () => {
    await removeTrack(getDatabase(), id.data);
    return "a faixa saiu da fita.";
  });
}

export async function moveTrackAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  await requireStudio();
  const id = idSchema.safeParse(field(formData, "trackId"));
  const direction = directionSchema.safeParse(field(formData, "direction"));
  if (!id.success || !direction.success) return invalid("pedido inválido.");
  return attempt(async () => {
    await moveTrack(getDatabase(), id.data, direction.data);
    return "ordem salva.";
  });
}

export async function saveTrackNoteAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  await requireStudio();
  const id = idSchema.safeParse(field(formData, "trackId"));
  const note = noteSchema.safeParse({
    note: field(formData, "note"),
    noteSide: field(formData, "noteSide"),
  });
  if (!id.success) return invalid("faixa inválida.");
  if (!note.success) return invalid(note.error.issues[0]!.message);
  return attempt(async () => {
    await updateTrackNote(
      getDatabase(),
      id.data,
      note.data.note,
      note.data.noteSide,
    );
    return note.data.note ? "anotação salva." : "anotação apagada.";
  });
}
