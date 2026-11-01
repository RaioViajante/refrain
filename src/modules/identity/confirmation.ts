import "server-only";

import { createHmac, hkdfSync, timingSafeEqual } from "node:crypto";

import { z } from "zod";

import { locales, type Locale } from "@/db";

import { reportUnavailable, type AuthorizedAuthor } from "./authorization";
import { readAuthConfig } from "./config";

// Confirmation tokens (ADR 0006 § 3). A token is authenticated evidence that
// this server computed a disclosure for this authorized author's session, for
// one operation, within a bounded time. It is NOT proof that the author read
// or acknowledged anything: that is an interface act, ensured by procedure
// (ADR 0006 § 3 and § 9), and nothing here may be described otherwise.
//
// Format: `ct1.` + base64url(JSON claims) + `.` + base64url(HMAC-SHA-256 of
// everything before the last dot). The key is derived by HKDF-SHA-256 from the
// application secret with a fixed purpose string, so it is independent of the
// raw secret and of the key Better Auth derives for session cookies. Node's
// built-in `crypto` only; no dependency.
//
// Nothing here logs. A token, the key, and the secret never leave this file
// except the token itself, to the caller that asked for it.

/** The token version. A new version is added beside this one, never silently accepted. */
const TOKEN_PREFIX = "ct1";

/**
 * The HKDF `info` string. Fixed in code: a new use of the secret gets a new
 * string and its own test, and a string is never reused (ADR 0006 § 3).
 */
const KEY_INFO = "refrain/confirmation-token/ct1";

/** How long a token is valid: a constant, not configurable (ADR 0006, D2). */
export const CONFIRMATION_VALIDITY_MS = 15 * 60 * 1000;

/** The longest token the form check accepts (ADR 0006 § 3, step 1). */
export const MAX_CONFIRMATION_TOKEN_LENGTH = 1024;

/** What a token authorizes. A token is accepted only for the purpose it names. */
export type ConfirmationPurpose = "publish" | "change_public";

const MAC_BYTES = 32;
const KEY_BYTES = 32;
const FINGERPRINT_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;

const claimsSchema = z.strictObject({
  /** purpose */
  p: z.enum(["publish", "change_public"]),
  /** the authorized author's user id */
  u: z.string().min(1).max(128),
  /** the authorized author's session id */
  s: z.string().min(1).max(128),
  /** entry id */
  e: z.string().min(1).max(64),
  /** locale, for a `publish` token only */
  l: z.enum(locales).optional(),
  /** entries.version */
  n: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  /** the state fingerprint (base64url SHA-256) */
  f: z.string().regex(FINGERPRINT_PATTERN),
  /** issued at, in milliseconds since the epoch, by the database clock */
  i: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  /** expires at, in milliseconds since the epoch, by the database clock */
  x: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
});

type Claims = z.infer<typeof claimsSchema>;

/**
 * Derives the 32-byte confirmation key from the application secret: HKDF
 * (RFC 5869) with SHA-256, no salt (the RFC's zero-filled default; the input
 * is a random secret, so a salt adds nothing), and the fixed `info` string.
 */
function deriveKey(secret: string): Buffer {
  return Buffer.from(
    hkdfSync(
      "sha256",
      Buffer.from(secret, "utf8"),
      Buffer.alloc(0),
      KEY_INFO,
      KEY_BYTES,
    ),
  );
}

function mac(key: Buffer, signed: string): Buffer {
  return createHmac("sha256", key).update(signed, "utf8").digest();
}

// Strict base64url: only the URL-safe alphabet, no padding, and the canonical
// encoding of what it decodes to, so one byte string has one spelling.
function decodeBase64url(text: string): Buffer | null {
  if (!BASE64URL_PATTERN.test(text)) {
    return null;
  }
  const bytes = Buffer.from(text, "base64url");
  return bytes.toString("base64url") === text ? bytes : null;
}

/** What the caller asks a token to be bound to. */
export interface ConfirmationBinding {
  purpose: ConfirmationPurpose;
  entryId: string;
  /** Required for `publish`; a `change_public` token has no locale. */
  locale?: Locale;
  /** `entries.version` the request was made against. */
  entryVersion: number;
}

export interface ConfirmationIssue extends ConfirmationBinding {
  /** The state fingerprint of the disclosure the token vouches for. */
  fingerprint: string;
  /** The database clock when the disclosure was computed, in milliseconds. */
  issuedAtMs: number;
}

export type SignResult =
  { ok: true; token: string } | { ok: false; reason: "unavailable" };

/** The authenticated, bound parts of a token that the caller still has to check. */
export interface VerifiedConfirmation {
  fingerprint: string;
  issuedAtMs: number;
  expiresAtMs: number;
}

export type VerifyResult =
  | { ok: true; claims: VerifiedConfirmation }
  | { ok: false; reason: "unavailable" | "invalid" };

// The application secret, read the way every studio request reads it: the
// configuration is validated first, so a missing, short, or unsafe secret
// fails closed instead of falling back to anything.
function configuredSecret(): string | null {
  try {
    return readAuthConfig(process.env).secret;
  } catch (error) {
    reportUnavailable(error);
    return null;
  }
}

/**
 * Whether tokens can be issued and verified: the authentication
 * configuration is valid. A caller that handles a request without a token
 * still fails closed when it is not (ADR 0006 § 4, step 2).
 */
export function confirmationAvailable(): boolean {
  return configuredSecret() !== null;
}

/**
 * Signs a token for the authorized author's session. Only the Publication
 * module's two preview operations call this (ADR 0006 § 9); a static test
 * enforces it. The claims are the author's `userId` and `sessionId`, the
 * purpose, the entry, the locale (publish only), the entry version, the state
 * fingerprint, and the issue and expiry times, which are 15 minutes apart.
 * Nothing else is in the token: no private writing.
 */
export function signConfirmation(
  author: AuthorizedAuthor,
  issue: ConfirmationIssue,
): SignResult {
  const secret = configuredSecret();
  return secret === null
    ? { ok: false, reason: "unavailable" }
    : signConfirmationWith(secret, author, issue);
}

/** `signConfirmation` with an explicit secret, for tests of this module. */
export function signConfirmationWith(
  secret: string,
  author: AuthorizedAuthor,
  issue: ConfirmationIssue,
): SignResult {
  const claims: Claims = {
    p: issue.purpose,
    u: author.userId,
    s: author.sessionId,
    e: issue.entryId,
    ...(issue.purpose === "publish" ? { l: issue.locale } : {}),
    n: issue.entryVersion,
    f: issue.fingerprint,
    i: issue.issuedAtMs,
    x: issue.issuedAtMs + CONFIRMATION_VALIDITY_MS,
  };
  // The same schema that verification applies, so a token this module cannot
  // verify is never issued (for example a purpose without its locale).
  const checked = claimsSchema.safeParse(claims);
  if (
    !checked.success ||
    (claims.p === "publish") !== (claims.l !== undefined)
  ) {
    throw new TypeError("A confirmation token needs well-formed claims.");
  }
  const signed = `${TOKEN_PREFIX}.${Buffer.from(JSON.stringify(claims), "utf8").toString("base64url")}`;
  const key = deriveKey(secret);
  return {
    ok: true,
    token: `${signed}.${mac(key, signed).toString("base64url")}`,
  };
}

/**
 * Verifies a token's authenticity and its binding to this request
 * (ADR 0006 § 3, steps 2 and 3): the key is available, the MAC is valid
 * (compared in constant time), the version is `ct1`, the purpose is the
 * operation being called, `u` and `s` equal the current author, and the
 * entry, entry version, and (for `publish`) locale equal the request's.
 *
 * It does not check the expiry or the fingerprint: those need the database
 * clock and the locked rows, and the caller makes them under the entry lock.
 * Every failure is `invalid` and says nothing about which check failed.
 */
export function verifyConfirmation(
  author: AuthorizedAuthor,
  token: string,
  binding: ConfirmationBinding,
): VerifyResult {
  const secret = configuredSecret();
  return secret === null
    ? { ok: false, reason: "unavailable" }
    : verifyConfirmationWith(secret, author, token, binding);
}

/** `verifyConfirmation` with an explicit secret, for tests of this module. */
export function verifyConfirmationWith(
  secret: string,
  author: AuthorizedAuthor,
  token: string,
  binding: ConfirmationBinding,
): VerifyResult {
  const invalid = { ok: false, reason: "invalid" } as const;
  if (token.length > MAX_CONFIRMATION_TOKEN_LENGTH) {
    return invalid;
  }
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== TOKEN_PREFIX) {
    return invalid;
  }
  const [, payload, tag] = parts as [string, string, string];
  const presented = decodeBase64url(tag);
  if (presented === null || presented.length !== MAC_BYTES) {
    return invalid;
  }

  // Authenticate before parsing anything: an unauthenticated payload is never
  // interpreted.
  const expected = mac(deriveKey(secret), `${TOKEN_PREFIX}.${payload}`);
  if (!timingSafeEqual(expected, presented)) {
    return invalid;
  }

  const json = decodeBase64url(payload);
  if (json === null) {
    return invalid;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(json.toString("utf8"));
  } catch {
    return invalid;
  }
  const checked = claimsSchema.safeParse(parsed);
  if (!checked.success) {
    return invalid;
  }
  const claims = checked.data;

  const bound =
    claims.p === binding.purpose &&
    claims.u === author.userId &&
    claims.s === author.sessionId &&
    claims.e === binding.entryId &&
    claims.n === binding.entryVersion &&
    // A `publish` token names its locale and a `change_public` token has none.
    (binding.purpose === "publish"
      ? claims.l !== undefined && claims.l === binding.locale
      : claims.l === undefined) &&
    // The validity is a constant: a token that claims any other lifetime was
    // not issued by this code.
    claims.x - claims.i === CONFIRMATION_VALIDITY_MS;
  if (!bound) {
    return invalid;
  }
  return {
    ok: true,
    claims: {
      fingerprint: claims.f,
      issuedAtMs: claims.i,
      expiresAtMs: claims.x,
    },
  };
}

/**
 * Whether `nowMs`, read from the database clock after the entry lock was
 * granted, falls inside the token's validity: `issued <= now < expires`
 * (ADR 0006 § 3, step 4). A token issued in the future is not current either.
 */
export function confirmationIsCurrent(
  claims: VerifiedConfirmation,
  nowMs: number,
): boolean {
  return claims.issuedAtMs <= nowMs && nowMs < claims.expiresAtMs;
}
