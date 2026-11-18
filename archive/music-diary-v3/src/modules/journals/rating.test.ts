import { describe, expect, it } from "vitest";

import {
  halfStepsToStars,
  isRatingHalfSteps,
  MAX_RATING_HALF_STEPS,
  MIN_RATING_HALF_STEPS,
  starsToHalfSteps,
} from "./rating";

describe("rating half steps", () => {
  it("maps every half step from 0.5 to 5 stars", () => {
    const pairs = Array.from({ length: 10 }, (_, index) => [
      index + 1,
      (index + 1) / 2,
    ]);
    for (const [halfSteps, stars] of pairs) {
      expect(halfStepsToStars(halfSteps!)).toBe(stars);
      expect(starsToHalfSteps(stars!)).toBe(halfSteps);
    }
    expect([MIN_RATING_HALF_STEPS, MAX_RATING_HALF_STEPS]).toEqual([1, 10]);
  });

  it.each([0, 11, -1, 1.5, Number.NaN, null, undefined, "5"])(
    "does not accept %j as a stored rating",
    (value) => {
      expect(isRatingHalfSteps(value)).toBe(false);
    },
  );

  it("keeps 'No rating' distinct from the lowest rating", () => {
    // No rating is NULL, never 0; 0 stars is not a rating.
    expect(() => starsToHalfSteps(0)).toThrow(RangeError);
    expect(starsToHalfSteps(0.5)).toBe(1);
  });

  it.each([0.25, 5.5, 6, -0.5])("rejects %d stars", (stars) => {
    expect(() => starsToHalfSteps(stars)).toThrow(RangeError);
  });

  it("rejects converting an invalid stored value", () => {
    expect(() => halfStepsToStars(0)).toThrow(RangeError);
    expect(() => halfStepsToStars(11)).toThrow(RangeError);
  });
});
