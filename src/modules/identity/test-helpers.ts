// Test support for the Identity module. Imported only by tests in this
// directory; synthetic credentials only, never real ones.
import { randomBytes } from "node:crypto";

import type { DatabaseExecutor } from "@/db";

import { createAuth } from "./auth";
import type { AuthConfig } from "./config";
import { createAuthRequestHandler } from "./handler";

export const TEST_AUTHOR_EMAIL = "author@example.com";
export const TEST_PASSWORD = "[Test] correct horse battery staple";

/** A fresh configuration with its own random secret. */
export function testAuthConfig(
  overrides: Partial<AuthConfig> = {},
): AuthConfig {
  return {
    secret: randomBytes(32).toString("base64"),
    baseURL: "http://localhost:3000",
    authorEmail: TEST_AUTHOR_EMAIL,
    ...overrides,
  };
}

/** A Better Auth instance and HTTP handler bound to `database`. */
export function testAuth(
  database: DatabaseExecutor,
  config: AuthConfig = testAuthConfig(),
) {
  const auth = createAuth(database, config);
  return {
    auth,
    config,
    handle: createAuthRequestHandler(() => ({ auth, config })),
  };
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  cookie?: string;
  /** `null` omits the header. Defaults to the configured origin. */
  origin?: string | null;
  headers?: Record<string, string>;
}

/** A request to `${baseURL}/api/auth${path}`, as a browser on the site sends it. */
export function authRequest(
  config: AuthConfig,
  path: string,
  options: RequestOptions = {},
): Request {
  const headers = new Headers(options.headers);
  const origin = options.origin === undefined ? config.baseURL : options.origin;
  if (origin !== null) {
    headers.set("origin", origin);
  }
  if (options.cookie) {
    headers.set("cookie", options.cookie);
  }
  let body: string | undefined;
  if (options.body !== undefined) {
    headers.set("content-type", "application/json");
    body = JSON.stringify(options.body);
  }
  return new Request(`${config.baseURL}/api/auth${path}`, {
    method: options.method ?? "POST",
    headers,
    body,
  });
}

/** The `name=value` of the session cookie set by `response`, if any. */
export function sessionCookieFrom(response: Response): string | undefined {
  const setCookie = response.headers
    .getSetCookie()
    .find((cookie) => /^(__Secure-)?refrain\.session_token=[^;]+/.test(cookie));
  return setCookie?.split(";", 1)[0];
}

/** Headers carrying only `cookie`, as a server component receives them. */
export function cookieHeaders(cookie: string | undefined): Headers {
  return new Headers(cookie ? { cookie } : {});
}
