"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { signIn, signOut } from "@/server/auth/studio";
import type { ActionResult } from "@/server/studio/errors";

import { field } from "./support";

const credentials = z.object({
  email: z.string().trim().min(3).max(254),
  password: z.string().min(1).max(1024),
});

const MESSAGES = {
  invalid: "e-mail ou senha incorretos.",
  throttled: "muitas tentativas. espere alguns minutos e tente de novo.",
  closed: "o studio ainda não está configurado neste ambiente.",
} as const;

/** The only Studio action that runs without a session: signing in. */
export async function signInAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = credentials.safeParse({
    email: field(formData, "email"),
    password: field(formData, "password"),
  });
  if (!parsed.success) return { ok: false, error: MESSAGES.invalid };
  const result = await signIn(parsed.data.email, parsed.data.password);
  if (!result.ok) return { ok: false, error: MESSAGES[result.reason] };
  redirect("/studio");
}

export async function signOutAction(): Promise<void> {
  await signOut();
  redirect("/studio/entrar");
}
