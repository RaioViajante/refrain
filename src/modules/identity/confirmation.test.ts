import { createHash, createHmac, hkdfSync, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  claimsOf,
  hkdfSha256,
  mintTestToken,
  type RawClaims,
} from "@/testing/confirmation";
import { testAuthor } from "@/testing/fixtures";

import {
  CONFIRMATION_VALIDITY_MS,
  confirmationAvailable,
  confirmationIsCurrent,
  MAX_CONFIRMATION_TOKEN_LENGTH,
  signConfirmation,
  signConfirmationWith,
  verifyConfirmation,
  verifyConfirmationWith,
  type ConfirmationIssue,
} from "./confirmation";

// ADR 0006 § 13, test 1 (authentication). The Identity module is compared
// with an independent implementation of the specification (src/testing/
// confirmation.ts), so these tests check the format, not the module against
// itself.

const SECRET = randomBytes(32).toString("base64");
const author = testAuthor();
const fingerprint = createHash("sha256")
  .update("[Test] disclosure")
  .digest("base64url");
const ENTRY = "11111111-1111-4111-8111-111111111111";
const NOW = 1_800_000_000_000;

const issue: ConfirmationIssue = {
  purpose: "publish",
  entryId: ENTRY,
  locale: "en",
  entryVersion: 3,
  fingerprint,
  issuedAtMs: NOW,
};
const binding = {
  purpose: "publish",
  entryId: ENTRY,
  locale: "en",
  entryVersion: 3,
} as const;

function signed(overrides: Partial<ConfirmationIssue> = {}): string {
  const result = signConfirmationWith(SECRET, author, {
    ...issue,
    ...overrides,
  });
  if (!result.ok) {
    throw new Error("expected a token");
  }
  return result.token;
}

const goodClaims: RawClaims = {
  p: "publish",
  u: author.userId,
  s: author.sessionId,
  e: ENTRY,
  l: "en",
  n: 3,
  f: fingerprint,
  i: NOW,
  x: NOW + CONFIRMATION_VALIDITY_MS,
};

function verdict(
  token: string,
  b: Parameters<typeof verifyConfirmationWith>[3] = binding,
) {
  return verifyConfirmationWith(SECRET, author, token, b);
}

describe("the key and the token follow the specification", () => {
  it("derives keys as RFC 5869 does, including the zero-length-salt case", () => {
    // RFC 5869, Appendix A, Test Case 3 (zero-length salt and info).
    const okm = Buffer.from(
      hkdfSync("sha256", Buffer.alloc(22, 0x0b), Buffer.alloc(0), "", 42),
    ).toString("hex");
    expect(okm).toBe(
      "8da4e775a563c18f715f802a063c5a31b8a11f5c5ee1879ec3454e5f3c738d2d9d201395faa4b61a96c8",
    );
    // The independent derivation agrees with Node's on the real purpose string.
    expect(
      hkdfSha256(SECRET, "refrain/confirmation-token/ct1").toString("hex"),
    ).toBe(
      Buffer.from(
        hkdfSync(
          "sha256",
          Buffer.from(SECRET),
          Buffer.alloc(0),
          "refrain/confirmation-token/ct1",
          32,
        ),
      ).toString("hex"),
    );
  });

  it("issues exactly the token that an independent implementation mints", () => {
    expect(signed()).toBe(
      mintTestToken({ secret: SECRET, claims: goodClaims }),
    );
  });

  it("issues a change_public token with no locale", () => {
    const token = signed({ purpose: "change_public", locale: undefined });
    expect(claimsOf(token)).not.toHaveProperty("l");
    expect(
      verdict(token, {
        purpose: "change_public",
        entryId: ENTRY,
        entryVersion: 3,
      }).ok,
    ).toBe(true);
  });

  it("carries only the specified claims, and no writing", () => {
    const token = signed();
    expect(Object.keys(claimsOf(token)).sort()).toEqual(
      ["e", "f", "i", "l", "n", "p", "s", "u", "x"].sort(),
    );
    expect(token.startsWith("ct1.")).toBe(true);
    expect(token.length).toBeLessThan(MAX_CONFIRMATION_TOKEN_LENGTH);
  });

  it("is valid for exactly fifteen minutes, by the claims", () => {
    const claims = claimsOf(signed());
    expect(claims.x - claims.i).toBe(15 * 60 * 1000);
  });

  it("verifies a good token and returns what the caller must still check", () => {
    expect(verdict(signed())).toEqual({
      ok: true,
      claims: {
        fingerprint,
        issuedAtMs: NOW,
        expiresAtMs: NOW + CONFIRMATION_VALIDITY_MS,
      },
    });
  });
});

describe("a token is refused unless it is authentic and bound to the request", () => {
  const token = signed();
  const [prefix, payload, tag] = token.split(".") as [string, string, string];

  function flip(text: string, at: number): string {
    const alphabet =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    const replacement = alphabet[(alphabet.indexOf(text[at]!) + 1) % 64]!;
    return text.slice(0, at) + replacement + text.slice(at + 1);
  }

  it.each([
    ["a payload byte changed", `${prefix}.${flip(payload, 10)}.${tag}`],
    ["the MAC changed", `${prefix}.${payload}.${flip(tag, 5)}`],
    ["the MAC truncated", `${prefix}.${payload}.${tag.slice(0, -4)}`],
    ["the MAC extended", `${prefix}.${payload}.${tag}AAAA`],
    ["the MAC empty", `${prefix}.${payload}.`],
    ["an unknown version", `ct2.${payload}.${tag}`],
    ["no version", `${payload}.${tag}`],
    ["an extra part", `${token}.x`],
    ["the empty string", ""],
    ["only the prefix", "ct1."],
    ["padding in the MAC", `${prefix}.${payload}.${tag}=`],
    [
      "characters outside base64url",
      `${prefix}.${payload}.${tag.slice(0, -1)}+`,
    ],
    [
      "more than the longest allowed token",
      token + "A".repeat(MAX_CONFIRMATION_TOKEN_LENGTH),
    ],
  ])("%s", (_name, forged) => {
    expect(verdict(forged)).toEqual({ ok: false, reason: "invalid" });
  });

  it("refuses the unkeyed fingerprint on its own", () => {
    expect(verdict(fingerprint)).toEqual({ ok: false, reason: "invalid" });
    expect(verdict(`ct1.${fingerprint}`)).toEqual({
      ok: false,
      reason: "invalid",
    });
  });

  it("refuses a token signed under another secret", () => {
    const other = mintTestToken({
      secret: randomBytes(32).toString("base64"),
      claims: goodClaims,
    });
    expect(verdict(other).ok).toBe(false);
  });

  it("refuses a token whose key was derived with another purpose string", () => {
    expect(
      verdict(
        mintTestToken({
          secret: SECRET,
          claims: goodClaims,
          info: "refrain/session-cookie/v1",
        }),
      ).ok,
    ).toBe(false);
  });

  it("refuses a token signed with the raw secret, as if no key was derived", () => {
    expect(
      verdict(
        mintTestToken({
          secret: SECRET,
          claims: goodClaims,
          withoutDerivation: true,
        }),
      ).ok,
    ).toBe(false);
  });

  it("accepts the same token only when the independent minter used the specified key", () => {
    expect(
      verdict(mintTestToken({ secret: SECRET, claims: goodClaims })).ok,
    ).toBe(true);
  });

  it.each<[string, Partial<RawClaims>]>([
    ["an unknown claim", { z: 1 } as unknown as Partial<RawClaims>],
    ["a lifetime of one day", { x: NOW + 24 * 60 * 60 * 1000 }],
    ["a lifetime of one minute", { x: NOW + 60 * 1000 }],
    ["a zero lifetime", { x: NOW }],
    ["a negative version", { n: -1 }],
    ["a fractional version", { n: 1.5 }],
    ["a locale that does not exist", { l: "fr" }],
    ["an unknown purpose", { p: "unpublish" }],
    ["a fingerprint of the wrong shape", { f: "short" }],
    ["a non-string author", { u: 7 as unknown as string }],
  ])("refuses an authentic token with %s", (_name, changes) => {
    expect(
      verdict(
        mintTestToken({
          secret: SECRET,
          claims: { ...goodClaims, ...changes },
        }),
      ).ok,
    ).toBe(false);
  });

  it("refuses an authentic payload that is not an object", () => {
    for (const body of ["[]", "null", "7", '"x"']) {
      const signedPart = `ct1.${Buffer.from(body).toString("base64url")}`;
      const mac = createHmac(
        "sha256",
        hkdfSha256(SECRET, "refrain/confirmation-token/ct1"),
      )
        .update(signedPart)
        .digest("base64url");
      expect(verdict(`${signedPart}.${mac}`).ok).toBe(false);
    }
  });

  it.each<[string, Parameters<typeof verifyConfirmationWith>[3]]>([
    ["another purpose", { ...binding, purpose: "change_public" }],
    [
      "another entry",
      { ...binding, entryId: "22222222-2222-4222-8222-222222222222" },
    ],
    ["another locale", { ...binding, locale: "pt-BR" }],
    ["another version", { ...binding, entryVersion: 4 }],
    [
      "a missing locale",
      { purpose: "publish", entryId: ENTRY, entryVersion: 3 },
    ],
  ])("refuses a good token presented for %s", (_name, other) => {
    expect(verdict(token, other)).toEqual({ ok: false, reason: "invalid" });
  });

  it("refuses a change_public token carrying a locale, and a publish token without one", () => {
    expect(
      verdict(
        mintTestToken({
          secret: SECRET,
          claims: { ...goodClaims, p: "change_public" },
        }),
        { purpose: "change_public", entryId: ENTRY, entryVersion: 3 },
      ).ok,
    ).toBe(false);
    const withoutLocale: Partial<RawClaims> = { ...goodClaims };
    delete withoutLocale.l;
    expect(
      verdict(
        mintTestToken({ secret: SECRET, claims: withoutLocale as RawClaims }),
      ).ok,
    ).toBe(false);
  });

  it("refuses a publish token, with no locale, presented for a change_public save", () => {
    // Everything but the purpose claim matches: only `p` can refuse it.
    const withoutLocale: Partial<RawClaims> = { ...goodClaims };
    delete withoutLocale.l;
    expect(
      verdict(
        mintTestToken({ secret: SECRET, claims: withoutLocale as RawClaims }),
        { purpose: "change_public", entryId: ENTRY, entryVersion: 3 },
      ),
    ).toEqual({ ok: false, reason: "invalid" });
  });

  it("refuses another author and another session", () => {
    const otherUser = {
      ...author,
      userId: "00000000-0000-4000-8000-0000000000aa",
    };
    const otherSession = {
      ...author,
      sessionId: "00000000-0000-4000-8000-0000000000bb",
    };
    for (const other of [otherUser, otherSession]) {
      expect(verifyConfirmationWith(SECRET, other, token, binding)).toEqual({
        ok: false,
        reason: "invalid",
      });
    }
  });

  it("does not accept a session-cookie style signature as a token", () => {
    // A cookie value is `value.signature` under the raw secret; never a token.
    const value = "session-id";
    const signature = createHmac("sha256", SECRET)
      .update(value)
      .digest("base64");
    expect(verdict(`${value}.${encodeURIComponent(signature)}`).ok).toBe(false);
  });
});

describe("expiry is decided against the database clock the caller read", () => {
  const claims = verdict(signed());
  if (!claims.ok) {
    throw new Error("fixture");
  }
  const { claims: c } = claims;

  it("is current from the issue time up to, not including, the expiry", () => {
    expect(confirmationIsCurrent(c, NOW)).toBe(true);
    expect(confirmationIsCurrent(c, NOW + CONFIRMATION_VALIDITY_MS - 1)).toBe(
      true,
    );
  });

  it("is not current at the expiry or after it", () => {
    expect(confirmationIsCurrent(c, NOW + CONFIRMATION_VALIDITY_MS)).toBe(
      false,
    );
    expect(confirmationIsCurrent(c, NOW + CONFIRMATION_VALIDITY_MS + 1)).toBe(
      false,
    );
  });

  it("is not current before it was issued", () => {
    expect(confirmationIsCurrent(c, NOW - 1)).toBe(false);
  });
});

describe("a missing or unsafe configuration fails closed", () => {
  const variables = [
    "BETTER_AUTH_SECRET",
    "BETTER_AUTH_URL",
    "REFRAIN_AUTHOR_EMAIL",
  ] as const;
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const variable of variables) {
      saved[variable] = process.env[variable];
    }
    process.env.BETTER_AUTH_URL = "http://localhost:3000";
    process.env.REFRAIN_AUTHOR_EMAIL = "author@example.com";
    process.env.BETTER_AUTH_SECRET = SECRET;
  });
  afterEach(() => {
    for (const variable of variables) {
      if (saved[variable] === undefined) {
        delete process.env[variable];
      } else {
        process.env[variable] = saved[variable];
      }
    }
    vi.restoreAllMocks();
  });

  it("signs and verifies with the configured secret", () => {
    expect(confirmationAvailable()).toBe(true);
    const result = signConfirmation(author, issue);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.token).toBe(signed());
      expect(verifyConfirmation(author, result.token, binding).ok).toBe(true);
    }
  });

  it.each([
    ["missing", undefined],
    ["short", "too-short-secret"],
    ["a repeated character", "a".repeat(64)],
  ])(
    "is unavailable when the secret is %s, and logs no value",
    (_name, value) => {
      const logged: unknown[][] = [];
      for (const method of ["error", "warn", "log", "info"] as const) {
        vi.spyOn(console, method).mockImplementation((...args) => {
          logged.push(args);
        });
      }
      const token = signed();
      if (value === undefined) {
        delete process.env.BETTER_AUTH_SECRET;
      } else {
        process.env.BETTER_AUTH_SECRET = value;
      }
      expect(confirmationAvailable()).toBe(false);
      expect(signConfirmation(author, issue)).toEqual({
        ok: false,
        reason: "unavailable",
      });
      expect(verifyConfirmation(author, token, binding)).toEqual({
        ok: false,
        reason: "unavailable",
      });
      const output = JSON.stringify(logged);
      expect(output).not.toContain(token);
      expect(output).not.toContain(SECRET);
      if (value) {
        expect(output).not.toContain(value);
      }
    },
  );

  it("is unavailable when another required variable is missing", () => {
    delete process.env.BETTER_AUTH_URL;
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(signConfirmation(author, issue)).toEqual({
      ok: false,
      reason: "unavailable",
    });
  });
});

describe("the module keeps the token and the key to itself", () => {
  const source = readFileSync("src/modules/identity/confirmation.ts", "utf8");
  const code = source
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");

  it("compares the MAC in constant time and in no other way", () => {
    expect(code).toContain("timingSafeEqual(expected, presented)");
    expect(code).not.toMatch(
      /\.equals\(|\.compare\(|(expected|presented)\s*[!=]==(?!\s*null)/,
    );
  });

  it("never logs a token, the key, or the secret", () => {
    expect(code).not.toMatch(/console\./);
    // The only reporting goes through the shared reporter, which names a
    // variable and never a value.
    expect(code.match(/reportUnavailable\(/g)).toHaveLength(1);
  });

  it("takes the signing key from HKDF-SHA-256, never from the raw secret", () => {
    expect(code).toContain('hkdfSync(\n      "sha256"');
    expect(code).not.toMatch(
      /createHmac\("sha256",\s*(secret|Buffer\.from\(secret)/,
    );
  });

  it("does not issue a token it could not verify", () => {
    expect(() =>
      signConfirmationWith(SECRET, author, { ...issue, locale: undefined }),
    ).toThrow(TypeError);
    expect(() =>
      signConfirmationWith(SECRET, author, { ...issue, entryVersion: 0 }),
    ).toThrow(TypeError);
  });
});
