// Password hashing for the single Studio owner: scrypt from Node's crypto, no
// dependency. Encoded as scrypt$<N>$<r>$<p>$<salt>$<hash> (base64url).
import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

const KEY_LENGTH = 64;
const DEFAULTS = { N: 2 ** 15, r: 8, p: 1 };

function derive(
  password: string,
  salt: Buffer,
  { N, r, p }: { N: number; r: number; p: number },
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      password.normalize("NFKC"),
      salt,
      KEY_LENGTH,
      { N, r, p, maxmem: 256 * N * r + 1024 * 1024 },
      (error, key) => (error ? reject(error) : resolve(key)),
    );
  });
}

export async function hashPassword(
  password: string,
  params = DEFAULTS,
): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt, params);
  return [
    "scrypt",
    params.N,
    params.r,
    params.p,
    salt.toString("base64url"),
    key.toString("base64url"),
  ].join("$");
}

type Parsed = { N: number; r: number; p: number; salt: Buffer; key: Buffer };

/** Parses an encoded hash; null when malformed or outside safe parameters. */
export function parsePasswordHash(encoded: string): Parsed | null {
  const parts = encoded.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return null;
  const [N, r, p] = parts.slice(1, 4).map(Number) as [number, number, number];
  const salt = Buffer.from(parts[4]!, "base64url");
  const key = Buffer.from(parts[5]!, "base64url");
  const powerOfTwo = Number.isInteger(Math.log2(N));
  if (
    !powerOfTwo ||
    N < 2 ** 14 ||
    N > 2 ** 20 ||
    r < 8 ||
    r > 32 ||
    p < 1 ||
    p > 4 ||
    salt.length < 16 ||
    key.length !== KEY_LENGTH
  ) {
    return null;
  }
  return { N, r, p, salt, key };
}

/** Constant-time check of a password against an encoded hash. */
export async function verifyPassword(
  password: string,
  encoded: string,
): Promise<boolean> {
  const parsed = parsePasswordHash(encoded);
  if (!parsed) return false;
  const key = await derive(password, parsed.salt, parsed);
  return timingSafeEqual(key, parsed.key);
}
