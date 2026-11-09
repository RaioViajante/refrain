import { describe, expect, it } from "vitest";

import { editionDate, editionPlace } from "./edition-text";

describe("editionDate", () => {
  it("words a full, a partial, and a missing date", () => {
    expect(editionDate("1994-08-23")).toBe("August 23, 1994");
    expect(editionDate("1996-02")).toBe("February 1996");
    expect(editionDate("1994")).toBe("1994");
    expect(editionDate(null)).toBeNull();
  });

  it("does not move a date across midnight", () => {
    expect(editionDate("1994-01-01")).toBe("January 1, 1994");
    expect(editionDate("1994-12-31")).toBe("December 31, 1994");
  });
});

describe("editionDate with a value that is not a date", () => {
  it("shows it as sent, not as a nearby date", () => {
    expect(editionDate("1994-13-40")).toBe("1994-13-40");
    expect(editionDate("1994-00")).toBe("1994-00");
    expect(editionDate("1994-02-40")).toBe("1994-02-40");
  });
});

describe("editionPlace", () => {
  it("names countries and MusicBrainz's own areas", () => {
    expect(editionPlace("GB")).toBe("United Kingdom");
    expect(editionPlace("US")).toBe("United States");
    expect(editionPlace("XW")).toBe("Worldwide");
    expect(editionPlace("XE")).toBe("Europe");
  });

  it("returns a string for inherited object keys, never a member", () => {
    for (const value of ["constructor", "__proto__", "toString"]) {
      expect(editionPlace(value)).toBe(value);
    }
  });

  it("returns what it cannot name, and nothing for nothing", () => {
    expect(editionPlace("ZZZ")).toBe("ZZZ");
    expect(editionPlace(null)).toBeNull();
  });
});
