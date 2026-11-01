import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { EventEmitter } from "node:events";

import {
  describeTarget,
  parseArguments,
  readHiddenAnswers,
  type HiddenInput,
} from "./cli";

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

// A terminal that records every operation in order, so the tests can check
// when echo is off relative to the prompts. In raw mode a real terminal does
// not echo, so echo is on exactly while the log's last raw-mode call is
// `raw:false` (or before any call).
function fakeTerminal() {
  const log: string[] = [];
  const events = new EventEmitter();
  const input: HiddenInput = {
    setRawMode: (mode) => log.push(`raw:${mode}`),
    setEncoding: () => undefined,
    resume: () => log.push("resume"),
    pause: () => log.push("pause"),
    on: (event, listener) => events.on(event, listener),
    off: (event, listener) => events.off(event, listener),
  };
  const output = { write: (text: string) => log.push(`write:${text}`) };
  const type = (chunk: string) => events.emit("data", chunk);
  const echoOnAt = (index: number) =>
    log
      .slice(0, index)
      .filter((entry) => entry.startsWith("raw:"))
      .at(-1) !== "raw:true";
  return { log, input, output, type, echoOnAt };
}

const QUESTIONS = ["Password (not shown): ", "Repeat the password: "];
const PASSWORD = "[Test] a long passphrase here";

describe("hidden password prompt", () => {
  it("keeps echo off from before the first question until the last answer", async () => {
    const terminal = fakeTerminal();
    const answers = readHiddenAnswers(
      QUESTIONS,
      terminal.input,
      terminal.output,
    );
    terminal.type(`${PASSWORD}\r`);
    terminal.type(`${PASSWORD}\r`);
    expect(await answers).toEqual([PASSWORD, PASSWORD]);

    for (const question of QUESTIONS) {
      const index = terminal.log.indexOf(`write:${question}`);
      expect(index).toBeGreaterThan(-1);
      expect(terminal.echoOnAt(index)).toBe(false);
    }
    // Echo is turned back on exactly once, after both answers.
    expect(terminal.log.filter((entry) => entry === "raw:false")).toHaveLength(
      1,
    );
    expect(terminal.log.indexOf("raw:false")).toBeGreaterThan(
      terminal.log.indexOf(`write:${QUESTIONS[1]}`),
    );
    expect(terminal.log.join("")).not.toContain(PASSWORD);
  });

  it("keeps a second answer that arrives together with the first", async () => {
    const terminal = fakeTerminal();
    const answers = readHiddenAnswers(
      QUESTIONS,
      terminal.input,
      terminal.output,
    );
    // A fast paste, or typing ahead before the second prompt appears.
    terminal.type(`${PASSWORD}\r${PASSWORD}\r`);
    expect(await answers).toEqual([PASSWORD, PASSWORD]);
    expect(terminal.log.join("")).not.toContain(PASSWORD);
  });

  it("restores the terminal and changes nothing when cancelled", async () => {
    const terminal = fakeTerminal();
    const answers = readHiddenAnswers(
      QUESTIONS,
      terminal.input,
      terminal.output,
    );
    terminal.type("[Test] partial\u0003");
    await expect(answers).rejects.toThrow("Cancelled. Nothing was changed.");
    expect(terminal.log.at(-1)).toBe("write:\n");
    expect(terminal.log).toContain("raw:false");
    expect(terminal.log.join("")).not.toContain("[Test] partial");
  });

  it("supports backspace and ignores arrow keys", async () => {
    const terminal = fakeTerminal();
    const answers = readHiddenAnswers(
      [QUESTIONS[0] ?? ""],
      terminal.input,
      terminal.output,
    );
    terminal.type("abX\u007f\u001b[Dc\r");
    expect(await answers).toEqual(["abc"]);
  });
});
