// The Studio's guard. Every Studio page, layout, Server Action, and route
// handler calls requireStudio() itself, on the server, before anything else
// (AGENTS.md § 4). Hidden links and client checks are never the protection.
import "server-only";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";

import { getDatabase } from "@/db/client";

import { readStudioCredentials } from "./credentials";
import { attemptLogin, type LoginResult } from "./login";
import { deleteSession, findSession } from "./sessions";
import { clientKey } from "./throttle";

/** `__Host-`: Secure, host-only, path "/"; never sent to another subdomain. */
export const SESSION_COOKIE = "__Host-refrain-studio";
export const LOGIN_PATH = "/studio/entrar";

/** The current request's Studio session, or null. Read once per request. */
export const getStudioSession = cache(async () => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return findSession(getDatabase(), token);
});

/** Ends the request with a redirect to sign-in unless the owner is signed in. */
export async function requireStudio(): Promise<void> {
  if (!(await getStudioSession())) redirect(LOGIN_PATH);
}

async function clientAddress(): Promise<string | null> {
  const h = await headers();
  // On Vercel, x-real-ip and x-forwarded-for are set by the platform.
  return h.get("x-real-ip") ?? h.get("x-forwarded-for")?.split(",")[0] ?? null;
}

export async function signIn(
  email: string,
  password: string,
): Promise<LoginResult> {
  const result = await attemptLogin(
    getDatabase(),
    { email, password, clientKey: clientKey(await clientAddress()) },
    readStudioCredentials(),
  );
  if (result.ok) {
    (await cookies()).set(SESSION_COOKIE, result.token, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      expires: result.expiresAt,
    });
  }
  return result;
}

export async function signOut(): Promise<void> {
  const jar = await cookies();
  await deleteSession(getDatabase(), jar.get(SESSION_COOKIE)?.value);
  jar.delete({ name: SESSION_COOKIE, path: "/", secure: true });
}
