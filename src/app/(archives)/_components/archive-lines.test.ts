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
    expect(artistCountLine(artist(1, 1))).toBe("1 album");
    expect(artistCountLine(artist(2, 2))).toBe("2 albums");
    expect(artistCountLine(artist(1, 2))).toBe("1 album · 2 journals");
    expect(artistCountLine(artist(2, 3))).toBe("2 albums · 3 journals");
  });
});

describe("the Memories archive's music line", () => {
  it("is the screen's form, and says how many more after three songs", () => {
    expect(
      musicLine([
        { title: "Holocene", artists: ["Bon Iver"] },
        { title: "Sailor Song", artists: ["Gigi Perez"] },
      ]),
    ).toBe("Holocene — Bon Iver · Sailor Song — Gigi Perez");
    expect(musicLine([{ title: "Alone", artists: [] }])).toBe("Alone");
    expect(
      musicLine([
        { title: "A", artists: ["X", "Y"] },
        { title: "B", artists: [] },
        { title: "C", artists: [] },
        { title: "D", artists: [] },
        { title: "E", artists: [] },
      ]),
    ).toBe("A — X, Y · B · C · and 2 more");
  });
});
