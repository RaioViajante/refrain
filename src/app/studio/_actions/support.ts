// Shared by the Studio's Server Actions (not itself a "use server" module).
import "server-only";

import { revalidatePath } from "next/cache";

import { ImageFileError } from "@/server/media/image-file";
import { type ActionResult, StudioError } from "@/server/studio/errors";

/** Runs a write; expected failures become a message for the form. */
export async function attempt(
  work: () => Promise<string | { message: string; id: string }>,
): Promise<ActionResult> {
  try {
    const done = await work();
    // Public pages render per request; this refreshes cached router payloads.
    revalidatePath("/", "layout");
    return typeof done === "string"
      ? { ok: true, message: done }
      : { ok: true, ...done };
  } catch (error) {
    if (error instanceof StudioError || error instanceof ImageFileError) {
      return { ok: false, error: error.message };
    }
    throw error;
  }
}

/** A form field as a string ("" when absent or not text). */
export function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

export function invalid(message: string): ActionResult {
  return { ok: false, error: message };
}

/** The form's explicit confirmation of a destructive action. */
export function confirmed(formData: FormData): boolean {
  return field(formData, "confirmar") === "sim";
}
