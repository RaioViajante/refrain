import { randomBytes } from "node:crypto";

import { describe, expect, it } from "vitest";

import { AuthConfigError, readAuthConfig } from "./config";

// Generated per run: no secret-like literal lives in the repository.
const SECRET = randomBytes(32).toString("base64");

const valid = {
  BETTER_AUTH_SECRET: SECRET,
  BETTER_AUTH_URL: "http://localhost:3000",
  REFRAIN_AUTHOR_EMAIL: "Author@Example.com",
};

function refusal(env: Record<string, string | undefined>): string {
  try {
    readAuthConfig(env);
  } catch (error) {
    expect(error).toBeInstanceOf(AuthConfigError);
    return (error as Error).message;
  }
  throw new Error("The configuration was accepted");
}

describe("readAuthConfig", () => {
  it("accepts a complete local configuration and normalizes it", () => {
    expect(readAuthConfig(valid)).toEqual({
      secret: SECRET,
      baseURL: "http://localhost:3000",
      authorEmail: "author@example.com",
      // No header names the client unless one is configured (issue #11).
      trustedClientIpHeader: null,
    });
  });

  describe("the trusted client header (issue #11)", () => {
    it("trusts x-forwarded-for only on Vercel, which overwrites it", () => {
      expect(
        readAuthConfig({
          ...valid,
          REFRAIN_TRUSTED_CLIENT_IP_HEADER: " X-Forwarded-For ",
          VERCEL: "1",
          VERCEL_ENV: "production",
        }).trustedClientIpHeader,
      ).toBe("x-forwarded-for");
    });

    it.each([undefined, "development", "test", ""])(
      "refuses it with VERCEL=1 but VERCEL_ENV=%j, as a pulled .env.local has it",
      (vercelEnv) => {
        expect(
          refusal({
            ...valid,
            REFRAIN_TRUSTED_CLIENT_IP_HEADER: "x-forwarded-for",
            VERCEL: "1",
            VERCEL_ENV: vercelEnv,
          }),
        ).toContain("only on Vercel");
      },
    );

    it.each([undefined, "", "0", "true", "yes"])(
      "refuses it off Vercel (VERCEL=%j): there a client chooses the header",
      (vercel) => {
        expect(
          refusal({
            ...valid,
            REFRAIN_TRUSTED_CLIENT_IP_HEADER: "x-forwarded-for",
            VERCEL: vercel,
          }),
        ).toContain("only on Vercel");
      },
    );

    it.each([
      "x-real-ip",
      "x-vercel-forwarded-for",
      "cf-connecting-ip",
      "forwarded",
      "x-forwarded-for, x-real-ip",
    ])(
      "refuses %j, which no platform here is documented to overwrite",
      (header) => {
        expect(
          refusal({
            ...valid,
            REFRAIN_TRUSTED_CLIENT_IP_HEADER: header,
            VERCEL: "1",
          }),
        ).toContain("may only be x-forwarded-for");
      },
    );

    it("trusts nothing when unset, even on Vercel", () => {
      expect(
        readAuthConfig({ ...valid, VERCEL: "1" }).trustedClientIpHeader,
      ).toBeNull();
    });
  });

  it("accepts an HTTPS origin and drops the trailing slash", () => {
    expect(
      readAuthConfig({ ...valid, BETTER_AUTH_URL: "https://refrain.example/" })
        .baseURL,
    ).toBe("https://refrain.example");
  });

  it.each(["BETTER_AUTH_SECRET", "BETTER_AUTH_URL", "REFRAIN_AUTHOR_EMAIL"])(
    "refuses a missing %s, with no default",
    (variable) => {
      expect(refusal({ ...valid, [variable]: undefined })).toContain(variable);
      expect(refusal({ ...valid, [variable]: "  " })).toContain(variable);
    },
  );

  it.each([
    ["too short", "a1B2c3D4e5F6g7H8"],
    ["low entropy", "a".repeat(64)],
    ["a repeated word", "secretsecretsecretsecretsecretsecret"],
  ])("refuses a %s secret without echoing it", (_label, secret) => {
    const message = refusal({ ...valid, BETTER_AUTH_SECRET: secret });
    expect(message).toContain("BETTER_AUTH_SECRET");
    expect(message).not.toContain(secret);
  });

  it.each([
    ["plain HTTP to another host", "http://refrain.example"],
    ["plain HTTP to a LAN address", "http://192.168.1.10:3000"],
    ["a path", "https://refrain.example/studio"],
    ["a query", "https://refrain.example/?next=x"],
    ["credentials", "https://user:hunter2@refrain.example"],
    ["another scheme", "ftp://refrain.example"],
    ["not a URL", "refrain.example"],
  ])("refuses a base URL with %s without echoing it", (_label, url) => {
    const message = refusal({ ...valid, BETTER_AUTH_URL: url });
    expect(message).toContain("BETTER_AUTH_URL");
    expect(message).not.toContain(url);
    expect(message).not.toContain("hunter2");
  });

  it("refuses an invalid author email", () => {
    expect(refusal({ ...valid, REFRAIN_AUTHOR_EMAIL: "author" })).toContain(
      "REFRAIN_AUTHOR_EMAIL",
    );
  });

  it.each([
    "BETTER_AUTH_SECRETS",
    "BETTER_AUTH_TRUSTED_ORIGINS",
    "BETTER_AUTH_TELEMETRY",
  ])("refuses %s, which Better Auth would read implicitly", (variable) => {
    expect(
      refusal({ ...valid, [variable]: "https://attacker.example" }),
    ).toContain(variable);
  });
});
