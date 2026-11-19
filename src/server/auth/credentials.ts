// The Studio owner's credentials, from server-side environment variables
// only (never NEXT_PUBLIC_). Without both, sign-in is closed.
import { parsePasswordHash } from "./password";

export type StudioCredentials = { email: string; passwordHash: string };

export function readStudioCredentials(
  env: Readonly<Record<string, string | undefined>> = process.env,
): StudioCredentials | null {
  const email = env.STUDIO_EMAIL?.trim().toLowerCase();
  const passwordHash = env.STUDIO_PASSWORD_HASH?.trim();
  if (!email || !passwordHash) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  if (!parsePasswordHash(passwordHash)) return null;
  return { email, passwordHash };
}
