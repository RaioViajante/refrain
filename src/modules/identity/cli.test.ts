import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { describeTarget, parseArguments } from "./cli";

describe("author command arguments", () => {
  it("requires a command and an explicit target", () => {
    expect(
      parseArguments(["provision", "--target=127.0.0.1:5432/refrain"]),
    ).toEqual({
      command: "provision",
      target: "127.0.0.1:5432/refrain",
    });
    expect(() => parseArguments(["provision"])).toThrow(/Usage/);
    expect(() => parseArguments(["create", "--target=x"])).toThrow(/Usage/);
    expect(() =>
      parseArguments(["provision", "--target=a", "--target=b"]),
    ).toThrow(/Usage/);
  });

  it.each(["--password=hunter2", "--pass", "-p", "--passwd=x", "-password"])(
    "never accepts a password argument (%s)",
    (flag) => {
      let message = "";
      try {
        parseArguments(["provision", "--target=127.0.0.1:5432/refrain", flag]);
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message).not.toBe("");
      expect(message).not.toContain("hunter2");
    },
  );
});

describe("database target", () => {
  it("is the effective host, port, and database, without credentials", () => {
    expect(
      describeTarget("postgres://refrain:secret@127.0.0.1:5432/refrain"),
    ).toBe("127.0.0.1:5432/refrain");
    expect(describeTarget("postgresql://u:p@LocalHost/refrain")).toBe(
      "localhost:5432/refrain",
    );
  });

  it("refuses query parameters, which could redirect the connection", () => {
    expect(() =>
      describeTarget("postgres://u:p@127.0.0.1:5432/refrain?host=db.example"),
    ).toThrow(/query parameters/);
  });
});

describe("account creation", () => {
  // Static imports only, like the lint boundaries; the module's public entry
  // point does not export provisioning, and src/app cannot deep-import it.
  it("is reachable only from the local command and tests", () => {
    const sources = readdirSync("src", { recursive: true, encoding: "utf8" })
      .filter((file) => /\.(ts|tsx|mts)$/.test(file))
      .map((file) => join("src", file));
    const importers = sources.filter((file) =>
      /from\s+["'](\.\/|@\/modules\/identity\/)provisioning["']/.test(
        readFileSync(file, "utf8"),
      ),
    );
    expect(
      importers.filter(
        (file) => !/\.(integration\.|http\.)?test\.ts$/.test(file),
      ),
    ).toEqual([join("src", "modules", "identity", "cli.ts")]);
    const entryPoint = readFileSync("src/modules/identity/index.ts", "utf8");
    expect(entryPoint).not.toMatch(
      /from\s+["']\.\/(provisioning|cli|auth)["']/,
    );
    expect(existsSync("src/instrumentation.ts")).toBe(false);
  });
});
