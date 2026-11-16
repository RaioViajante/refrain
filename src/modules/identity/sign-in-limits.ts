import "server-only";

import { isIP } from "node:net";

import { sql } from "drizzle-orm";

import type { DatabaseExecutor } from "@/db";

import { SIGN_IN_RATE_LIMIT } from "./auth";
import type { AuthConfig } from "./config";

// The sign-in limits the handler applies before Better Auth (issue #11;
// ADR 0004 § 6; docs/security.md § Deployment gate, item 1).
//
// 1. Per client. Where the hosting platform names the client
//    (config.trustedClientIpHeader), each client has its own bucket of five
//    attempts a minute, so one client can no longer keep the author locked
//    out by exhausting a bucket everyone shares. IPv6 clients are grouped by
//    their /64, the block one network usually holds. Where no trusted header
//    names the client, every client is the same `unknown` client: the one
//    shared bucket of before, unchanged.
// 2. Globally. Attempts that pass their client's bucket also count against
//    one ceiling for every client together, so many clients cannot add up to
//    unlimited guessing. An attempt its own bucket refuses is never counted
//    here, so one client cannot use up the ceiling. It is set high (300 a
//    minute): locking every client out takes sixty clients rotating, while
//    300 guesses a minute stay hopeless against a password of at least 15
//    characters. Sixty clients still can, by design: a pause in sign-in is
//    less harmful than unbounded guessing (ADR 0004 § 6).
//
// The counters live in PostgreSQL (`auth_rate_limits`, beside Better Auth's
// own), are updated in one statement each, and fail closed: if they cannot be
// read, the handler refuses the attempt. Better Auth's own limiter still runs
// after these, on the same per-client rule.

/** The ceiling for every client together, per window. */
export const SIGN_IN_GLOBAL_LIMIT = { window: 60, max: 300 } as const;

/** The client's key when no trusted header names it. */
export const UNKNOWN_CLIENT = "unknown";

const PATH = "/sign-in/email";

// Better Auth's keys are `<address or "no-trusted-ip">|<path>`; these begin
// with a word no address can be, so the counters never meet.
const clientKey = (client: string) => `refrain-client:${client}|${PATH}`;
const GLOBAL_KEY = `refrain-global|${PATH}`;

/** IPv6, expanded to eight four-digit groups, or null if it is not one. */
function expandIPv6(address: string): string[] | null {
  if (isIP(address) !== 6) {
    return null;
  }
  // The URL parser writes an IPv6 address in one canonical, compressed form.
  // It refuses a zone (`fe80::1%eth0`), which is then no client address.
  let host: string;
  try {
    host = new URL(`http://[${address}]`).hostname.slice(1, -1);
  } catch {
    return null;
  }
  const [head = "", tail] = host.split("::");
  const left = head ? head.split(":") : [];
  const right = tail !== undefined && tail !== "" ? tail.split(":") : [];
  const embedded = right.at(-1)?.includes(".") ?? false;
  if (embedded) {
    // A trailing IPv4 part (`::ffff:192.0.2.1`) is two groups.
    const [a, b, c, d] = right.pop()!.split(".").map(Number);
    right.push(((a! << 8) | b!).toString(16), ((c! << 8) | d!).toString(16));
  }
  const missing = 8 - left.length - right.length;
  if (missing < 0 || (tail === undefined && missing !== 0)) {
    return null;
  }
  return [...left, ...Array<string>(missing).fill("0"), ...right].map((group) =>
    group.padStart(4, "0"),
  );
}

/**
 * The client a request comes from, as the trusted header names it: one IPv4
 * address, or an IPv6 /64. `unknown` when no header is trusted, or when the
 * header is missing, holds more than one value, or is not an address.
 */
export function signInClient(request: Request, config: AuthConfig): string {
  const header = config.trustedClientIpHeader;
  if (!header) {
    return UNKNOWN_CLIENT;
  }
  const value = request.headers.get(header)?.trim() ?? "";
  if (value === "" || value.includes(",")) {
    return UNKNOWN_CLIENT;
  }
  if (isIP(value) === 4) {
    return value;
  }
  const groups = expandIPv6(value);
  if (!groups) {
    return UNKNOWN_CLIENT;
  }
  // An IPv4 address written as IPv6 (`::ffff:a.b.c.d`) is that IPv4 client.
  if (groups.slice(0, 6).join(":") === "0000:0000:0000:0000:0000:ffff") {
    const [hi, lo] = [parseInt(groups[6]!, 16), parseInt(groups[7]!, 16)];
    return [hi >> 8, hi & 255, lo >> 8, lo & 255].join(".");
  }
  return `${groups.slice(0, 4).join(":")}::/64`;
}

/**
 * Counts one attempt in a fixed window and returns the window's count (the
 * attempt is within the limit while it is at most the limit's maximum). One statement: the row is created, or its window restarted, or its
 * count raised, atomically under concurrent requests.
 */
export async function consumeAttempt(
  database: DatabaseExecutor,
  key: string,
  limit: { window: number; max: number },
  now: number,
): Promise<number> {
  const windowStart = now - limit.window * 1000;
  const result = await database.execute<{ count: number }>(sql`
    insert into auth_rate_limits (key, count, last_request)
    values (${key}, 1, ${now})
    on conflict (key) do update set
      count = case
        when auth_rate_limits.last_request <= ${windowStart} then 1
        else auth_rate_limits.count + 1
      end,
      last_request = case
        when auth_rate_limits.last_request <= ${windowStart} then ${now}
        else auth_rate_limits.last_request
      end
    returning count
  `);
  return Number(result.rows[0]?.count);
}

const within = (count: number, limit: { max: number }) =>
  Number.isInteger(count) && count <= limit.max;

/**
 * Removes this module's per-client rows whose window has ended, so a client
 * that never returns leaves no row behind. Run when the global window
 * restarts: at most once a window while sign-ins arrive.
 */
async function pruneClients(database: DatabaseExecutor, now: number) {
  await database.execute(sql`
    delete from auth_rate_limits
    where key like ${"refrain-client:%"}
      and last_request <= ${now - SIGN_IN_RATE_LIMIT.window * 1000}
  `);
}

export type SignInLimit = "allowed" | "client_limited" | "globally_limited";

/** Applies the per-client limit, then the global ceiling. */
export async function limitSignIn(
  database: DatabaseExecutor,
  request: Request,
  config: AuthConfig,
  now: number = Date.now(),
): Promise<SignInLimit> {
  const client = signInClient(request, config);
  const clientCount = await consumeAttempt(
    database,
    clientKey(client),
    SIGN_IN_RATE_LIMIT,
    now,
  );
  if (!within(clientCount, SIGN_IN_RATE_LIMIT)) {
    return "client_limited";
  }
  const globalCount = await consumeAttempt(
    database,
    GLOBAL_KEY,
    SIGN_IN_GLOBAL_LIMIT,
    now,
  );
  if (globalCount === 1) {
    await pruneClients(database, now);
  }
  if (!within(globalCount, SIGN_IN_GLOBAL_LIMIT)) {
    return "globally_limited";
  }
  return "allowed";
}
