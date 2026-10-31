import "server-only";

import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";

import { getDb, schema, type DatabaseExecutor } from "@/db";

import { readAuthConfig, usesSecureCookies, type AuthConfig } from "./config";
import { logAuthApiError, logAuthMessage } from "./logging";

/** The path the Better Auth handler is mounted on (src/app/api/auth). */
export const AUTH_BASE_PATH = "/api/auth";

/** Session lifetime. Sessions are not extended by use (see below). */
export const SESSION_LIFETIME_SECONDS = 7 * 24 * 60 * 60;

/** Sign-in attempts allowed per window, across all clients (see below). */
export const SIGN_IN_RATE_LIMIT = { window: 60, max: 5 } as const;

export const MIN_PASSWORD_LENGTH = 15;
export const MAX_PASSWORD_LENGTH = 128;

/**
 * Builds the Better Auth instance on a database or a transaction. Every
 * security-relevant option is set explicitly, so that the library's
 * environment-dependent defaults (for example, origin checks are skipped when
 * NODE_ENV is `test`) never apply. ADR 0004 records the reasons.
 */
export function createAuth(database: DatabaseExecutor, config: AuthConfig) {
  return betterAuth({
    appName: "refrain",
    baseURL: config.baseURL,
    basePath: AUTH_BASE_PATH,
    secret: config.secret,
    trustedOrigins: [config.baseURL],

    database: drizzleAdapter(database, {
      provider: "pg",
      schema: {
        user: schema.authUsers,
        session: schema.authSessions,
        account: schema.authAccounts,
        verification: schema.authVerifications,
        rateLimit: schema.authRateLimits,
      },
    }),

    emailAndPassword: {
      enabled: true,
      // No public registration, ever. The single account is created by the
      // local provisioning command (src/modules/identity/cli.ts).
      disableSignUp: true,
      autoSignIn: false,
      requireEmailVerification: false,
      minPasswordLength: MIN_PASSWORD_LENGTH,
      maxPasswordLength: MAX_PASSWORD_LENGTH,
    },
    // Library-level refusal as well as the handler's allow-list.
    disabledPaths: ["/sign-up/email"],
    user: {
      changeEmail: { enabled: false },
      deleteUser: { enabled: false },
    },
    account: { accountLinking: { enabled: false } },

    session: {
      expiresIn: SESSION_LIFETIME_SECONDS,
      // Sessions end at a fixed time after sign-in; checking a session never
      // extends it or writes to the database.
      disableSessionRefresh: true,
      // Every check reads the session from PostgreSQL, so a revoked session
      // stops working at once instead of when a cookie cache expires.
      cookieCache: { enabled: false },
    },

    rateLimit: {
      enabled: true,
      storage: "database",
      window: 60,
      max: 100,
      customRules: {
        "/sign-in/email": SIGN_IN_RATE_LIMIT,
        // Signing out must always work, even while sign-in is throttled.
        "/sign-out": false,
      },
    },

    advanced: {
      cookiePrefix: "refrain",
      useSecureCookies: usesSecureCookies(config),
      defaultCookieAttributes: { httpOnly: true, sameSite: "strict" },
      disableCSRFCheck: false,
      disableOriginCheck: false,
      database: { generateId: "uuid" },
      // No proxy is trusted yet, so no request header names the client: a
      // client could set any X-Forwarded-For value and get a fresh rate-limit
      // bucket for each. With no trusted header, Better Auth keys every
      // client into one bucket per path, so the sign-in limit holds for all
      // clients together. A deployment behind a known proxy configures the
      // header and the proxy addresses here (docs/security.md).
      ipAddress: { ipAddressHeaders: [] },
    },

    telemetry: { enabled: false },
    logger: { level: "warn", log: logAuthMessage },
    onAPIError: { throw: false, onError: logAuthApiError },
  });
}

export type Auth = ReturnType<typeof createAuth>;

interface ConfiguredAuth {
  auth: Auth;
  config: AuthConfig;
}

const globalForAuth = globalThis as typeof globalThis & {
  refrainAuth?: ConfiguredAuth;
};

/**
 * The application's Better Auth instance and its configuration, created on
 * first use. The configuration is validated first, so a missing or unsafe
 * value fails the request instead of starting with defaults, and
 * `next build` needs no secret.
 */
export function getConfiguredAuth(): ConfiguredAuth {
  if (!globalForAuth.refrainAuth) {
    const config = readAuthConfig(process.env);
    globalForAuth.refrainAuth = { auth: createAuth(getDb(), config), config };
  }
  return globalForAuth.refrainAuth;
}
