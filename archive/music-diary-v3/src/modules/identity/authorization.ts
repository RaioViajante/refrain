import "server-only";

import { getConfiguredAuth, type Auth } from "./auth";
import { AuthConfigError, type AuthConfig } from "./config";
import { logAuthApiError } from "./logging";

// The single authorization boundary for the Writing Studio. Every studio page,
// server action, and route handler calls `authorizeAuthor` or `requireAuthor`
// itself, before doing anything else (docs/security.md § Authorization
// contract). A proxy or layout check is never the control.

declare const authorizedAuthorBrand: unique symbol;

/**
 * Proof that the current request belongs to the configured author. Only this
 * module creates it, so a domain command that takes an `AuthorizedAuthor`
 * cannot be called with an identity taken from the client.
 */
export interface AuthorizedAuthor {
  readonly userId: string;
  readonly sessionId: string;
  readonly [authorizedAuthorBrand]: true;
}

/**
 * Why a request is not authorized:
 * - `unauthenticated`: no session, or a session that is invalid, expired,
 *   revoked, or forged;
 * - `not_author`: a valid session of an account that is not the configured
 *   author;
 * - `unavailable`: the configuration or the database failed, so nothing can
 *   be verified. Fails closed, like the others.
 */
export type AuthorizationFailure =
  "unauthenticated" | "not_author" | "unavailable";

export type AuthorizationResult =
  | { ok: true; author: AuthorizedAuthor }
  | { ok: false; reason: AuthorizationFailure };

export class AuthorizationError extends Error {
  override name = "AuthorizationError";

  constructor(readonly reason: AuthorizationFailure) {
    super("The request is not authorized for the Writing Studio.");
  }
}

/**
 * Authorizes a request with a given Better Auth instance and configuration.
 * The session is read from PostgreSQL on every call (no cookie cache), and
 * nothing the client sends other than the signed session cookie is used.
 */
export async function authorizeAuthorWith(
  auth: Auth,
  config: AuthConfig,
  requestHeaders: Headers,
): Promise<AuthorizationResult> {
  let current: Awaited<ReturnType<Auth["api"]["getSession"]>>;
  try {
    current = await auth.api.getSession({
      headers: requestHeaders,
      query: { disableCookieCache: true, disableRefresh: true },
    });
  } catch (error) {
    logAuthApiError(error);
    return { ok: false, reason: "unavailable" };
  }

  if (!current || current.session.expiresAt.getTime() <= Date.now()) {
    return { ok: false, reason: "unauthenticated" };
  }
  const { session, user } = current;
  if (
    session.userId !== user.id ||
    user.email.toLowerCase() !== config.authorEmail
  ) {
    return { ok: false, reason: "not_author" };
  }

  return {
    ok: true,
    author: { userId: user.id, sessionId: session.id } as AuthorizedAuthor,
  };
}

/** Authorizes a request against the application's configured author. */
export async function authorizeAuthor(
  requestHeaders: Headers,
): Promise<AuthorizationResult> {
  let configured: ReturnType<typeof getConfiguredAuth>;
  try {
    configured = getConfiguredAuth();
  } catch (error) {
    reportUnavailable(error);
    return { ok: false, reason: "unavailable" };
  }
  return authorizeAuthorWith(
    configured.auth,
    configured.config,
    requestHeaders,
  );
}

/**
 * Returns the authorized author, or throws AuthorizationError. The first call
 * in every administrative server action and route handler.
 */
export async function requireAuthor(
  requestHeaders: Headers,
): Promise<AuthorizedAuthor> {
  const result = await authorizeAuthor(requestHeaders);
  if (!result.ok) {
    throw new AuthorizationError(result.reason);
  }
  return result.author;
}

/**
 * Whether a state-changing request names the application's own origin, exactly
 * as the authentication handler requires for its POSTs. Browsers always send
 * `Origin` on a cross-origin POST; a request without it, or from another
 * origin, is not trusted. Server Actions call this after authorizing, because
 * Next.js itself accepts an action call that has no `Origin` header. Fails
 * closed when the configuration cannot be read.
 */
export function hasTrustedOrigin(requestHeaders: Headers): boolean {
  try {
    return requestHeaders.get("origin") === getConfiguredAuth().config.baseURL;
  } catch (error) {
    reportUnavailable(error);
    return false;
  }
}

export function reportUnavailable(error: unknown): void {
  if (error instanceof AuthConfigError) {
    // The message names the variable, never its value.
    console.error("Authentication is not configured", {
      reason: error.message,
    });
  } else {
    logAuthApiError(error);
  }
}
