import { describe, expect, it } from "vitest";

import { AuthConfigError, readAuthConfig } from "./config";

const SECRET = "Zm9vYmFyLWJhei1xdXV4LTEyMzQ1Njc4OTAtYWJjZGVm";

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
