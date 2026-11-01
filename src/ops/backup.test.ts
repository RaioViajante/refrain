import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  checkOutputPath,
  checkSidecar,
  knownServices,
  OpsError,
  parseArguments,
  resolveTarget,
  targetOfUrl,
} from "./backup";

// The pure rules of the backup tool. They need no database and no Docker. The
// end-to-end run against the disposable test container is described in
// docs/development.md § Backup and restore.

const env = {
  DATABASE_URL: "postgres://refrain:secret-development@127.0.0.1:5432/refrain",
  TEST_DATABASE_URL:
    "postgres://refrain_test:secret-test@127.0.0.1:5433/refrain_test",
};

describe("which database a target may name", () => {
  it("resolves the development and the test target, and only those", () => {
    expect(knownServices(env)).toEqual([
      { name: "postgres", target: "127.0.0.1:5432/refrain" },
      { name: "postgres-test", target: "127.0.0.1:5433/refrain_test" },
    ]);
    expect(resolveTarget("127.0.0.1:5432/refrain", env).name).toBe("postgres");
    expect(resolveTarget("127.0.0.1:5433/refrain_test", env).name).toBe(
      "postgres-test",
    );
    expect(
      resolveTarget("LOCALHOST:5432/refrain", {
        DATABASE_URL: "postgres://u:p@localhost:5432/refrain",
      }).name,
    ).toBe("postgres");
  });

  it("refuses a target the environment does not name, with a different port, database, or host", () => {
    for (const target of [
      "127.0.0.1:5432/other",
      "127.0.0.1:5434/refrain",
      "127.0.0.1:5432/refrain_test",
      "db.example.com:5432/refrain",
      "10.0.0.5:5432/refrain",
      "0.0.0.0:5432/refrain",
      "127.1:5432/refrain",
      "127.0.0.1:5432/refrain?host=elsewhere",
      "127.0.0.1:5432/refrain; drop database refrain",
      "127.0.0.1:5432/",
      "refrain",
      "",
    ]) {
      expect(() => resolveTarget(target, env), target).toThrow(OpsError);
    }
  });

  it("refuses everything when the environment names no database", () => {
    expect(() => resolveTarget("127.0.0.1:5432/refrain", {})).toThrow(OpsError);
    expect(() =>
      resolveTarget("127.0.0.1:5432/refrain", {
        DATABASE_URL: "postgres://u:p@127.0.0.1:5432/refrain?host=/tmp",
      }),
    ).toThrow(OpsError);
  });

  it("never puts a credential in an error message", () => {
    for (const target of ["127.0.0.1:5432/other", "x"]) {
      try {
        resolveTarget(target, env);
      } catch (error) {
        expect(String(error)).not.toMatch(/secret|postgres:\/\//);
      }
    }
  });

  it("reads a URL's effective target, and not a URL with query parameters", () => {
    expect(targetOfUrl("postgres://u:p@[::1]:5440/db")).toBe("::1:5440/db");
    expect(targetOfUrl("postgres://u:p@127.0.0.1/db")).toBe(
      "127.0.0.1:5432/db",
    );
    expect(targetOfUrl("postgres://u:p@127.0.0.1/db?port=1")).toBeUndefined();
    expect(targetOfUrl("mysql://u:p@127.0.0.1/db")).toBeUndefined();
    expect(targetOfUrl("not a url")).toBeUndefined();
    expect(targetOfUrl(undefined)).toBeUndefined();
    expect(targetOfUrl("postgres://u:p@127.0.0.1/db%E0%A4%A")).toBeUndefined();
  });
});

describe("where a backup may be written", () => {
  let root: string;
  let outside: string;
  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), "refrain-ops-root-"));
    mkdirSync(join(root, "docs"));
    outside = mkdtempSync(join(tmpdir(), "refrain-ops-out-"));
  });
  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  });

  it("accepts a new file in an existing directory outside the repository", () => {
    expect(() =>
      checkOutputPath(join(outside, "refrain.dump"), root),
    ).not.toThrow();
  });

  it("refuses a relative path, an existing file, a missing directory, and the repository", () => {
    writeFileSync(join(outside, "taken.dump"), "x");
    for (const path of [
      "refrain.dump",
      "./refrain.dump",
      join(outside, "taken.dump"),
      join(outside, "no-such-directory", "refrain.dump"),
      join(root, "refrain.dump"),
      join(root, "docs", "refrain.dump"),
      join(outside, "bad\nname.dump"),
    ]) {
      expect(() => checkOutputPath(path, root), path).toThrow(OpsError);
    }
  });

  it("refuses a path that leads into the repository through a symbolic link", () => {
    symlinkSync(root, join(outside, "link-to-repo"));
    expect(() =>
      checkOutputPath(join(outside, "link-to-repo", "x.dump"), root),
    ).toThrow(OpsError);
  });

  it("refuses a dangling symbolic link at the output path instead of writing through it", () => {
    symlinkSync(
      join(outside, "does-not-exist"),
      join(outside, "dangling.dump"),
    );
    expect(() => checkOutputPath(join(outside, "dangling.dump"), root)).toThrow(
      OpsError,
    );
  });
});

describe("the commands and their flags", () => {
  it("parses backup and verify", () => {
    expect(
      parseArguments([
        "backup",
        "--target=127.0.0.1:5432/refrain",
        "--output=/x/a.dump",
      ]),
    ).toEqual({
      command: "backup",
      target: "127.0.0.1:5432/refrain",
      output: "/x/a.dump",
    });
    expect(
      parseArguments([
        "verify",
        "--file=/x/a.dump",
        "--compare-with=127.0.0.1:5432/refrain",
      ]),
    ).toEqual({
      command: "verify",
      file: "/x/a.dump",
      compareWith: "127.0.0.1:5432/refrain",
    });
    expect(parseArguments(["verify", "--file=/x/a.dump"])).toEqual({
      command: "verify",
      file: "/x/a.dump",
      compareWith: undefined,
    });
  });

  it("has no flag that overwrites, cleans, drops, or restores over a database", () => {
    for (const argv of [
      [
        "backup",
        "--target=127.0.0.1:5432/refrain",
        "--output=/x/a.dump",
        "--force",
      ],
      [
        "backup",
        "--target=127.0.0.1:5432/refrain",
        "--output=/x/a.dump",
        "--overwrite=1",
      ],
      ["backup", "--target=127.0.0.1:5432/refrain"],
      ["backup", "--output=/x/a.dump"],
      ["backup", "--target=a", "--target=b", "--output=/x"],
      ["verify"],
      ["verify", "--file=/x/a.dump", "--into=127.0.0.1:5432/refrain"],
      ["verify", "--file=/x/a.dump", "--clean=1"],
      ["restore", "--file=/x/a.dump"],
      ["dropdb", "refrain"],
      [],
    ]) {
      expect(() => parseArguments(argv), argv.join(" ")).toThrow(OpsError);
    }
  });
});

describe("more output-path edge cases", () => {
  it("refuses a directory whose name starts with two dots inside the repository, and an existing checksum file", () => {
    const root = mkdtempSync(join(tmpdir(), "refrain-ops-root2-"));
    const outside = mkdtempSync(join(tmpdir(), "refrain-ops-out2-"));
    try {
      mkdirSync(join(root, "..backups"));
      expect(() =>
        checkOutputPath(join(root, "..backups", "x.dump"), root),
      ).toThrow(OpsError);
      writeFileSync(join(outside, "new.dump.sha256"), "x");
      expect(() => checkOutputPath(join(outside, "new.dump"), root)).toThrow(
        OpsError,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });
});

describe("the checksum next to an archive", () => {
  it("passes when it matches, is skipped when absent, and refuses a changed archive", async () => {
    const directory = mkdtempSync(join(tmpdir(), "refrain-ops-sum-"));
    try {
      const file = join(directory, "a.dump");
      writeFileSync(file, "archive bytes");
      expect(await checkSidecar(file)).toBe(false);
      const { createHash } = await import("node:crypto");
      const sum = createHash("sha256").update("archive bytes").digest("hex");
      writeFileSync(`${file}.sha256`, `${sum}  a.dump\n`);
      expect(await checkSidecar(file)).toBe(true);
      writeFileSync(file, "archive bytes, changed");
      await expect(checkSidecar(file)).rejects.toBeInstanceOf(OpsError);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
