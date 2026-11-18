import { describe, expect, it } from "vitest";

import { DatabaseConfigError } from "./env";
import { describeFailure } from "./health";

describe("describeFailure", () => {
  it("reads the code of an error wrapped as its cause, as Drizzle does", () => {
    const driverError = Object.assign(new Error("connect ECONNREFUSED"), {
      code: "ECONNREFUSED",
    });
    const wrapped = new Error("Failed query: select 1", {
      cause: driverError,
    });
    expect(describeFailure(wrapped)).toEqual({ code: "ECONNREFUSED" });
  });

  it("reads a code set directly on the error", () => {
    const error = Object.assign(new Error("terminating connection"), {
      code: "57P01",
    });
    expect(describeFailure(error)).toEqual({ code: "57P01" });
  });

  it("reports a configuration error by its fixed message", () => {
    const error = new DatabaseConfigError("DATABASE_URL is not set.");
    expect(describeFailure(error)).toEqual({
      reason: "DATABASE_URL is not set.",
    });
  });

  it("returns no code when none exists, including for cyclic causes", () => {
    const cyclic: Error & { cause?: unknown } = new Error("loop");
    cyclic.cause = cyclic;
    expect(describeFailure(cyclic)).toEqual({ code: undefined });
    expect(describeFailure("not an error")).toEqual({ code: undefined });
  });

  it("never includes error messages, which can contain connection details", () => {
    const secret = "postgres://user:do-not-leak@db.internal/refrain";
    const error = new Error(`Failed query with ${secret}`, {
      cause: Object.assign(new Error(secret), { code: "28P01" }),
    });
    expect(JSON.stringify(describeFailure(error))).not.toContain(secret);
  });
});
