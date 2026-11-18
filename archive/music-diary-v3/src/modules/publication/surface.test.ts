import { describe, expect, it } from "vitest";

import {
  applyChange,
  exposureDelta,
  publicAtoms,
  publicVersionsStayPublishable,
  samePublicAtoms,
  type EntrySurface,
} from "./surface";

// The pure rules of ADR 0006 § 5: no database, no confirmation.

const doc = (text: string) => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});

function surface(overrides: Partial<EntrySurface> = {}): EntrySurface {
  return {
    entryId: "e",
    kind: "album_journal",
    deleted: false,
    version: 1,
    updatedAt: "2026-01-01T00:00:00.000000",
    nowMs: 0,
    versions: [
      {
        locale: "en",
        isOriginal: true,
        status: "published",
        updatedAt: "2026-01-01T00:00:00.000000",
        title: null,
        opening: "[Test] Opening",
        marginNote: null,
        body: doc("[Test] Body"),
        bodyText: "[Test] Body",
      },
    ],
    albumRating: 6,
    reflections: [
      {
        trackId: "t1",
        isPublished: true,
        isStillWriting: false,
        isFavourite: false,
        ratingHalfSteps: null,
        texts: { en: doc("[Test] Reflection") },
      },
    ],
    memory: null,
    ...overrides,
  };
}

describe("applyChange", () => {
  it("does not mutate the state it is given", () => {
    const before = surface();
    const snapshot = JSON.stringify(before);
    applyChange(before, {
      albumRating: 2,
      reflections: [{ trackId: "t1", isFavourite: true, texts: { en: null } }],
    });
    expect(JSON.stringify(before)).toBe(snapshot);
  });

  it("creates a reflection that is not there, with the defaults", () => {
    const after = applyChange(surface(), {
      reflections: [{ trackId: "t2", isFavourite: true }],
    });
    expect(after.reflections.find((r) => r.trackId === "t2")).toEqual({
      trackId: "t2",
      isPublished: false,
      isStillWriting: false,
      isFavourite: true,
      ratingHalfSteps: null,
      texts: {},
    });
  });
});

describe("the exposure delta", () => {
  const delta = (change: Parameters<typeof applyChange>[1]) =>
    exposureDelta(
      publicAtoms(surface()),
      publicAtoms(applyChange(surface(), change)),
    );

  it("is empty for a save that changes nothing a reader sees", () => {
    expect(delta({ albumRating: 6 })).toEqual([]);
    expect(
      delta({
        reflections: [
          {
            trackId: "t1",
            texts: { "pt-BR": { document: doc("x"), text: "x" } },
          },
        ],
      }),
    ).toEqual([]);
  });

  it("counts a shorter text and a cleared field as edits", () => {
    expect(
      delta({
        version: { locale: "en", body: { document: doc("S"), text: "S" } },
      }),
    ).toMatchObject([{ atom: "version|en|body", kind: "edited" }]);
    expect(delta({ version: { locale: "en", opening: null } })).toMatchObject([
      {
        atom: "version|en|opening",
        kind: "edited",
        before: "[Test] Opening",
        after: null,
      },
    ]);
  });

  it("does not count a removal", () => {
    expect(delta({ albumRating: null })).toEqual([]);
    expect(
      delta({ reflections: [{ trackId: "t1", isPublished: false }] }),
    ).toEqual([]);
    expect(
      delta({ reflections: [{ trackId: "t1", texts: { en: null } }] }),
    ).toEqual([]);
  });

  it("counts an addition in a stable order", () => {
    const keys = delta({
      albumRating: 7,
      reflections: [{ trackId: "t1", isFavourite: true }],
    }).map((change) => [change.atom, change.kind]);
    expect(keys).toEqual([
      ["albumRating", "edited"],
      ["reflection|t1|en|favourite", "edited"],
    ]);
  });
});

describe("public atoms", () => {
  it("are empty for a deleted entry and for a journal with no published version", () => {
    expect(publicAtoms(surface({ deleted: true })).size).toBe(0);
    const draft = surface();
    draft.versions[0]!.status = "draft";
    expect(publicAtoms(draft).size).toBe(0);
  });

  it("compare by canonical value, not by key order", () => {
    const a = surface();
    const b = surface();
    b.versions[0]!.body = {
      content: (doc("[Test] Body") as { content: unknown }).content,
      type: "doc",
    };
    expect(samePublicAtoms(a, b)).toBe(true);
  });

  it("keep a public version publishable only while it has opening or body text", () => {
    const after = applyChange(surface(), {
      version: {
        locale: "en",
        opening: null,
        body: { document: null, text: "  " },
      },
    });
    expect(
      publicVersionsStayPublishable(after, {
        version: {
          locale: "en",
          opening: null,
          body: { document: null, text: "  " },
        },
      }),
    ).toBe(false);
  });
});

// M3.7: a memory's own atoms. "A music link is the atom (link id, relative
// rank)" (ADR 0006 § 5): one atom per link, and one per ordered pair.
describe("a memory's public atoms", () => {
  function memory(
    music: string[],
    rememberedWhen: string | null = "[Test] a summer",
    status: "published" | "private" = "published",
  ): EntrySurface {
    return surface({
      kind: "memory",
      albumRating: null,
      reflections: [],
      memory: {
        rememberedWhen,
        music: music.map((id) => `track:${id}` as const),
      },
      versions: [
        {
          locale: "en",
          isOriginal: true,
          status,
          updatedAt: "2026-01-01T00:00:00.000000",
          title: "[Test] A memory",
          opening: null,
          marginNote: null,
          body: doc("[Test] Writing"),
          bodyText: "[Test] Writing",
        },
      ],
    });
  }
  const change = (
    before: EntrySurface,
    proposed: Parameters<typeof applyChange>[1],
  ) =>
    exposureDelta(
      publicAtoms(before),
      publicAtoms(applyChange(before, proposed)),
    );

  it("hold the title, the writing, the when, each link, and each ordered pair", () => {
    const atoms = publicAtoms(memory(["a", "b", "c"]));
    expect([...atoms.keys()].sort()).toEqual([
      "memory|link|track:a",
      "memory|link|track:b",
      "memory|link|track:c",
      "memory|order|track:a|track:b",
      "memory|order|track:a|track:c",
      "memory|order|track:b|track:c",
      "memory|when",
      "version|en|body",
      "version|en|marginNote",
      "version|en|opening",
      "version|en|title",
    ]);
    expect(atoms.get("memory|when")).toBe("[Test] a summer");
  });

  it("are empty while the memory is not published, or deleted", () => {
    expect(publicAtoms(memory(["a"], "x", "private")).size).toBe(0);
    expect(publicAtoms({ ...memory(["a"]), deleted: true }).size).toBe(0);
  });

  it("leave out a blank when, as the page shows none", () => {
    expect(publicAtoms(memory(["a"], "  ")).has("memory|when")).toBe(false);
    expect(publicAtoms(memory(["a"], null)).has("memory|when")).toBe(false);
  });

  it("treat removing a link, from anywhere, as a strict reduction", () => {
    const before = memory(["a", "b", "c"]);
    for (const kept of [["b", "c"], ["a", "c"], ["a", "b"], []]) {
      const after = publicAtoms(
        applyChange(before, { memory: { trackIds: kept } }),
      );
      const was = publicAtoms(before);
      expect(
        [...after].every(
          ([key, value]) => was.has(key) && was.get(key) === value,
        ),
        kept.join(","),
      ).toBe(true);
      expect(change(before, { memory: { trackIds: kept } })).toEqual([]);
    }
  });

  it("treat clearing the when as a removal, and changing it as an edit", () => {
    const before = memory(["a"]);
    expect(change(before, { memory: { rememberedWhen: null } })).toEqual([]);
    expect(
      change(before, { memory: { rememberedWhen: "[Test] winter" } }),
    ).toMatchObject([
      {
        atom: "memory|when",
        kind: "edited",
        subject: { type: "memoryWhen" },
        before: "[Test] a summer",
        after: "[Test] winter",
      },
    ]);
    expect(
      change(memory(["a"], null), { memory: { rememberedWhen: "[Test] x" } }),
    ).toMatchObject([{ atom: "memory|when", kind: "added" }]);
  });

  it("counts a link added as an addition, with its order", () => {
    expect(
      change(memory(["a"]), { memory: { trackIds: ["a", "b"] } }).map((c) => [
        c.atom,
        c.kind,
        c.subject.type,
      ]),
    ).toEqual([
      ["memory|link|track:b", "added", "memoryLink"],
      ["memory|order|track:a|track:b", "added", "memoryOrder"],
    ]);
  });

  it("counts a reorder as an addition, even when nothing is added", () => {
    expect(
      change(memory(["a", "b", "c"]), {
        memory: { trackIds: ["b", "a", "c"] },
      }),
    ).toMatchObject([
      {
        atom: "memory|order|track:b|track:a",
        kind: "added",
        subject: {
          type: "memoryOrder",
          first: "track:b",
          second: "track:a",
        },
      },
    ]);
  });

  it("does not count an unchanged list", () => {
    expect(
      change(memory(["a", "b"]), { memory: { trackIds: ["a", "b"] } }),
    ).toEqual([]);
  });

  it("counts a new title, even a shorter one, as an edit", () => {
    expect(
      change(memory(["a"]), { version: { locale: "en", title: "[Test]" } }),
    ).toMatchObject([
      { atom: "version|en|title", kind: "edited", after: "[Test]" },
    ]);
  });

  it("keep a public memory publishable only with a title and writing", () => {
    const blankBody = {
      version: {
        locale: "en" as const,
        body: { document: null, text: "" },
      },
    };
    expect(
      publicVersionsStayPublishable(
        applyChange(memory(["a"]), blankBody),
        blankBody,
      ),
    ).toBe(false);
    const blankTitle = { version: { locale: "en" as const, title: " " } };
    expect(
      publicVersionsStayPublishable(
        applyChange(memory(["a"]), blankTitle),
        blankTitle,
      ),
    ).toBe(false);
    const fine = { version: { locale: "en" as const, title: "[Test] B" } };
    expect(
      publicVersionsStayPublishable(applyChange(memory(["a"]), fine), fine),
    ).toBe(true);
  });

  it("does not mutate the memory it is given", () => {
    const before = memory(["a", "b"]);
    const snapshot = JSON.stringify(before);
    applyChange(before, {
      memory: { trackIds: ["b"], rememberedWhen: null },
      version: { locale: "en", title: "[Test] New" },
    });
    expect(JSON.stringify(before)).toBe(snapshot);
  });
});
