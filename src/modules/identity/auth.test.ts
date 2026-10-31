import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { describe, expect, it } from "vitest";

import { schema } from "@/db";

import { createAuth } from "./auth";
import { testAuthConfig } from "./test-helpers";
import { AUTH_ENDPOINTS, createAuthRequestHandler } from "./handler";

// A database client that is never connected: these tests do not query.
function unconnectedDatabase() {
  return drizzle({
    client: new Pool({
      connectionString: "postgres://unused@127.0.0.1:1/unused",
    }),
    schema,
  });
}

describe("Better Auth configuration", () => {
  it("matches the Drizzle schema, by Better Auth's own schema check", async () => {
    const context = await createAuth(unconnectedDatabase(), testAuthConfig())
      .$context;
    expect(context.explicitSchemaCheck).toBeTypeOf("function");
    await expect(
      Promise.resolve(context.explicitSchemaCheck?.()),
    ).resolves.toBeUndefined();
  });

  it("keeps the security-relevant options regardless of NODE_ENV", async () => {
    const context = await createAuth(unconnectedDatabase(), testAuthConfig())
      .$context;
    expect(context.skipOriginCheck).toBe(false);
    expect(context.skipCSRFCheck).toBe(false);
    expect(context.rateLimit).toMatchObject({
      enabled: true,
      storage: "database",
    });
    // The base URL, which Better Auth trusts by default, and nothing else.
    expect(new Set(context.trustedOrigins)).toEqual(
      new Set(["http://localhost:3000"]),
    );
    expect(context.options.emailAndPassword?.disableSignUp).toBe(true);
    expect(context.options.session?.cookieCache?.enabled).toBe(false);
    expect(context.options.telemetry?.enabled).toBe(false);
    expect(context.socialProviders).toEqual([]);
  });

  it("names cookies after Refrain, HttpOnly and SameSite=Strict", async () => {
    const local = await createAuth(unconnectedDatabase(), testAuthConfig())
      .$context;
    expect(local.authCookies.sessionToken).toMatchObject({
      name: "refrain.session_token",
      attributes: {
        httpOnly: true,
        sameSite: "strict",
        secure: false,
        path: "/",
      },
    });
    const hosted = await createAuth(
      unconnectedDatabase(),
      testAuthConfig({ baseURL: "https://refrain.example" }),
    ).$context;
    expect(hosted.authCookies.sessionToken).toMatchObject({
      name: "__Secure-refrain.session_token",
      attributes: { httpOnly: true, sameSite: "strict", secure: true },
    });
  });
});

describe("authentication handler, before Better Auth", () => {
  const config = testAuthConfig();
  const handle = createAuthRequestHandler(() => ({
    auth: createAuth(unconnectedDatabase(), config),
    config,
  }));

  it("passes exactly three endpoints", () => {
    expect([...AUTH_ENDPOINTS].sort()).toEqual([
      "GET /api/auth/get-session",
      "POST /api/auth/sign-in/email",
      "POST /api/auth/sign-out",
    ]);
  });

  it("answers a declared oversized body with 413, unread", async () => {
    const response = await handle(
      new Request(`${config.baseURL}/api/auth/sign-in/email`, {
        method: "POST",
        headers: {
          origin: config.baseURL,
          "content-type": "application/json",
          "content-length": "100000",
        },
        body: "{}",
      }),
    );
    expect(response.status).toBe(413);
  });

  it("checks the origin before anything reaches the database", async () => {
    const response = await handle(
      new Request(`${config.baseURL}/api/auth/sign-out`, {
        method: "POST",
        headers: {
          origin: "https://attacker.example",
          cookie: "refrain.session_token=x",
        },
      }),
    );
    expect(response.status).toBe(403);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});
