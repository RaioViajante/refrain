// Ratings (ADR 0002, D5.3; Product, rule 4). Pure functions.
//
// A rating is stored as an integer number of half steps:
//
//   half steps   1    2    3    4    5    6    7    8    9    10
//   stars       0.5  1.0  1.5  2.0  2.5  3.0  3.5  4.0  4.5  5.0
//
// "No rating" is stored as NULL, never as 0, so it cannot be confused with
// the lowest rating. The database enforces the same bounds with
// `rating_half_steps between 1 and 10`. Album and track ratings are separate
// columns, and neither is derived from the other or from the favourite mark.

export const MIN_RATING_HALF_STEPS = 1;
export const MAX_RATING_HALF_STEPS = 10;

/** Whether `value` is a storable rating (an integer from 1 to 10). */
export function isRatingHalfSteps(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= MIN_RATING_HALF_STEPS &&
    value <= MAX_RATING_HALF_STEPS
  );
}

/** Converts stored half steps to stars, for example 7 to 3.5. */
export function halfStepsToStars(halfSteps: number): number {
  if (!isRatingHalfSteps(halfSteps)) {
    throw new RangeError("A rating is an integer from 1 to 10 half steps.");
  }
  return halfSteps / 2;
}

/** Converts stars to stored half steps, for example 3.5 to 7. */
export function starsToHalfSteps(stars: number): number {
  const halfSteps = stars * 2;
  if (!isRatingHalfSteps(halfSteps)) {
    throw new RangeError("A rating is from 0.5 to 5 stars, in steps of 0.5.");
  }
  return halfSteps;
}
