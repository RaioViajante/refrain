// Authentication configuration, read from the environment and validated
// before any authentication request is served (docs/security.md).
//
// Pure function with no `server-only` guard, because the local provisioning
// command uses it outside the Next.js runtime. Error messages never contain a
// configured value: the secret must never reach a log or a response.
import { z } from "zod";

/** Thrown when the authentication configuration is missing or unsafe. */
export class AuthConfigError extends Error {
  override name = "AuthConfigError";
}

export interface AuthConfig {
  /** Signs session cookies. At least 32 characters of random data. */
  secret: string;
  /** The application's origin, for example `https://refrain.example`. */
  baseURL: string;
  /** The single author's email address, lowercase. */
  authorEmail: string;
}

type Env = Readonly<Record<string, string | undefined>>;

export const MIN_SECRET_LENGTH = 32;

// Better Auth also reads these variables by itself. Each would silently
// replace the secret, widen the trusted origins, or send telemetry, so a
// configuration that sets them is refused rather than partly honored.
const IMPLICIT_BETTER_AUTH_VARIABLES = [
  "BETTER_AUTH_SECRETS",
  "BETTER_AUTH_TRUSTED_ORIGINS",
  "BETTER_AUTH_TELEMETRY",
] as const;

// Plain HTTP is accepted only for a server on this machine. Anything reachable
// from elsewhere must use HTTPS, which also makes the cookies `Secure`.
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

const emailSchema = z.email();

function required(env: Env, variable: string): string {
  const value = env[variable]?.trim();
  if (!value) {
    throw new AuthConfigError(
      `${variable} is not set. See .env.example and docs/development.md § Authentication.`,
    );
  }
  return value;
}

function readSecret(env: Env): string {
  const secret = required(env, "BETTER_AUTH_SECRET");
  // A rough entropy floor: a generated secret (base64 or hex) passes easily,
  // while a repeated word or a short phrase does not.
  if (secret.length < MIN_SECRET_LENGTH || new Set(secret).size < 12) {
    throw new AuthConfigError(
      `BETTER_AUTH_SECRET must be at least ${MIN_SECRET_LENGTH} characters of random data. ` +
        "Generate one with `openssl rand -base64 32`.",
    );
  }
  return secret;
}

function readBaseURL(env: Env): string {
  const value = required(env, "BETTER_AUTH_URL");
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new AuthConfigError("BETTER_AUTH_URL is not a valid URL.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new AuthConfigError("BETTER_AUTH_URL must use https:// or http://.");
  }
  if (url.protocol === "http:" && !LOOPBACK_HOSTS.has(url.hostname)) {
    throw new AuthConfigError(
      "BETTER_AUTH_URL must use https:// unless it points to this machine (localhost).",
    );
  }
  if (
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new AuthConfigError(
      "BETTER_AUTH_URL must be an origin only, such as https://refrain.example, with no path, query, or credentials.",
    );
  }
  return url.origin;
}

function readAuthorEmail(env: Env): string {
  const email = required(env, "REFRAIN_AUTHOR_EMAIL").toLowerCase();
  if (!emailSchema.safeParse(email).success) {
    throw new AuthConfigError(
      "REFRAIN_AUTHOR_EMAIL is not a valid email address.",
    );
  }
  return email;
}

/**
 * Returns the validated authentication configuration. Throws AuthConfigError
 * when anything is missing or unsafe; there are no defaults to fall back to.
 */
export function readAuthConfig(env: Env = process.env): AuthConfig {
  for (const variable of IMPLICIT_BETTER_AUTH_VARIABLES) {
    if (env[variable] !== undefined) {
      throw new AuthConfigError(
        `${variable} is set. Refrain configures Better Auth explicitly; unset it.`,
      );
    }
  }
  return {
    secret: readSecret(env),
    baseURL: readBaseURL(env),
    authorEmail: readAuthorEmail(env),
  };
}

/** Whether the session cookies must carry the `Secure` attribute. */
export function usesSecureCookies(config: AuthConfig): boolean {
  return config.baseURL.startsWith("https://");
}
