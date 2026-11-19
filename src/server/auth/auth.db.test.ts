import { describe, expect, it } from "vitest";

import { studioSessions } from "@/db/schema";
import { connectTestDatabase } from "@/test/db";

import { readStudioCredentials } from "./credentials";
import { attemptLogin } from "./login";
import { hashPassword, parsePasswordHash, verifyPassword } from "./password";
import { deleteSession, findSession, SESSION_TTL_MS } from "./sessions";
import { clientKey, GLOBAL, PER_CLIENT } from "./throttle";

const db = connectTestDatabase();
// Lowest accepted cost, to keep the suite fast. Production uses N = 2^15.
const FAST = { N: 2 ** 14, r: 8, p: 1 };
const PASSWORD = "[Test] correct horse battery";
const hash = await hashPassword(PASSWORD, FAST);
const credentials = { email: "owner@example.test", passwordHash: hash };
const login = (
  password: string,
  client = "198.51.100.1",
  email = "owner@example.test",
  now = new Date(),
) =>
  attemptLogin(
    db,
    { email, password, clientKey: clientKey(client) },
    credentials,
    now,
  );

describe("password hashing", () => {
  it("verifies the right password only", async () => {
    expect(await verifyPassword(PASSWORD, hash)).toBe(true);
    expect(await verifyPassword(`${PASSWORD} `, hash)).toBe(false);
    expect(await verifyPassword(PASSWORD, "scrypt:1:1:1:x:y")).toBe(false);
  });

  it("refuses hashes with unsafe parameters", () => {
    expect(parsePasswordHash(hash)).not.toBeNull();
    expect(parsePasswordHash(hash.replace(":16384:", ":1024:"))).toBeNull();
    expect(parsePasswordHash("plaintext")).toBeNull();
  });
});

describe("readStudioCredentials", () => {
  it("closes sign-in without a valid email and hash", () => {
    expect(readStudioCredentials({})).toBeNull();
    expect(
      readStudioCredentials({
        STUDIO_EMAIL: "a@b.c",
        STUDIO_PASSWORD_HASH: "x",
      }),
    ).toBeNull();
    expect(
      readStudioCredentials({
        STUDIO_EMAIL: "nope",
        STUDIO_PASSWORD_HASH: hash,
      }),
    ).toBeNull();
    expect(
      readStudioCredentials({
        STUDIO_EMAIL: " Owner@Example.test ",
        STUDIO_PASSWORD_HASH: hash,
      }),
    ).toEqual({ email: "owner@example.test", passwordHash: hash });
  });
});

describe("attemptLogin", () => {
  it("is closed when no credentials are configured", async () => {
    expect(
      await attemptLogin(
        db,
        { email: "a", password: "b", clientKey: clientKey("x") },
        null,
      ),
    ).toEqual({ ok: false, reason: "closed" });
  });

  it("opens a session only for the right email and password", async () => {
    expect(await login("wrong")).toEqual({ ok: false, reason: "invalid" });
    expect(await login(PASSWORD, "198.51.100.1", "other@example.test")).toEqual(
      {
        ok: false,
        reason: "invalid",
      },
    );
    const ok = await login(PASSWORD, "198.51.100.1", "OWNER@example.test");
    expect(ok.ok).toBe(true);
    if (!ok.ok) return;
    expect(await findSession(db, ok.token)).not.toBeNull();
    // Only the token's hash is stored.
    const rows = await db.select().from(studioSessions);
    expect(JSON.stringify(rows)).not.toContain(ok.token);
  });

  it("throttles a client after repeated failures, even with the right password", async () => {
    for (let i = 0; i < PER_CLIENT; i++) await login("wrong");
    expect(await login(PASSWORD)).toEqual({ ok: false, reason: "throttled" });
    expect((await login(PASSWORD, "203.0.113.9")).ok).toBe(true);
    // The window passes.
    const later = new Date(Date.now() + 16 * 60 * 1000);
    expect(
      (await login(PASSWORD, "198.51.100.1", "owner@example.test", later)).ok,
    ).toBe(true);
  });

  it("throttles everyone after many failures from many clients", async () => {
    for (let i = 0; i < GLOBAL; i++) await login("wrong", `192.0.2.${i}`);
    expect(await login(PASSWORD, "203.0.113.50")).toEqual({
      ok: false,
      reason: "throttled",
    });
  });
});

describe("sessions", () => {
  it("expire, refuse malformed tokens, and end on sign-out", async () => {
    const ok = await login(PASSWORD);
    if (!ok.ok) throw new Error("expected a session");
    expect(
      await findSession(
        db,
        ok.token,
        new Date(Date.now() + SESSION_TTL_MS + 1000),
      ),
    ).toBeNull();
    expect(await findSession(db, "not a token")).toBeNull();
    expect(await findSession(db, undefined)).toBeNull();
    await deleteSession(db, ok.token);
    expect(await findSession(db, ok.token)).toBeNull();
  });
});
