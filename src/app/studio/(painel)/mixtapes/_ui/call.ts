// Calls a Studio Server Action from client code with plain fields.
import type { ActionResult } from "@/server/studio/errors";

export type StudioAction = (
  prev: ActionResult | null,
  formData: FormData,
) => Promise<ActionResult>;

export async function call(
  action: StudioAction,
  fields: Record<string, string | Blob>,
): Promise<ActionResult> {
  const formData = new FormData();
  for (const [name, value] of Object.entries(fields)) {
    formData.append(name, value);
  }
  try {
    return await action(null, formData);
  } catch {
    return {
      ok: false,
      error: "não foi possível falar com o servidor. tente de novo.",
    };
  }
}

/** A message carried across a redirect (the list shows it once). */
const FLASH_KEY = "refrain:studio:mixtapes";

export function setFlash(message: string) {
  try {
    sessionStorage.setItem(FLASH_KEY, message);
  } catch {
    // Storage may be unavailable; the message is a convenience.
  }
}

export function takeFlash(): string | null {
  try {
    const message = sessionStorage.getItem(FLASH_KEY);
    sessionStorage.removeItem(FLASH_KEY);
    return message;
  } catch {
    return null;
  }
}

export function pad(n: number): string {
  return String(n).padStart(2, "0");
}
