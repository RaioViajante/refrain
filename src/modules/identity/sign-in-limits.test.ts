// The client a sign-in comes from, as the sign-in limits see it (issue #11).
import { describe, expect, it } from "vitest";

import { signInClient, UNKNOWN_CLIENT } from "./sign-in-limits";
import { testAuthConfig } from "./test-helpers";

const trusted = testAuthConfig({ trustedClientIpHeader: "x-forwarded-for" });
const untrusted = testAuthConfig();

function from(headers: Record<string, string>) {
  return new Request("http://localhost:3000/api/auth/sign-in/email", {
    method: "POST",
    headers,
  });
}

describe("signInClient", () => {
  it("names nobody when no header is trusted, whatever the request claims", () => {
    const claims: Record<string, string>[] = [
      {},
      { "x-forwarded-for": "203.0.113.7" },
      { "x-real-ip": "203.0.113.7", "x-vercel-forwarded-for": "203.0.113.8" },
    ];
    for (const headers of claims) {
      expect(signInClient(from(headers), untrusted)).toBe(UNKNOWN_CLIENT);
    }
  });

  it("names an IPv4 client by its address", () => {
    expect(
      signInClient(from({ "x-forwarded-for": " 203.0.113.7 " }), trusted),
    ).toBe("203.0.113.7");
  });

  it("names an IPv6 client by its /64, the block one network holds", () => {
    const a = signInClient(
      from({ "x-forwarded-for": "2001:db8:abcd:12::1" }),
      trusted,
    );
    const b = signInClient(
      from({ "x-forwarded-for": "2001:0db8:abcd:0012:ffff:ffff:ffff:ffff" }),
      trusted,
    );
    const other = signInClient(
      from({ "x-forwarded-for": "2001:db8:abcd:13::1" }),
      trusted,
    );
    expect(a).toBe("2001:0db8:abcd:0012::/64");
    expect(b).toBe(a);
    expect(other).not.toBe(a);
    expect(signInClient(from({ "x-forwarded-for": "::1" }), trusted)).toBe(
      "0000:0000:0000:0000::/64",
    );
  });

  it("names an IPv4 address written as IPv6 as that IPv4 client", () => {
    expect(
      signInClient(from({ "x-forwarded-for": "::ffff:203.0.113.7" }), trusted),
    ).toBe("203.0.113.7");
    expect(
      signInClient(from({ "x-forwarded-for": "::ffff:cb00:7107" }), trusted),
    ).toBe("203.0.113.7");
  });

  it.each([
    "",
    "203.0.113.7, 198.51.100.1",
    "unknown",
    "203.0.113",
    "203.0.113.256",
    "localhost",
    "2001:db8::1::2",
    "[2001:db8::1]",
    "203.0.113.7:443",
    "refrain-global",
  ])("names nobody for %j: not exactly one address", (value) => {
    expect(signInClient(from({ "x-forwarded-for": value }), trusted)).toBe(
      UNKNOWN_CLIENT,
    );
  });

  it("names nobody when the trusted header is missing", () => {
    expect(signInClient(from({ "x-real-ip": "203.0.113.7" }), trusted)).toBe(
      UNKNOWN_CLIENT,
    );
  });
});
