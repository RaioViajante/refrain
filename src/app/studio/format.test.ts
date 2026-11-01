import { describe, expect, it } from "vitest";

import { formatDuration, parseDuration, plural } from "./format";

describe("formatDuration", () => {
  it.each([
    [null, ""],
    [222_000, "3:42"],
    [59_000, "0:59"],
    [3_723_000, "1:02:03"],
    [1_000, "0:01"],
  ])("formats %s", (ms, text) => {
    expect(formatDuration(ms)).toBe(text);
  });
});

describe("parseDuration", () => {
  it.each([
    ["", null],
    ["  ", null],
    ["3:42", 222_000],
    ["03:42", 222_000],
    ["1:02:03", 3_723_000],
    ["90", 90_000],
    ["0:01", 1_000],
  ])("reads %j", (text, ms) => {
    expect(parseDuration(text)).toBe(ms);
  });

  it.each(["abc", "3:60", "3:4", "-1", "0", "0:00", "1:2:3:4", "3.5", "99999999"])(
    "refuses %j",
    (text) => {
      expect(parseDuration(text)).toBeUndefined();
    },
  );

  it("round-trips what it formats", () => {
    for (const ms of [1_000, 61_000, 222_000, 3_600_000, 5_999_000]) {
      expect(parseDuration(formatDuration(ms))).toBe(ms);
    }
  });
});

describe("plural", () => {
  it("counts", () => {
    expect(plural(1, "album")).toBe("1 album");
    expect(plural(0, "album")).toBe("0 albums");
    expect(plural(2, "entry", "entries")).toBe("2 entries");
  });
});
