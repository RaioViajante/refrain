import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ratingText, Stars } from "./stars";

function drawn(halfSteps: number): string[] {
  const html = renderToStaticMarkup(
    createElement(Stars, { halfSteps, label: "My rating", size: 22 }),
  );
  return [...html.matchAll(/data-fill="(\w+)"/g)].map((match) => match[1]!);
}

describe("Stars", () => {
  it.each([
    [1, ["half", "empty", "empty", "empty", "empty"]],
    [2, ["full", "empty", "empty", "empty", "empty"]],
    [5, ["full", "full", "half", "empty", "empty"]],
    [9, ["full", "full", "full", "full", "half"]],
    [10, ["full", "full", "full", "full", "full"]],
  ])("draws %i half steps as exactly those stars", (halfSteps, expected) => {
    expect(drawn(halfSteps)).toEqual(expected);
  });

  it("gives the sentence as the only accessible name", () => {
    const html = renderToStaticMarkup(
      createElement(Stars, {
        halfSteps: 9,
        label: "My rating: 4.5 out of 5",
        size: 15,
      }),
    );
    expect(html).toContain('role="img"');
    expect(html).toContain('aria-label="My rating: 4.5 out of 5"');
    expect(html.match(/<svg/g)).toHaveLength(5);
    expect(html.match(/aria-hidden="true"/g)).toHaveLength(5);
  });

  it("keeps each star's box the same size whatever it holds, so nothing shifts", () => {
    const boxes = [1, 2, 5, 9, 10].map((halfSteps) =>
      renderToStaticMarkup(
        createElement(Stars, { halfSteps, label: "r", size: 15 }),
      ).match(/width="15" height="15"/g),
    );
    for (const box of boxes) {
      expect(box).toHaveLength(5);
    }
  });

  it("writes a whole number without a decimal, and a half with one", () => {
    expect(ratingText(9)).toBe("4.5");
    expect(ratingText(10)).toBe("5");
    expect(ratingText(1)).toBe("0.5");
  });
});
