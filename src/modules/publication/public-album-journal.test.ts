import { describe, expect, it } from "vitest";

import { choosePublicVersion, mergeTracks } from "./public-album-journal";
import type {
  PublicLanguageVersionSummary,
  PublicTrackReflection,
} from "./queries";

const version = (
  locale: "en" | "pt-BR",
  isOriginal: boolean,
): PublicLanguageVersionSummary => ({
  locale,
  isOriginal,
  publishedAt: new Date("2026-01-01T00:00:00Z"),
});

describe("choosePublicVersion (ADR 0002, D1.2)", () => {
  it("shows the reader's language when it is visible", () => {
    expect(
      choosePublicVersion([version("pt-BR", true), version("en", false)], "en")
        ?.locale,
    ).toBe("en");
  });

  it("falls back to the original, then to what remains", () => {
    expect(choosePublicVersion([version("pt-BR", true)], "en")?.locale).toBe(
      "pt-BR",
    );
    // Only a translation is visible: it is shown, and nothing else.
    expect(choosePublicVersion([version("pt-BR", false)], "en")?.locale).toBe(
      "pt-BR",
    );
  });

  it("shows nothing when no version is visible", () => {
    expect(choosePublicVersion([], "en")).toBeNull();
  });
});

describe("mergeTracks", () => {
  const listed = [
    { track_id: "t1", title: "One", credit: null },
    { track_id: "t2", title: "Two", credit: "by someone" },
    { track_id: "t3", title: "Three", credit: null },
  ];
  const reflection = (
    trackId: string,
    overrides: Partial<PublicTrackReflection> = {},
  ): PublicTrackReflection => ({
    trackReflectionId: `r-${trackId}`,
    trackId,
    trackTitle: `Title of ${trackId}`,
    isStillWriting: false,
    isFavourite: false,
    ratingHalfSteps: null,
    body: { type: "doc" },
    ...overrides,
  });

  it("numbers the tracks in the order listed", () => {
    expect(mergeTracks(listed, []).map((t) => [t.number, t.title])).toEqual([
      [1, "One"],
      [2, "Two"],
      [3, "Three"],
    ]);
  });

  it("gives a reflection only to the track it belongs to", () => {
    const rows = mergeTracks(listed, [
      reflection("t2", { isFavourite: true, ratingHalfSteps: 9 }),
    ]);
    expect(rows.map((t) => t.reflection !== null)).toEqual([
      false,
      true,
      false,
    ]);
    expect(rows[1]!.reflection).toMatchObject({
      isFavourite: true,
      ratingHalfSteps: 9,
    });
  });

  it("shows a track without a public reflection as not written, whatever else exists", () => {
    // The read model receives only public reflections, so a track whose
    // reflection is private has none here, and the page cannot say that one
    // exists.
    const rows = mergeTracks(listed, []);
    expect(rows.every((t) => t.reflection === null)).toBe(true);
  });

  it("appends a public reflection on a recording missing from the edition", () => {
    const rows = mergeTracks(listed, [reflection("elsewhere")]);
    expect(rows).toHaveLength(4);
    expect(rows[3]).toMatchObject({
      title: "Title of elsewhere",
      number: 4,
    });
    expect(rows[3]!.reflection).not.toBeNull();
  });

  it("keeps a track's credit and no other catalog field", () => {
    const [, second] = mergeTracks(listed, []);
    expect(Object.keys(second!).sort()).toEqual([
      "credit",
      "number",
      "reflection",
      "title",
    ]);
  });
});
