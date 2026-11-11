import { describe, expect, it } from "vitest";

import { editionDate, editionPlace, providerTerm } from "./edition-text";

describe("editionDate", () => {
  it("words a full, a partial, and a missing date", () => {
    expect(editionDate("en", "1994-08-23")).toBe("August 23, 1994");
    expect(editionDate("en", "1996-02")).toBe("February 1996");
    expect(editionDate("en", "1994")).toBe("1994");
    expect(editionDate("en", null)).toBeNull();
  });

  it("does not move a date across midnight", () => {
    expect(editionDate("en", "1994-01-01")).toBe("January 1, 1994");
    expect(editionDate("en", "1994-12-31")).toBe("December 31, 1994");
  });
});

describe("editionDate with a value that is not a date", () => {
  it("shows it as sent, not as a nearby date", () => {
    expect(editionDate("en", "1994-13-40")).toBe("1994-13-40");
    expect(editionDate("en", "1994-00")).toBe("1994-00");
    expect(editionDate("en", "1994-02-40")).toBe("1994-02-40");
  });
});

describe("editionPlace", () => {
  it("names countries and MusicBrainz's own areas", () => {
    expect(editionPlace("en", "GB")).toBe("United Kingdom");
    expect(editionPlace("en", "US")).toBe("United States");
    expect(editionPlace("en", "XW")).toBe("Worldwide");
    expect(editionPlace("en", "XE")).toBe("Europe");
  });

  it("returns a string for inherited object keys, never a member", () => {
    for (const value of ["constructor", "__proto__", "toString"]) {
      expect(editionPlace("en", value)).toBe(value);
    }
  });

  it("returns what it cannot name, and nothing for nothing", () => {
    expect(editionPlace("en", "ZZZ")).toBe("ZZZ");
    expect(editionPlace("en", null)).toBeNull();
  });
});

describe("in Portuguese", () => {
  it("words dates, countries, and areas in the page's language", () => {
    expect(editionDate("pt-BR", "1994-08-23")).toBe("23 de agosto de 1994");
    expect(editionDate("pt-BR", "1996-02")).toBe("fevereiro de 1996");
    expect(editionDate("pt-BR", "1994")).toBe("1994");
    expect(editionDate("pt-BR", "1994-13-40")).toBe("1994-13-40");
    expect(editionPlace("pt-BR", "GB")).toBe("Reino Unido");
    expect(editionPlace("pt-BR", "XW")).toBe("Mundial");
    expect(editionPlace("pt-BR", "ZZZ")).toBe("ZZZ");
    for (const value of ["constructor", "__proto__", "toString"]) {
      expect(editionPlace("pt-BR", value)).toBe(value);
    }
  });

  it("names MusicBrainz's fixed types, and leaves anything else as sent", () => {
    expect(providerTerm("pt-BR", "Album")).toBe("Álbum");
    expect(providerTerm("pt-BR", "Live")).toBe("Ao vivo");
    expect(providerTerm("pt-BR", "Group")).toBe("Grupo");
    expect(providerTerm("pt-BR", "Something new")).toBe("Something new");
    expect(providerTerm("pt-BR", "constructor")).toBe("constructor");
    expect(providerTerm("en", "Album")).toBe("Album");
  });
});
