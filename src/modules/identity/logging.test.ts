import { afterEach, describe, expect, it, vi } from "vitest";

import { describeAuthError, logAuthMessage, redactLogMessage } from "./logging";

// The shape of a Drizzle query failure: the parameters are in the message.
function failedQuery() {
  const cause = Object.assign(
    new Error('relation "auth_sessions" does not exist'),
    {
      code: "42P01",
    },
  );
  return Object.assign(
    new Error(
      'Failed query: select "token" from "auth_sessions" where "token" = $1\nparams: SESSION-TOKEN-123',
    ),
    { name: "DrizzleQueryError", cause },
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("authentication logging", () => {
  it("describes an error by name, status, and code only", () => {
    expect(describeAuthError(failedQuery())).toEqual({
      name: "DrizzleQueryError",
      code: "42P01",
    });
  });

  it("drops query parameters and everything after the first line", () => {
    expect(redactLogMessage(failedQuery().message)).not.toContain(
      "SESSION-TOKEN-123",
    );
    expect(
      redactLogMessage("Failed query: x params: SESSION-TOKEN-123"),
    ).not.toContain("SESSION-TOKEN-123");
    expect(redactLogMessage("a".repeat(500)).length).toBeLessThanOrEqual(161);
    expect(redactLogMessage({ token: "SESSION-TOKEN-123" })).toBe("");
  });

  it("never writes the message of a logged error", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    logAuthMessage(
      "error",
      "Failed to get session",
      failedQuery(),
      "SESSION-TOKEN-123",
    );
    const output = JSON.stringify(error.mock.calls);
    expect(output).not.toContain("SESSION-TOKEN-123");
    expect(output).not.toContain("auth_sessions");
    expect(output).toContain("42P01");
  });
});
