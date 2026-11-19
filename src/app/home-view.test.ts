import { describe, expect, it } from "vitest";

import { archiveDesktopHeight } from "./home-view";

describe("home constellation layout", () => {
  it.each([
    [2, 650],
    [3, 820],
    [7, 1260],
  ])("uses the lowest title to size a %i-tape board", (tapes, height) => {
    expect(archiveDesktopHeight(tapes)).toBe(height);
  });
});
