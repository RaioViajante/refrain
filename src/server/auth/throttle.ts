// Sign-in throttling, in PostgreSQL so it holds across serverless instances.
// A client is blocked after PER_CLIENT failures within WINDOW (failures before
// its last success do not count); everyone is blocked after GLOBAL failures
// within WINDOW, which slows a distributed attack on the single account.
import { createHash } from "node:crypto";

import { and, count, eq, gt, lt, max, sql } from "drizzle-orm";

import { studioLoginAttempts } from "@/db/schema";
import type { Database } from "@/db/types";

export const WINDOW_MS = 15 * 60 * 1000;
export const PER_CLIENT = 5;
export const GLOBAL = 30;
const KEEP_MS = 24 * 60 * 60 * 1000;

const at = (date: Date) => sql`${date.toISOString()}::timestamptz`;

/** A stable, non-reversible key for a client address. */
export function clientKey(address: string | null | undefined): string {
  return createHash("sha256")
    .update(`refrain-studio:${address?.trim() || "unknown"}`)
    .digest("hex");
}

export async function isThrottled(
  db: Database,
  key: string,
  now = new Date(),
): Promise<boolean> {
  const since = new Date(now.getTime() - WINDOW_MS);
  const [lastSuccess] = await db
    .select({ at: max(studioLoginAttempts.attemptedAt) })
    .from(studioLoginAttempts)
    .where(
      and(
        eq(studioLoginAttempts.clientKey, key),
        eq(studioLoginAttempts.succeeded, true),
      ),
    );
  const clientSince =
    lastSuccess?.at && lastSuccess.at > since ? lastSuccess.at : since;

  const [client] = await db
    .select({ n: count() })
    .from(studioLoginAttempts)
    .where(
      and(
        eq(studioLoginAttempts.clientKey, key),
        eq(studioLoginAttempts.succeeded, false),
        gt(studioLoginAttempts.attemptedAt, at(clientSince)),
      ),
    );
  if ((client?.n ?? 0) >= PER_CLIENT) return true;

  const [all] = await db
    .select({ n: count() })
    .from(studioLoginAttempts)
    .where(
      and(
        eq(studioLoginAttempts.succeeded, false),
        gt(studioLoginAttempts.attemptedAt, at(since)),
      ),
    );
  return (all?.n ?? 0) >= GLOBAL;
}

export async function recordAttempt(
  db: Database,
  key: string,
  succeeded: boolean,
  now = new Date(),
): Promise<void> {
  await db
    .insert(studioLoginAttempts)
    .values({ clientKey: key, succeeded, attemptedAt: now });
  await db
    .delete(studioLoginAttempts)
    .where(
      lt(
        studioLoginAttempts.attemptedAt,
        at(new Date(now.getTime() - KEEP_MS)),
      ),
    );
}
