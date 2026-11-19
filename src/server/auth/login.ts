// The sign-in decision, independent of Next.js so it can be tested against a
// real database: throttle first, then a constant-time check of both fields.
import { createHash, timingSafeEqual } from "node:crypto";

import type { Database } from "@/db/types";

import type { StudioCredentials } from "./credentials";
import { verifyPassword } from "./password";
import { createSession, pruneSessions } from "./sessions";
import { isThrottled, recordAttempt } from "./throttle";

export type LoginResult =
  | { ok: true; token: string; expiresAt: Date }
  | { ok: false; reason: "invalid" | "throttled" | "closed" };

const digest = (s: string) => createHash("sha256").update(s).digest();

export async function attemptLogin(
  db: Database,
  input: { email: string; password: string; clientKey: string },
  credentials: StudioCredentials | null,
  now = new Date(),
): Promise<LoginResult> {
  if (!credentials) return { ok: false, reason: "closed" };
  if (await isThrottled(db, input.clientKey, now)) {
    return { ok: false, reason: "throttled" };
  }

  // Both checks always run, so timing does not reveal which one failed.
  const emailOk = timingSafeEqual(
    digest(input.email.trim().toLowerCase()),
    digest(credentials.email),
  );
  const passwordOk = await verifyPassword(
    input.password,
    credentials.passwordHash,
  );
  const ok = emailOk && passwordOk;

  await recordAttempt(db, input.clientKey, ok, now);
  if (!ok) return { ok: false, reason: "invalid" };

  await pruneSessions(db, now);
  const session = await createSession(db, now);
  return { ok: true, ...session };
}
