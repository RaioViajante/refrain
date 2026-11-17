import { describe, expect, it } from "vitest";

import { artistNameScale } from "./name-fit";

describe("artistNameScale", () => {
  it("keeps the design's sizes for names of the reference's length", () => {
    expect(artistNameScale("Jeff", "Buckley")).toBe(1);
    expect(artistNameScale("Nick", "Drake")).toBe(1);
    expect(artistNameScale("", "Björk")).toBe(1);
  });

  it("scales a longer name down until it fits above the labels", () => {
    const band = artistNameScale("Car Seat", "Headrest");
    expect(band).toBeLessThan(1);
    expect(band).toBeGreaterThanOrEqual(0.7);
    const pair = artistNameScale("Milton Nascimento & Lô", "Borges");
    expect(pair).toBeLessThan(band);
  });

  it("never grows a name, and always answers a usable scale", () => {
    const long = artistNameScale(
      "[Test] E2E An Artist Credited Under A Very Long Name",
      "Indeed",
    );
    expect(long).toBeGreaterThan(0);
    expect(long).toBeLessThan(1);
    expect(
      artistNameScale("Supercalifragilisticexpialidocious", "Word"),
    ).toBeLessThan(1);
  });
});
