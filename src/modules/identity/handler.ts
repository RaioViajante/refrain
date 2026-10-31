import "server-only";

import { AUTH_BASE_PATH, getConfiguredAuth, type Auth } from "./auth";
import { reportUnavailable } from "./authorization";
import type { AuthConfig } from "./config";
import { logAuthApiError } from "./logging";

// The HTTP boundary of Better Auth (src/app/api/auth/[...all]/route.ts).
//
// Better Auth registers many endpoints: sign-up, password reset, account
// linking, user updates, session listing. Refrain needs three. Every other
// path, method, or spelling gets the same bare 404 as an unknown URL, so
// endpoints that are disabled by configuration are also unreachable by route.

/** `METHOD path` pairs that are passed to Better Auth. Nothing else is. */
export const AUTH_ENDPOINTS: ReadonlySet<string> = new Set([
  `POST ${AUTH_BASE_PATH}/sign-in/email`,
  `POST ${AUTH_BASE_PATH}/sign-out`,
  `GET ${AUTH_BASE_PATH}/get-session`,
]);

/** Larger request bodies are refused before they are parsed. */
export const MAX_AUTH_BODY_BYTES = 4096;

interface ConfiguredAuth {
  auth: Auth;
  config: AuthConfig;
}

function jsonResponse(status: number, code: string): Response {
  return new Response(JSON.stringify({ code }), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

function notFound(): Response {
  return new Response(null, {
    status: 404,
    headers: { "Cache-Control": "no-store" },
  });
}

// Reads at most `limit` bytes. Returns null when the body is larger, whether
// or not it declared its length.
async function readLimitedBody(
  request: Request,
  limit: number,
): Promise<Uint8Array<ArrayBuffer> | null> {
  const declared = request.headers.get("content-length");
  if (declared !== null && !(Number(declared) <= limit)) {
    return null;
  }
  if (!request.body) {
    return new Uint8Array();
  }
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

// Authentication state must never be stored by a browser or shared cache.
function withNoStore(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", "no-store");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/**
 * Creates the authentication request handler. `resolve` supplies the
 * configured Better Auth instance; tests pass one bound to their transaction.
 */
export function createAuthRequestHandler(resolve: () => ConfiguredAuth) {
  return async function handleAuthRequest(request: Request): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (!AUTH_ENDPOINTS.has(`${request.method} ${pathname}`)) {
      return notFound();
    }

    let configured: ConfiguredAuth;
    try {
      configured = resolve();
    } catch (error) {
      reportUnavailable(error);
      return jsonResponse(503, "AUTH_UNAVAILABLE");
    }

    let forwarded = request;
    if (request.method === "POST") {
      // Every state-changing request must come from the application's own
      // pages. Browsers always send Origin on a POST; a request without it,
      // or from any other origin, is refused before Better Auth sees it.
      if (request.headers.get("origin") !== configured.config.baseURL) {
        return jsonResponse(403, "INVALID_ORIGIN");
      }
      const body = await readLimitedBody(request, MAX_AUTH_BODY_BYTES);
      if (body === null) {
        return jsonResponse(413, "PAYLOAD_TOO_LARGE");
      }
      forwarded = new Request(request.url, {
        method: request.method,
        headers: request.headers,
        body,
      });
    }

    try {
      return withNoStore(await configured.auth.handler(forwarded));
    } catch (error) {
      logAuthApiError(error);
      return jsonResponse(500, "AUTH_FAILED");
    }
  };
}

/** The application's handler for /api/auth/*. */
export const handleAuthRequest = createAuthRequestHandler(getConfiguredAuth);
