import { describe, expect, it } from "vitest";

import { longestWordLength } from "./title-fit";

describe("the longest word of an artist's name", () => {
  it("counts the longest run between spaces and hyphens", () => {
    expect(longestWordLength("Jeff Buckley")).toBe(7);
    expect(
      longestWordLength(
        "[Test] The Extraordinarily Long-Named Synthetic Chamber Orchestra",
      ),
    ).toBe(15);
    expect(longestWordLength("Long-Named")).toBe(5);
    expect(longestWordLength("Björk")).toBe(5);
    expect(longestWordLength("坂本龍一")).toBe(4);
  });

  it("is at least 1", () => {
    expect(longestWordLength("")).toBe(1);
    expect(longestWordLength(" - ")).toBe(1);
  });
});
