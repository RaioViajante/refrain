"use server";

import { getDatabase } from "@/db/client";
import { requireStudio } from "@/server/auth/studio";
import type { ActionResult } from "@/server/studio/errors";
import {
  addSongToMixtape,
  listStudioMixtapes,
  removeSongFromMixtape,
} from "@/server/studio/mixtapes";
import { fieldErrors, idSchema, songSchema } from "@/server/studio/schemas";
import {
  createSong,
  deleteSong,
  getSong,
  updateSong,
} from "@/server/studio/songs";

import { attempt, confirmed, field, invalid } from "./support";

/**
 * Creates or edits a song, and puts it on (or takes it off) the tapes ticked
 * in the form (`tapes`, one value per tape id).
 */
export async function saveSongAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  await requireStudio();
  const rawId = field(formData, "id");
  const id = rawId ? idSchema.safeParse(rawId) : null;
  if (id && !id.success) return invalid("música inválida.");
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
  const ticked = new Set(
    formData.getAll("tapes").filter((v): v is string => typeof v === "string"),
  );
  return attempt(async () => {
    const db = getDatabase();
    const songId = await db.transaction(async (tx) => {
      const songId = id
        ? (await updateSong(tx, id.data!, song.data), id.data!)
        : await createSong(tx, song.data);
      const on = new Set(
        (await getSong(tx, songId))?.appearances.map((a) => a.mixtapeId),
      );
      for (const tape of await listStudioMixtapes(tx)) {
        if (ticked.has(tape.id) && !on.has(tape.id)) {
          await addSongToMixtape(tx, tape.id, songId);
        }
        if (!ticked.has(tape.id) && on.has(tape.id)) {
          await removeSongFromMixtape(tx, tape.id, songId);
        }
      }
      return songId;
    });
    return {
      message: id
        ? `${song.data.title} foi atualizada.`
        : `${song.data.title} entrou no catálogo.`,
      id: songId,
    };
  });
}

export async function deleteSongAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  await requireStudio();
  const id = idSchema.safeParse(field(formData, "id"));
  if (!id.success) return invalid("música inválida.");
  if (!confirmed(formData)) return invalid("confirme a exclusão.");
  return attempt(async () => {
    await deleteSong(getDatabase(), id.data);
    return "a música saiu do catálogo e das fitas.";
  });
}
