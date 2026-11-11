import { describe, expect, it } from "vitest";

import {
  artistCountLine,
  musicLine,
} from "@/app/(archives)/_components/archive-lines";

// The archives' quiet lines (M3.8a), which must say exactly what the data
// says: a count of albums never reads as a discography, and a memory's music
// line names its songs in order.

describe("the Artists archive's count", () => {
  const artist = (albumCount: number, journalCount: number) => ({
    address: "a",
    name: "A",
    albumCount,
    journalCount,
  });

  it("counts albums, and journals only when there are more of them", () => {
    expect(artistCountLine("en", artist(1, 1))).toBe("1 album");
    expect(artistCountLine("en", artist(2, 2))).toBe("2 albums");
    expect(artistCountLine("en", artist(1, 2))).toBe("1 album · 2 journals");
    expect(artistCountLine("en", artist(2, 3))).toBe("2 albums · 3 journals");
  });

  it("counts in Portuguese, with the plural for every count but one", () => {
    expect(artistCountLine("pt-BR", artist(1, 1))).toBe("1 álbum");
    expect(artistCountLine("pt-BR", artist(2, 2))).toBe("2 álbuns");
    expect(artistCountLine("pt-BR", artist(1, 2))).toBe("1 álbum · 2 diários");
  });
});

describe("the Memories archive's music line", () => {
  it("is the screen's form, and says how many more after three songs", () => {
    expect(
      musicLine("en", [
        { title: "Holocene", artists: ["Bon Iver"] },
        { title: "Sailor Song", artists: ["Gigi Perez"] },
      ]),
    ).toBe("Holocene — Bon Iver · Sailor Song — Gigi Perez");
    expect(musicLine("en", [{ title: "Alone", artists: [] }])).toBe("Alone");
    expect(
      musicLine("en", [
        { title: "A", artists: ["X", "Y"] },
        { title: "B", artists: [] },
        { title: "C", artists: [] },
        { title: "D", artists: [] },
        { title: "E", artists: [] },
      ]),
    ).toBe("A — X, Y · B · C · and 2 more");
  });

  it("says how many more in Portuguese, and never translates a title", () => {
    expect(
      musicLine("pt-BR", [
        { title: "A", artists: ["X"] },
        { title: "B", artists: [] },
        { title: "C", artists: [] },
        { title: "D", artists: [] },
      ]),
    ).toBe("A — X · B · C · e mais 1");
  });
});
