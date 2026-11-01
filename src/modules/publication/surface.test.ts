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
