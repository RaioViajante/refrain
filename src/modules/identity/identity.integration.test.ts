// Authentication and authorization against real PostgreSQL (the disposable
// test database), through Better Auth's real request handling. Every test
// runs in a rolled-back transaction: the Better Auth instance under test is
// bound to that transaction, so nothing is committed.
import { count, eq, sql } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";

import { schema, type Transaction } from "@/db";
import { expectRejected, inRollbackTransaction, SqlState } from "@/testing";

import { authorizeAuthor, authorizeAuthorWith } from "./authorization";
import { AuthConfigError, type AuthConfig } from "./config";
import { createAuthRequestHandler } from "./handler";
import { provisionAuthor, resetAuthorPassword } from "./provisioning";
import {
  authRequest,
  cookieHeaders,
  sessionCookieFrom,
  TEST_AUTHOR_EMAIL,
  TEST_PASSWORD,
  testAuth,
  testAuthConfig,
} from "./test-helpers";

type TestAuth = ReturnType<typeof testAuth>;

async function withAuthor(tx: Transaction, config?: AuthConfig) {
  const setup = testAuth(tx, config);
  const author = await provisionAuthor(tx, setup.config, TEST_PASSWORD);
  return { ...setup, author };
}

function signIn(
  { handle, config }: TestAuth,
  credentials: { email?: string; password?: string } = {},
  headers?: Record<string, string>,
) {
  return handle(
    authRequest(config, "/sign-in/email", {
      body: {
        email: credentials.email ?? config.authorEmail,
        password: credentials.password ?? TEST_PASSWORD,
      },
      headers,
    }),
  );
}

async function signedInCookie(setup: TestAuth): Promise<string> {
  const response = await signIn(setup);
  expect(response.status).toBe(200);
  const cookie = sessionCookieFrom(response);
  expect(cookie).toBeDefined();
  return cookie as string;
}

function authorize({ auth, config }: TestAuth, cookie?: string) {
  return authorizeAuthorWith(auth, config, cookieHeaders(cookie));
}

async function rows(
  tx: Transaction,
  table:
    | typeof schema.authUsers
    | typeof schema.authSessions
    | typeof schema.authAccounts,
) {
  const [row] = await tx.select({ value: count() }).from(table);
  return row?.value ?? 0;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("identity constraints", () => {
  it("admits at most one account", async () => {
    await inRollbackTransaction(async (tx) => {
      await withAuthor(tx);
      await expectRejected(
        tx,
        {
          code: SqlState.uniqueViolation,
          constraint: "auth_users_single_author_idx",
        },
        (sp) =>
          sp.insert(schema.authUsers).values({
            name: "[Test] Second",
            email: "second@example.com",
          }),
      );
    });
  });

  it("stores emails in lowercase only", async () => {
    await inRollbackTransaction(async (tx) => {
      await expectRejected(
        tx,
        {
          code: SqlState.checkViolation,
          constraint: "auth_users_email_lowercase_check",
        },
        (sp) =>
          sp
            .insert(schema.authUsers)
            .values({ name: "[Test] Author", email: "Author@Example.com" }),
      );
    });
  });

  it("stores only password credentials, never social accounts", async () => {
    await inRollbackTransaction(async (tx) => {
      const { author } = await withAuthor(tx);
      for (const account of [
        { providerId: "github", accountId: "1", password: null },
        { providerId: "credential", accountId: author.userId, password: null },
      ]) {
        await expectRejected(
          tx,
          {
            code: SqlState.checkViolation,
            constraint: "auth_accounts_credential_only_check",
          },
          (sp) =>
            sp
              .insert(schema.authAccounts)
              .values({ ...account, userId: author.userId }),
        );
      }
    });
  });

  it("keeps one credential per provider account", async () => {
    await inRollbackTransaction(async (tx) => {
      const { author } = await withAuthor(tx);
      await expectRejected(
        tx,
        {
          code: SqlState.uniqueViolation,
          constraint: "auth_accounts_provider_account_unique",
        },
        (sp) =>
          sp.insert(schema.authAccounts).values({
            userId: author.userId,
            providerId: "credential",
            accountId: author.userId,
            password: "[test]-hash",
          }),
      );
    });
  });

  it("keeps one rate-limit counter per key", async () => {
    await inRollbackTransaction(async (tx) => {
      const counter = {
        key: "[test]|/sign-in/email",
        count: 1,
        lastRequest: 0,
      };
      await tx.insert(schema.authRateLimits).values(counter);
      await expectRejected(
        tx,
        {
          code: SqlState.uniqueViolation,
          constraint: "auth_rate_limits_key_unique",
        },
        (sp) => sp.insert(schema.authRateLimits).values(counter),
      );
    });
  });

  it("removes an account's sessions and credential with it, and nothing else", async () => {
    await inRollbackTransaction(async (tx) => {
      const setup = await withAuthor(tx);
      await signedInCookie(setup);
      await tx.insert(schema.authRateLimits).values({
        key: "[test]|/sign-in/email",
        count: 1,
        lastRequest: 0,
      });
      await tx.delete(schema.authUsers);
      expect(await rows(tx, schema.authSessions)).toBe(0);
      expect(await rows(tx, schema.authAccounts)).toBe(0);
      // Rate-limit counters are not owned by the account.
      const counters = await tx
        .select({ key: schema.authRateLimits.key })
        .from(schema.authRateLimits)
        .where(eq(schema.authRateLimits.key, "[test]|/sign-in/email"));
      expect(counters).toHaveLength(1);
    });
  });

  it("keeps session tokens unique", async () => {
    await inRollbackTransaction(async (tx) => {
      const { author } = await withAuthor(tx);
      const session = {
        userId: author.userId,
        token: "[test]-token",
        expiresAt: new Date(Date.now() + 60_000),
      };
      await tx.insert(schema.authSessions).values(session);
      await expectRejected(
        tx,
        {
          code: SqlState.uniqueViolation,
          constraint: "auth_sessions_token_unique",
        },
        (sp) => sp.insert(schema.authSessions).values(session),
      );
    });
  });
});

describe("provisioning", () => {
  it("creates one account with one hashed password credential", async () => {
    await inRollbackTransaction(async (tx) => {
      const { author } = await withAuthor(tx);

      const users = await tx.select().from(schema.authUsers);
      expect(users).toEqual([
        expect.objectContaining({
          id: author.userId,
          email: TEST_AUTHOR_EMAIL,
          emailVerified: false,
        }),
      ]);
      const accounts = await tx.select().from(schema.authAccounts);
      expect(accounts).toHaveLength(1);
      const [account] = accounts;
      expect(account).toMatchObject({
        userId: author.userId,
        providerId: "credential",
        accountId: author.userId,
      });
      // Better Auth's scrypt format, salt:key in hex. Never the password.
      expect(account?.password).toMatch(/^[0-9a-f]{32}:[0-9a-f]{128}$/);
      expect(account?.password).not.toContain(TEST_PASSWORD);
      expect(await rows(tx, schema.authSessions)).toBe(0);
    });
  });

  it("refuses to run again and never overwrites the password", async () => {
    await inRollbackTransaction(async (tx) => {
      const { config } = await withAuthor(tx);
      const [before] = await tx.select().from(schema.authAccounts);

      await expect(
        provisionAuthor(tx, config, "[Test] a different password entirely"),
      ).rejects.toMatchObject({ reason: "account_exists" });

      const after = await tx.select().from(schema.authAccounts);
      expect(after).toEqual([before]);
      expect(await rows(tx, schema.authUsers)).toBe(1);
    });
  });

  it("refuses unexpected identity state and writes nothing", async () => {
    await inRollbackTransaction(async (tx) => {
      await tx.insert(schema.authVerifications).values({
        identifier: "[test]",
        value: "[test]",
        expiresAt: new Date(Date.now() + 60_000),
      });
      await expect(
        provisionAuthor(tx, testAuthConfig(), TEST_PASSWORD),
      ).rejects.toMatchObject({ reason: "identity_state_not_empty" });
      expect(await rows(tx, schema.authUsers)).toBe(0);
    });
  });

  it.each([
    ["password_too_short", "[Test] short"],
    ["password_too_long", "x".repeat(129)],
    ["password_contains_email", `[Test] ${TEST_AUTHOR_EMAIL} is mine`],
  ])(
    "refuses a weak password (%s) and writes nothing",
    async (reason, password) => {
      await inRollbackTransaction(async (tx) => {
        await expect(
          provisionAuthor(tx, testAuthConfig(), password),
        ).rejects.toMatchObject({ reason });
        expect(await rows(tx, schema.authUsers)).toBe(0);
      });
    },
  );
});

describe("public sign-up", () => {
  it("is unavailable over HTTP, in the library, and on the server", async () => {
    await inRollbackTransaction(async (tx) => {
      const { auth, config, handle } = testAuth(tx);
      const body = {
        email: "someone@example.com",
        password: "[Test] a long enough password",
        name: "[Test] Someone",
      };

      // Through the application's handler: the same 404 as an unknown URL.
      const viaHandler = await handle(
        authRequest(config, "/sign-up/email", { body }),
      );
      expect(viaHandler.status).toBe(404);
      expect(await viaHandler.text()).toBe("");

      // Straight into Better Auth, bypassing the allow-list: disabledPaths.
      const viaLibrary = await auth.handler(
        authRequest(config, "/sign-up/email", { body }),
      );
      expect(viaLibrary.status).toBe(404);

      // A server-side call: disableSignUp.
      await expect(auth.api.signUpEmail({ body })).rejects.toMatchObject({
        statusCode: 400,
      });

      expect(await rows(tx, schema.authUsers)).toBe(0);
    });
  });

  it("stays unavailable after the author exists", async () => {
    await inRollbackTransaction(async (tx) => {
      const setup = await withAuthor(tx);
      const response = await setup.auth.handler(
        authRequest(setup.config, "/sign-up/email", {
          body: {
            email: "second@example.com",
            password: "[Test] a long enough password",
            name: "[Test] Second",
          },
        }),
      );
      expect(response.status).toBe(404);
      expect(await rows(tx, schema.authUsers)).toBe(1);
    });
  });
});

describe("sign-in", () => {
  it("signs the author in with a database session and a protected cookie", async () => {
    await inRollbackTransaction(async (tx) => {
      const setup = await withAuthor(tx);
      const response = await signIn(setup);

      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("no-store");
      const setCookie = response.headers
        .getSetCookie()
        .find((cookie) => cookie.startsWith("refrain.session_token="));
      expect(setCookie).toBeDefined();
      expect(setCookie).toMatch(/; HttpOnly/i);
      expect(setCookie).toMatch(/; SameSite=Strict/i);
      expect(setCookie).toMatch(/; Path=\//);
      expect(setCookie).toMatch(/; Max-Age=604800/);
      // http://localhost: the browser would refuse a Secure cookie.
      expect(setCookie).not.toMatch(/; Secure/i);

      const text = await response.text();
      expect(text).not.toContain(TEST_PASSWORD);
      expect(text).not.toContain("password");

      const sessions = await tx.select().from(schema.authSessions);
      expect(sessions).toHaveLength(1);
      expect(sessions[0]?.userId).toBe(setup.author.userId);
      // The token travels only in the HttpOnly cookie, never to scripts.
      expect(sessions[0]?.token).toBeTruthy();
      expect(text).not.toContain(sessions[0]?.token);
      expect(JSON.parse(text)).not.toHaveProperty("token");
    });
  });

  it("never returns the session token to scripts from get-session", async () => {
    await inRollbackTransaction(async (tx) => {
      const setup = await withAuthor(tx);
      const cookie = await signedInCookie(setup);
      const [session] = await tx.select().from(schema.authSessions);

      const response = await setup.handle(
        authRequest(setup.config, "/get-session", { method: "GET", cookie }),
      );
      expect(response.status).toBe(200);
      const text = await response.text();
      const body = JSON.parse(text) as {
        session: Record<string, unknown>;
        user: Record<string, unknown>;
      };
      expect(body.user.email).toBe(TEST_AUTHOR_EMAIL);
      expect(body.session).not.toHaveProperty("token");
      expect(session?.token).toBeTruthy();
      expect(text).not.toContain(session?.token);
    });
  });

  it("uses a __Secure- cookie with the Secure attribute over HTTPS", async () => {
    await inRollbackTransaction(async (tx) => {
      const setup = await withAuthor(
        tx,
        testAuthConfig({ baseURL: "https://refrain.example" }),
      );
      const response = await signIn(setup);
      expect(response.status).toBe(200);
      const setCookie = response.headers
        .getSetCookie()
        .find((cookie) => cookie.startsWith("__Secure-refrain.session_token="));
      expect(setCookie).toMatch(/; Secure/i);
      expect(setCookie).toMatch(/; HttpOnly/i);
      expect(setCookie).toMatch(/; SameSite=Strict/i);
    });
  });

  it("keeps every cookie Better Auth sets when the handler rewrites the response", async () => {
    await inRollbackTransaction(async (tx) => {
      const setup = await withAuthor(tx);
      const signIn = await setup.handle(
        authRequest(setup.config, "/sign-in/email", {
          body: {
            email: TEST_AUTHOR_EMAIL,
            password: TEST_PASSWORD,
            rememberMe: false,
          },
        }),
      );
      expect(signIn.status).toBe(200);
      const names = signIn.headers
        .getSetCookie()
        .map((cookie) => cookie.split("=", 1)[0]);
      expect(names).toEqual(
        expect.arrayContaining([
          "refrain.session_token",
          "refrain.dont_remember",
        ]),
      );
      const cookie = signIn.headers
        .getSetCookie()
        .map((c) => c.split(";", 1)[0])
        .join("; ");

      const signOut = await setup.handle(
        authRequest(setup.config, "/sign-out", { body: {}, cookie }),
      );
      const cleared = signOut.headers
        .getSetCookie()
        .filter((c) => /Max-Age=0/.test(c))
        .map((c) => c.split("=", 1)[0]);
      expect(cleared).toEqual(
        expect.arrayContaining([
          "refrain.session_token",
          "refrain.dont_remember",
        ]),
      );
    });
  });

  it.each([
    "https://attacker.example/studio",
    "//attacker.example",
    "/\\attacker.example",
  ])("refuses an untrusted callbackURL (%s)", async (callbackURL) => {
    await inRollbackTransaction(async (tx) => {
      const setup = await withAuthor(tx);
      const response = await setup.handle(
        authRequest(setup.config, "/sign-in/email", {
          body: {
            email: TEST_AUTHOR_EMAIL,
            password: TEST_PASSWORD,
            callbackURL,
          },
        }),
      );
      expect(response.status).toBe(403);
      expect(sessionCookieFrom(response)).toBeUndefined();
      expect(await rows(tx, schema.authSessions)).toBe(0);
    });
  });

  it("rejects a wrong password and an unknown email identically", async () => {
    await inRollbackTransaction(async (tx) => {
      const setup = await withAuthor(tx);
      const wrongPassword = await signIn(setup, {
        password: "[Test] not the password at all",
      });
      const unknownEmail = await signIn(setup, {
        email: "nobody@example.com",
      });

      for (const response of [wrongPassword, unknownEmail]) {
        expect(response.status).toBe(401);
        expect(sessionCookieFrom(response)).toBeUndefined();
      }
      expect(await wrongPassword.json()).toEqual(await unknownEmail.json());
      expect(await rows(tx, schema.authSessions)).toBe(0);
    });
  });
});

describe("authorization", () => {
  it("authorizes the author's session", async () => {
    await inRollbackTransaction(async (tx) => {
      const setup = await withAuthor(tx);
      const cookie = await signedInCookie(setup);
      const result = await authorize(setup, cookie);
      expect(result).toEqual({
        ok: true,
        author: { userId: setup.author.userId, sessionId: expect.any(String) },
      });
    });
  });

  it("keeps the session across a restart, and checking it never extends it", async () => {
    await inRollbackTransaction(async (tx) => {
      const setup = await withAuthor(tx);
      const cookie = await signedInCookie(setup);
      const [before] = await tx.select().from(schema.authSessions);
      expect(before?.expiresAt.getTime()).toBeGreaterThan(
        Date.now() + 7 * 24 * 3600_000 - 60_000,
      );

      // A new instance with the same configuration: a server restart.
      const restarted = testAuth(tx, setup.config);
      expect((await authorize(restarted, cookie)).ok).toBe(true);
      expect((await authorize(restarted, cookie)).ok).toBe(true);

      const [after] = await tx.select().from(schema.authSessions);
      expect(after?.expiresAt).toEqual(before?.expiresAt);
    });
  });

  it("refuses a session that is not the configured author's", async () => {
    await inRollbackTransaction(async (tx) => {
      // A valid account and session for someone else...
      const other = await withAuthor(
        tx,
        testAuthConfig({ authorEmail: "someone-else@example.com" }),
      );
      const cookie = await signedInCookie(other);
      expect((await authorize(other, cookie)).ok).toBe(true);

      // ...is not authorized where the author is configured differently.
      const studio = testAuth(tx, {
        ...other.config,
        authorEmail: TEST_AUTHOR_EMAIL,
      });
      expect(await authorize(studio, cookie)).toEqual({
        ok: false,
        reason: "not_author",
      });
    });
  });

  it("refuses an expired session", async () => {
    await inRollbackTransaction(async (tx) => {
      const setup = await withAuthor(tx);
      const cookie = await signedInCookie(setup);
      await tx
        .update(schema.authSessions)
        .set({ expiresAt: sql`now() - interval '1 minute'` });
      expect(await authorize(setup, cookie)).toEqual({
        ok: false,
        reason: "unauthenticated",
      });
    });
  });

  it("refuses a revoked session", async () => {
    await inRollbackTransaction(async (tx) => {
      const setup = await withAuthor(tx);
      const cookie = await signedInCookie(setup);
      await tx.delete(schema.authSessions);
      expect(await authorize(setup, cookie)).toEqual({
        ok: false,
        reason: "unauthenticated",
      });
    });
  });

  it("refuses requests without a session, and ignores identity headers", async () => {
    await inRollbackTransaction(async (tx) => {
      const setup = await withAuthor(tx);
      expect(await authorize(setup)).toEqual({
        ok: false,
        reason: "unauthenticated",
      });
      const claimed = new Headers({
        "x-user-id": setup.author.userId,
        "x-user-email": TEST_AUTHOR_EMAIL,
        authorization: `Bearer ${setup.author.userId}`,
      });
      expect(
        await authorizeAuthorWith(setup.auth, setup.config, claimed),
      ).toEqual({ ok: false, reason: "unauthenticated" });
    });
  });

  it("refuses forged and tampered cookies", async () => {
    await inRollbackTransaction(async (tx) => {
      const setup = await withAuthor(tx);
      const cookie = await signedInCookie(setup);
      const [name, value = ""] = cookie.split("=");
      const token = decodeURIComponent(value).split(".")[0] ?? "";

      const forged = [
        `${name}=forged.value`,
        `${name}=${token}`,
        `${name}=${encodeURIComponent(`${token}.${"A".repeat(43)}=`)}`,
        `better-auth.session_token=${value}`,
        `__Secure-refrain.session_token=${value}`,
      ];
      for (const candidate of forged) {
        expect(await authorize(setup, candidate)).toEqual({
          ok: false,
          reason: "unauthenticated",
        });
      }

      // The genuine cookie, checked by an instance with a different secret
      // (for example after the secret is rotated), is refused too.
      const rotated = testAuth(tx, {
        ...setup.config,
        secret: testAuthConfig().secret,
      });
      expect(await authorize(rotated, cookie)).toEqual({
        ok: false,
        reason: "unauthenticated",
      });
    });
  });
});

describe("sign-out", () => {
  it("deletes the session, so the cookie can never be used again", async () => {
    await inRollbackTransaction(async (tx) => {
      const setup = await withAuthor(tx);
      const cookie = await signedInCookie(setup);

      const response = await setup.handle(
        authRequest(setup.config, "/sign-out", { body: {}, cookie }),
      );
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(
        response.headers
          .getSetCookie()
          .find((c) => c.startsWith("refrain.session_token=")),
      ).toMatch(/Max-Age=0/);

      expect(await rows(tx, schema.authSessions)).toBe(0);
      expect(await authorize(setup, cookie)).toEqual({
        ok: false,
        reason: "unauthenticated",
      });
    });
  });
});

describe("password reset (local command)", () => {
  it("changes the password and signs out every session", async () => {
    await inRollbackTransaction(async (tx) => {
      const setup = await withAuthor(tx);
      const first = await signedInCookie(setup);
      const second = await signedInCookie(setup);
      const newPassword = "[Test] a brand new long passphrase";

      const change = await resetAuthorPassword(tx, setup.config, newPassword);
      expect(change).toEqual({
        userId: setup.author.userId,
        revokedSessions: 2,
      });

      for (const cookie of [first, second]) {
        expect((await authorize(setup, cookie)).ok).toBe(false);
      }
      expect((await signIn(setup)).status).toBe(401);
      expect((await signIn(setup, { password: newPassword })).status).toBe(200);
    });
  });

  it("refuses when the configured author has no account", async () => {
    await inRollbackTransaction(async (tx) => {
      await withAuthor(
        tx,
        testAuthConfig({ authorEmail: "other@example.com" }),
      );
      await expect(
        resetAuthorPassword(
          tx,
          testAuthConfig(),
          "[Test] a brand new passphrase",
        ),
      ).rejects.toMatchObject({ reason: "no_author_account" });
    });
  });
});

describe("endpoints", () => {
  it.each([
    ["POST", "/update-user"],
    ["POST", "/change-password"],
    ["POST", "/change-email"],
    ["POST", "/delete-user"],
    ["POST", "/request-password-reset"],
    ["POST", "/reset-password"],
    ["POST", "/revoke-sessions"],
    ["POST", "/revoke-other-sessions"],
    ["POST", "/link-social"],
    ["POST", "/unlink-account"],
    ["POST", "/sign-in/social"],
    ["POST", "/send-verification-email"],
    ["GET", "/list-sessions"],
    ["GET", "/list-accounts"],
    ["GET", "/verify-email"],
    ["GET", "/ok"],
    ["GET", "/error"],
    ["GET", "/sign-in/email"],
    ["POST", "/get-session"],
    ["POST", "/sign-in/email/"],
    ["POST", "//sign-in/email"],
    ["POST", "/sign-in%2Femail"],
    ["POST", "/SIGN-IN/EMAIL"],
  ])("answers %s %s with a bare 404", async (method, path) => {
    await inRollbackTransaction(async (tx) => {
      const setup = await withAuthor(tx);
      const cookie = await signedInCookie(setup);
      const response = await setup.handle(
        authRequest(setup.config, path, {
          method,
          cookie,
          body: method === "POST" ? {} : undefined,
        }),
      );
      expect(response.status).toBe(404);
      expect(await response.text()).toBe("");
    });
  });
});

describe("cross-origin requests", () => {
  it.each([
    ["no Origin header", null],
    ["another origin", "https://attacker.example"],
    ["the opaque origin", "null"],
    ["the same host on another scheme", "https://localhost:3000"],
  ])(
    "refuses a sign-in with %s and creates no session",
    async (_label, origin) => {
      await inRollbackTransaction(async (tx) => {
        const setup = await withAuthor(tx);
        const response = await setup.handle(
          authRequest(setup.config, "/sign-in/email", {
            origin,
            body: { email: TEST_AUTHOR_EMAIL, password: TEST_PASSWORD },
          }),
        );
        expect(response.status).toBe(403);
        expect(sessionCookieFrom(response)).toBeUndefined();
        expect(await rows(tx, schema.authSessions)).toBe(0);
      });
    },
  );

  it("refuses a cross-origin sign-out and keeps the session", async () => {
    await inRollbackTransaction(async (tx) => {
      const setup = await withAuthor(tx);
      const cookie = await signedInCookie(setup);
      const response = await setup.handle(
        authRequest(setup.config, "/sign-out", {
          origin: "https://attacker.example",
          cookie,
          body: {},
        }),
      );
      expect(response.status).toBe(403);
      expect((await authorize(setup, cookie)).ok).toBe(true);
    });
  });

  // Better Auth's own checks stay on under NODE_ENV=test, where the library
  // would otherwise skip them; the configuration sets them explicitly.
  it("is refused by Better Auth itself too, behind the handler", async () => {
    await inRollbackTransaction(async (tx) => {
      const setup = await withAuthor(tx);
      const cookie = await signedInCookie(setup);
      const withCookie = await setup.auth.handler(
        authRequest(setup.config, "/sign-out", {
          origin: "https://attacker.example",
          cookie,
          body: {},
        }),
      );
      expect(withCookie.status).toBe(403);

      const crossSiteForm = await setup.auth.handler(
        authRequest(setup.config, "/sign-in/email", {
          origin: "https://attacker.example",
          body: { email: TEST_AUTHOR_EMAIL, password: TEST_PASSWORD },
          headers: { "sec-fetch-site": "cross-site", "sec-fetch-mode": "cors" },
        }),
      );
      expect(crossSiteForm.status).toBe(403);
      expect(await rows(tx, schema.authSessions)).toBe(1);
    });
  });

  it("refuses an oversized body before parsing it", async () => {
    await inRollbackTransaction(async (tx) => {
      const setup = await withAuthor(tx);
      const response = await setup.handle(
        authRequest(setup.config, "/sign-in/email", {
          body: { email: TEST_AUTHOR_EMAIL, password: "x".repeat(5000) },
        }),
      );
      expect(response.status).toBe(413);
    });
  });
});

describe("sign-in rate limit", () => {
  it("allows five attempts a minute for all clients together", async () => {
    await inRollbackTransaction(async (tx) => {
      const setup = await withAuthor(tx);
      const statuses: number[] = [];
      for (let attempt = 1; attempt <= 6; attempt++) {
        // A different spoofed client address on every attempt: no header is
        // trusted, so none of them earns a fresh bucket.
        const response = await signIn(
          setup,
          { password: "[Test] guessing the password" },
          { "x-forwarded-for": `203.0.113.${attempt}` },
        );
        statuses.push(response.status);
      }
      expect(statuses).toEqual([401, 401, 401, 401, 401, 429]);

      // Even the right password is refused while the limit holds.
      expect((await signIn(setup)).status).toBe(429);
    });
  });

  it("never blocks signing out", async () => {
    await inRollbackTransaction(async (tx) => {
      const setup = await withAuthor(tx);
      const cookie = await signedInCookie(setup);
      for (let attempt = 0; attempt < 6; attempt++) {
        await signIn(setup, { password: "[Test] guessing the password" });
      }
      const response = await setup.handle(
        authRequest(setup.config, "/sign-out", { body: {}, cookie }),
      );
      expect(response.status).toBe(200);
      expect((await authorize(setup, cookie)).ok).toBe(false);
    });
  });
});

describe("failures fail closed and reveal nothing", () => {
  function capturedOutput(spies: ReturnType<typeof vi.spyOn>[]): string {
    return JSON.stringify(spies.flatMap((spy) => spy.mock.calls));
  }

  it("answers 503 when the configuration is missing, without details", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const handle = createAuthRequestHandler(() => {
      throw new AuthConfigError("BETTER_AUTH_SECRET is not set.");
    });
    const config = testAuthConfig();
    const response = await handle(
      authRequest(config, "/sign-in/email", {
        body: { email: TEST_AUTHOR_EMAIL, password: TEST_PASSWORD },
      }),
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ code: "AUTH_UNAVAILABLE" });
    expect(capturedOutput([error])).not.toContain(TEST_PASSWORD);
  });

  it("does not authorize anyone when the application is not configured", async () => {
    const variables = [
      "BETTER_AUTH_SECRET",
      "BETTER_AUTH_URL",
      "REFRAIN_AUTHOR_EMAIL",
    ] as const;
    const saved = Object.fromEntries(variables.map((v) => [v, process.env[v]]));
    const cache = globalThis as { refrainAuth?: unknown };
    const savedCache = cache.refrainAuth;
    vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      for (const variable of variables) {
        delete process.env[variable];
      }
      cache.refrainAuth = undefined;
      expect(
        await authorizeAuthor(
          new Headers({ cookie: "refrain.session_token=x" }),
        ),
      ).toEqual({ ok: false, reason: "unavailable" });
    } finally {
      for (const variable of variables) {
        if (saved[variable] === undefined) {
          delete process.env[variable];
        } else {
          process.env[variable] = saved[variable];
        }
      }
      cache.refrainAuth = savedCache;
    }
  });

  it("logs no token, hash, or query parameters when the database fails", async () => {
    await inRollbackTransaction(async (tx) => {
      const setup = await withAuthor(tx);
      const cookie = await signedInCookie(setup);
      const [session] = await tx.select().from(schema.authSessions);
      const [account] = await tx
        .select()
        .from(schema.authAccounts)
        .where(eq(schema.authAccounts.userId, setup.author.userId));
      const spies = [
        vi.spyOn(console, "error").mockImplementation(() => {}),
        vi.spyOn(console, "warn").mockImplementation(() => {}),
        vi.spyOn(console, "info").mockImplementation(() => {}),
        vi.spyOn(console, "log").mockImplementation(() => {}),
      ];

      // In a savepoint, make every session query fail. A failed Drizzle
      // query carries its parameters (here, the session token) in its message.
      await tx
        .transaction(async (sp) => {
          await sp.execute(
            sql`alter table auth_sessions rename to auth_sessions_unavailable`,
          );
          const broken = testAuth(sp, setup.config);

          expect(await authorize(broken, cookie)).toEqual({
            ok: false,
            reason: "unavailable",
          });

          const response = await broken.handle(
            authRequest(setup.config, "/get-session", {
              method: "GET",
              cookie,
            }),
          );
          expect(response.status).toBeGreaterThanOrEqual(500);
          const body = await response.text();
          for (const secret of [
            session?.token,
            "auth_sessions",
            "select",
            "    at ",
          ]) {
            expect(body).not.toContain(secret);
          }
          throw new Error("roll back the savepoint");
        })
        .catch((error: unknown) => {
          if (
            !(error instanceof Error) ||
            error.message !== "roll back the savepoint"
          ) {
            throw error;
          }
        });

      const output = capturedOutput(spies);
      expect(output.length).toBeGreaterThan(0);
      for (const secret of [
        session?.token,
        account?.password,
        setup.config.secret,
        TEST_PASSWORD,
        "params",
      ]) {
        expect(secret).toBeDefined();
        expect(output).not.toContain(secret);
      }
    });
  });
});
