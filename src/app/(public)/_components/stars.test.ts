import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ratingText, Stars } from "./stars";

/** What each star actually paints: none, a left half, or the whole star. */
function drawn(halfSteps: number): string[] {
  const html = renderToStaticMarkup(
    createElement(Stars, { halfSteps, label: "My rating", size: 22 }),
  );
  return html
    .split("<svg")
    .slice(1)
    .map((star) => {
      const ink = star.match(/<path d="([^"]+)" fill="currentColor"/)?.[1];
      if (!ink) return "empty";
      return ink.includes("L14.7 8.9") ? "full" : "half";
    });
}

describe("Stars", () => {
  it.each([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])(
    "paints %i half steps as exactly those stars",
    (halfSteps) => {
      expect(drawn(halfSteps)).toEqual(
        [2, 4, 6, 8, 10].map((whole) =>
          halfSteps >= whole
            ? "full"
            : halfSteps === whole - 1
              ? "half"
              : "empty",
        ),
      );
    },
  );

  it("always draws the outline over the fill, once per star", () => {
    const html = renderToStaticMarkup(
      createElement(Stars, { halfSteps: 5, label: "r", size: 15 }),
    );
    expect(html.match(/class="star-outline"/g)).toHaveLength(5);
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
