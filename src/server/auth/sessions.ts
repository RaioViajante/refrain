// Studio sessions in PostgreSQL. The cookie holds a random 256-bit token; the
// database holds only its SHA-256, so a database leak yields no session.
import { createHash, randomBytes } from "node:crypto";

import { and, eq, gt, lt, sql } from "drizzle-orm";

import { studioSessions } from "@/db/schema";
import type { Database } from "@/db/types";

export const SESSION_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const TOUCH_AFTER_MS = 60 * 60 * 1000;

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function createSession(
  db: Database,
  now = new Date(),
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
  await db.insert(studioSessions).values({
    tokenHash: hashToken(token),
    createdAt: now,
    lastSeenAt: now,
    expiresAt,
  });
  return { token, expiresAt };
}

/** The live session for a token, or null (unknown, malformed, or expired). */
export async function findSession(
  db: Database,
  token: string | undefined,
  now = new Date(),
): Promise<{ id: string; expiresAt: Date } | null> {
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const [session] = await db
    .select({
      id: studioSessions.id,
      expiresAt: studioSessions.expiresAt,
      lastSeenAt: studioSessions.lastSeenAt,
    })
    .from(studioSessions)
    .where(
      and(
        eq(studioSessions.tokenHash, hashToken(token)),
        gt(studioSessions.expiresAt, now),
      ),
    )
    .limit(1);
  if (!session) return null;
  if (now.getTime() - session.lastSeenAt.getTime() > TOUCH_AFTER_MS) {
    await db
      .update(studioSessions)
      .set({ lastSeenAt: now })
      .where(eq(studioSessions.id, session.id));
  }
  return { id: session.id, expiresAt: session.expiresAt };
}

export async function deleteSession(
  db: Database,
  token: string | undefined,
): Promise<void> {
  if (!token) return;
  await db
    .delete(studioSessions)
    .where(eq(studioSessions.tokenHash, hashToken(token)));
}

export async function pruneSessions(db: Database, now = new Date()) {
  await db
    .delete(studioSessions)
    .where(
      lt(studioSessions.expiresAt, sql`${now.toISOString()}::timestamptz`),
    );
}
