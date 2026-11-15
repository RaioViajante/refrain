// The sign-in limits on real PostgreSQL (issue #11): fixed windows, per-client
// buckets before one global ceiling, and atomic counting over separate
// connections. Keys are unique per test, and every committed row is removed.
import { like, sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import { getDb, schema } from "@/db";
import { inRollbackTransaction, uniqueLabel, withConnections } from "@/testing";

import { SIGN_IN_RATE_LIMIT } from "./auth";
import {
  consumeAttempt,
  limitSignIn,
  SIGN_IN_GLOBAL_LIMIT,
} from "./sign-in-limits";
import { testAuthConfig } from "./test-helpers";

const trusted = testAuthConfig({ trustedClientIpHeader: "x-forwarded-for" });
const untrusted = testAuthConfig();
const T0 = 1_800_000_000_000;

function signIn(client?: string, extra: Record<string, string> = {}) {
  return new Request("http://localhost:3000/api/auth/sign-in/email", {
    method: "POST",
    headers: client ? { "x-forwarded-for": client, ...extra } : extra,
  });
}

const committedPrefix = uniqueLabel("rl");

afterAll(async () => {
  await getDb()
    .delete(schema.authRateLimits)
    .where(like(schema.authRateLimits.key, `${committedPrefix}%`));
});

describe("consumeAttempt", () => {
  it("allows exactly the limit in a window, then refuses, then starts a new window", async () => {
    await inRollbackTransaction(async (tx) => {
      const limit = { window: 60, max: 3 };
      const results = [];
      for (let i = 0; i < 5; i++) {
        results.push(await consumeAttempt(tx, "k", limit, T0 + i * 1000));
      }
      expect(results).toEqual([true, true, true, false, false]);
      // Still inside the window that started at T0: refused, and refusing
      // never moves the window.
      expect(await consumeAttempt(tx, "k", limit, T0 + 59_999)).toBe(false);
      // A full window after its start: a new window.
      expect(await consumeAttempt(tx, "k", limit, T0 + 60_000)).toBe(true);
      expect(await consumeAttempt(tx, "other", limit, T0)).toBe(true);
    });
  });

  it("counts atomically: of 40 simultaneous attempts on separate connections, exactly the limit is allowed", async () => {
    const key = `${committedPrefix}-race`;
    const limit = { window: 60, max: 7 };
    const allowed = await withConnections(8, async (databases) => {
      const outcomes = await Promise.all(
        Array.from({ length: 40 }, (_, i) =>
          consumeAttempt(databases[i % databases.length]!, key, limit, T0),
        ),
      );
      return outcomes.filter(Boolean).length;
    });
    expect(allowed).toBe(7);
    const [row] = await getDb()
      .select()
      .from(schema.authRateLimits)
      .where(sql`${schema.authRateLimits.key} = ${key}`);
    expect(row!.count).toBe(40);
  });
});

describe("limitSignIn", () => {
  it("keeps one shared bucket when no header is trusted, whatever addresses the requests claim", async () => {
    await inRollbackTransaction(async (tx) => {
      const outcomes = [];
      for (let i = 0; i < SIGN_IN_RATE_LIMIT.max + 2; i++) {
        outcomes.push(
          await limitSignIn(tx, signIn(`203.0.113.${i + 1}`), untrusted, T0),
        );
      }
      expect(outcomes.filter((o) => o === "allowed")).toHaveLength(
        SIGN_IN_RATE_LIMIT.max,
      );
      expect(outcomes.at(-1)).toBe("client_limited");
    });
  });

  it("gives each trusted client its own bucket, so one client cannot lock out another", async () => {
    await inRollbackTransaction(async (tx) => {
      for (let i = 0; i < SIGN_IN_RATE_LIMIT.max + 5; i++) {
        await limitSignIn(tx, signIn("198.51.100.66"), trusted, T0);
      }
      expect(await limitSignIn(tx, signIn("198.51.100.66"), trusted, T0)).toBe(
        "client_limited",
      );
      // The author, from another address, still gets through.
      expect(await limitSignIn(tx, signIn("203.0.113.9"), trusted, T0)).toBe(
        "allowed",
      );
    });
  });

  it("counts an attempt its own bucket refused nowhere else: one client cannot use up the global ceiling", async () => {
    await inRollbackTransaction(async (tx) => {
      for (let i = 0; i < SIGN_IN_GLOBAL_LIMIT.max * 3; i++) {
        await limitSignIn(tx, signIn("198.51.100.66"), trusted, T0);
      }
      expect(await limitSignIn(tx, signIn("203.0.113.9"), trusted, T0)).toBe(
        "allowed",
      );
    });
  });

  it("stops every client once many clients together reach the global ceiling, until the window ends", async () => {
    await inRollbackTransaction(async (tx) => {
      const clients = Math.ceil(
        SIGN_IN_GLOBAL_LIMIT.max / SIGN_IN_RATE_LIMIT.max,
      );
      let allowed = 0;
      for (let c = 0; c < clients; c++) {
        for (let i = 0; i < SIGN_IN_RATE_LIMIT.max; i++) {
          if (
            (await limitSignIn(
              tx,
              signIn(`198.51.100.${c + 1}`),
              trusted,
              T0,
            )) === "allowed"
          ) {
            allowed += 1;
          }
        }
      }
      expect(allowed).toBe(SIGN_IN_GLOBAL_LIMIT.max);
      expect(await limitSignIn(tx, signIn("203.0.113.9"), trusted, T0)).toBe(
        "globally_limited",
      );
      expect(
        await limitSignIn(
          tx,
          signIn("203.0.113.9"),
          trusted,
          T0 + SIGN_IN_GLOBAL_LIMIT.window * 1000,
        ),
      ).toBe("allowed");
    });
  });

  it("treats a missing or malformed trusted header as the one unknown client, never as a fresh bucket", async () => {
    await inRollbackTransaction(async (tx) => {
      const claims = [
        undefined,
        "203.0.113.7, 198.51.100.1",
        "not-an-address",
        "",
        "refrain-global",
      ];
      const outcomes = [];
      for (let i = 0; i < SIGN_IN_RATE_LIMIT.max + 1; i++) {
        outcomes.push(
          await limitSignIn(tx, signIn(claims[i % claims.length]), trusted, T0),
        );
      }
      expect(outcomes.at(-1)).toBe("client_limited");
    });
  });
});
