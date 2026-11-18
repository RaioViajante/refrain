import { createHmac } from "node:crypto";

import type { AuthorizedAuthor } from "@/modules/identity";

// Test support for confirmation tokens (ADR 0006 § 13, test 1). This is an
// INDEPENDENT implementation of the token format, written from the ADR and
// RFC 5869 and sharing no code with the Identity module, so a test that
// compares the two checks the specification and not the module against
// itself. It can mint tokens with chosen timestamps, keys, and claims, which
// the production code deliberately cannot. Imported only by tests: a static
// test requires that no production file imports `@/testing`.

export const TEST_KEY_INFO = "refrain/confirmation-token/ct1";
export const FIFTEEN_MINUTES_MS = 15 * 60 * 1000;

/** HKDF-SHA-256 (RFC 5869), no salt, one output block (at most 32 bytes). */
export function hkdfSha256(secret: string, info: string, length = 32): Buffer {
  if (length > 32) {
    throw new RangeError("One block only.");
  }
  const pseudoRandomKey = createHmac("sha256", Buffer.alloc(32)) // zero-filled salt
    .update(Buffer.from(secret, "utf8"))
    .digest();
  return createHmac("sha256", pseudoRandomKey)
    .update(Buffer.concat([Buffer.from(info, "utf8"), Buffer.from([1])]))
    .digest()
    .subarray(0, length);
}

export interface RawClaims {
  p: string;
  u: string;
  s: string;
  e: string;
  l?: string;
  n: number;
  f: string;
  i: number;
  x: number;
}

export interface MintOptions {
  secret: string;
  claims: RawClaims;
  /** The HKDF info string. Defaults to the specified one. */
  info?: string;
  /** Uses the raw secret as the HMAC key, as if no key had been derived. */
  withoutDerivation?: boolean;
  /** The token version prefix. Defaults to `ct1`. */
  prefix?: string;
}

/** Mints a token exactly as ADR 0006 § 3 specifies, from chosen parts. */
export function mintTestToken(options: MintOptions): string {
  const key = options.withoutDerivation
    ? Buffer.from(options.secret, "utf8")
    : hkdfSha256(options.secret, options.info ?? TEST_KEY_INFO);
  const signed = `${options.prefix ?? "ct1"}.${Buffer.from(
    JSON.stringify(options.claims),
    "utf8",
  ).toString("base64url")}`;
  const tag = createHmac("sha256", key).update(signed, "utf8").digest();
  return `${signed}.${tag.toString("base64url")}`;
}

/** The claims of a token, read without verifying anything. */
export function claimsOf(token: string): RawClaims {
  const payload = token.split(".")[1]!;
  return JSON.parse(
    Buffer.from(payload, "base64url").toString("utf8"),
  ) as RawClaims;
}

/** The secret the application under test was configured with. */
export function testSecret(): string {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) {
    throw new Error("The test environment has no BETTER_AUTH_SECRET.");
  }
  return secret;
}

/**
 * Re-signs a real token with some claims replaced, under the application's
 * secret, so the signature is valid and only the replaced claims differ. This
 * is how a test builds an expired token, a token from the future, or a token
 * for another session, with a fingerprint the server really computed.
 */
export function reissueTestToken(
  token: string,
  changes: Partial<RawClaims>,
  options: Partial<Pick<MintOptions, "secret" | "info">> = {},
): string {
  return mintTestToken({
    secret: options.secret ?? testSecret(),
    info: options.info,
    claims: { ...claimsOf(token), ...changes },
  });
}

/** The same token, valid for the same author, with its validity moved in time. */
export function shiftedTestToken(token: string, deltaMs: number): string {
  const claims = claimsOf(token);
  return reissueTestToken(token, {
    i: claims.i + deltaMs,
    x: claims.x + deltaMs,
  });
}

/** A different session of the same author. */
export function otherSession(author: AuthorizedAuthor): AuthorizedAuthor {
  return {
    userId: author.userId,
    sessionId: "00000000-0000-4000-8000-0000000000ff",
  } as AuthorizedAuthor;
}
