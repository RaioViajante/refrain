import { describe, expect, it } from "vitest";

import { rankAlbumResults, type RankableAlbum } from "./music-ranking";

// Each list is what MusicBrainz returned, in its order (top results, observed
// on 2026-11-09). The rule names no album or artist, so these are its tests
// across different searches, including ones it must leave alone.

const album = (
  title: string,
  credit: string,
  primaryType: string | null = "Album",
  secondaryTypes: string[] = [],
): RankableAlbum => ({ title, credit, primaryType, secondaryTypes });

const titles = (query: string, albums: RankableAlbum[]) =>
  rankAlbumResults(query, albums).map(
    (result) =>
      `${result.title} (${[result.primaryType, ...result.secondaryTypes].join(", ")})`,
  );

describe("rankAlbumResults", () => {
  it("puts the album whose title and artist are what was typed first, before its single", () => {
    expect(
      titles("grace jeff buckley", [
        album("Jeff Buckley Live", "Jeff Buckley", null, ["Live"]),
        album("Grace", "Jeff Buckley", "Single"),
        album("Grace", "Jeff Buckley"),
        album("The Jeff Buckley Collection", "Jeff Buckley", "Album", [
          "Compilation",
        ]),
      ]).slice(0, 3),
    ).toEqual([
      "Grace (Album)",
      "Grace (Single)",
      "Jeff Buckley Live (, Live)",
    ]);
  });

  it("corrects the same pattern for another album and artist", () => {
    const blue = titles("blue joni mitchell", [
      album("Joni Mitchell", "Joni Mitchell", "Album", ["Compilation"]),
      album("Joni Mitchell Blue Songs", "Joni Mitchell", "Album", ["Live"]),
      album("Blue", "Joni Mitchell"),
    ]);
    expect(blue[0]).toBe("Blue (Album)");
  });

  it("finds a short title that the provider ranks far down", () => {
    const fillers = Array.from({ length: 11 }, (_, index) =>
      album(`Like A Kid ${index}`, `Band ${index}`, "EP"),
    );
    expect(titles("kid a", [...fillers, album("Kid A", "Radiohead")])[0]).toBe(
      "Kid A (Album)",
    );
  });

  it("leaves a typed live album first: its own title is what was typed", () => {
    expect(
      titles("jeff buckley live", [
        album("Jeff Buckley Live", "Jeff Buckley", null, ["Live"]),
        album("The Jeff Buckley Collection", "Jeff Buckley", "Album", [
          "Compilation",
        ]),
      ])[0],
    ).toBe("Jeff Buckley Live (, Live)");
  });

  it("keeps the provider's order when nothing is a complete match", () => {
    const provider = [
      album("Paper Moons", "One"),
      album("Moon Paper Songs", "Two", "EP"),
      album("Moon", "Three", "Single"),
    ];
    expect(rankAlbumResults("paper moon", provider)).toEqual(provider);
  });

  it("keeps the provider's order among equally complete albums", () => {
    const provider = [
      album("Grace", "Grace"),
      album("Grace", "Grace McCune"),
      album("Grace", "Someone Else"),
    ];
    expect(rankAlbumResults("grace", provider)).toEqual(provider);
  });

  it("ranks a studio album over an EP over a single over a live or compilation album", () => {
    expect(
      titles("twin", [
        album("Twin", "A", "Album", ["Live"]),
        album("Twin", "B", "Single"),
        album("Twin", "C", "EP"),
        album("Twin", "D"),
      ]),
    ).toEqual([
      "Twin (Album)",
      "Twin (EP)",
      "Twin (Single)",
      "Twin (Album, Live)",
    ]);
  });

  it("ignores case, accents, and punctuation, and treats & as and", () => {
    expect(
      titles("LEMONADE BEYONCE", [
        album("Lemonade Stand", "Anyone"),
        album("Lemonade", "Beyoncé"),
      ])[0],
    ).toBe("Lemonade (Album)");
    expect(
      titles("carrie and lowell sufjan stevens", [
        album("Carrie Songs", "Sufjan Stevens"),
        album("Carrie & Lowell", "Sufjan Stevens"),
      ])[0],
    ).toBe("Carrie & Lowell (Album)");
  });

  it("does not treat a title in another script as empty", () => {
    expect(
      titles("кино", [album("Другое", "Кто-то"), album("Кино", "Группа")])[0],
    ).toBe("Кино (Album)");
  });

  it("treats a provider type outside its vocabulary as any other type", () => {
    for (const odd of ["constructor", "__proto__", "toString"]) {
      expect(
        titles("twin", [album("Twin", "A", odd), album("Twin", "B")])[0],
      ).toBe("Twin (Album)");
    }
  });

  it("drops nothing and does not change the rows", () => {
    const provider = [album("A", "B"), album("C", "D")];
    const ranked = rankAlbumResults("c d", provider);
    expect(ranked).toHaveLength(2);
    expect(ranked).toContain(provider[0]);
    expect(ranked).toContain(provider[1]);
  });
});
