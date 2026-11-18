import { describe, expect, it } from "vitest";

import { journalRemovals } from "@/app/studio/journals/removals";
import type { TrackDraft } from "@/app/studio/journals/track-by-track";
import type { TrackByTrackItem } from "@/modules/journals";

// Issue #54: the editor names what a save takes away from a published album
// journal, from its own saved state and what it sends; the server's change
// preview lists additions and edits only (ADR 0006 § 5).

const ONE = "00000000-0000-4000-8000-000000000001";
const TWO = "00000000-0000-4000-8000-000000000002";

function track(
  trackId: string,
  title: string,
  reflection: Partial<NonNullable<TrackByTrackItem["reflection"]>> | null,
): TrackByTrackItem {
  return {
    trackId,
    title,
    number: 1,
    archived: false,
    inReferenceEdition: true,
    reflection:
      reflection === null
        ? null
        : {
            isPublished: false,
            isStillWriting: false,
            isFavourite: false,
            ratingHalfSteps: null,
            texts: {},
            publicIn: [],
            ...reflection,
          },
  };
}

function draft(patch: Partial<TrackDraft> = {}): TrackDraft {
  return {
    text: "",
    isFavourite: false,
    isStillWriting: false,
    isPublished: false,
    rating: null,
    ...patch,
  };
}

const shown = draft({ text: "[Test] shown", isPublished: true });

interface Saved {
  albumRating: number | null;
  drafts: Record<string, TrackDraft>;
}

function removals({
  published = ["en"],
  editing = "en",
  tracks = [
    track(ONE, "[Test] Song", {
      isPublished: true,
      texts: { en: "[Test] shown" },
    }),
  ],
  base = { albumRating: null, drafts: { [ONE]: shown } },
  sent = { albumRating: null, drafts: { [ONE]: shown } },
}: {
  published?: ("en" | "pt-BR")[];
  editing?: "en" | "pt-BR";
  tracks?: TrackByTrackItem[];
  base?: Saved;
  sent?: Saved;
} = {}) {
  return journalRemovals({ published, editing, tracks, base, sent });
}

describe("what a save takes away from a published album journal", () => {
  it("is nothing when nothing changes", () => {
    expect(removals()).toEqual([]);
  });

  it("names a reflection that is no longer included, in its published language", () => {
    expect(
      removals({
        sent: {
          albumRating: null,
          drafts: { [ONE]: { ...shown, isPublished: false } },
        },
      }),
    ).toEqual([
      { kind: "reflection", trackId: ONE, title: "[Test] Song", locale: "en" },
    ]);
  });

  it("names a cleared text, and blank or invisible text counts as cleared", () => {
    for (const text of [
      "",
      "   \n",
      "\u200B\u00A0",
      "\u0001",
      "\u007F",
      "\u0001\u200B",
    ]) {
      expect(
        removals({
          sent: { albumRating: null, drafts: { [ONE]: { ...shown, text } } },
        }),
        JSON.stringify(text),
      ).toEqual([
        {
          kind: "reflection",
          trackId: ONE,
          title: "[Test] Song",
          locale: "en",
        },
      ]);
    }
  });

  it("names a reflection once when it is both cleared and no longer included", () => {
    expect(
      removals({
        sent: {
          albumRating: null,
          drafts: { [ONE]: { ...shown, text: "", isPublished: false } },
        },
      }),
    ).toHaveLength(1);
  });

  it("names the album rating when it is cleared while a version is published", () => {
    expect(
      removals({
        base: { albumRating: 9, drafts: { [ONE]: shown } },
        sent: { albumRating: null, drafts: { [ONE]: shown } },
      }),
    ).toEqual([{ kind: "albumRating" }]);
  });

  it("does not count a changed rating, a changed text, or an edit as a removal", () => {
    expect(
      removals({
        base: { albumRating: 9, drafts: { [ONE]: shown } },
        sent: {
          albumRating: 4,
          drafts: {
            [ONE]: {
              ...shown,
              text: "[Test] shorter",
              rating: null,
              isFavourite: true,
            },
          },
        },
      }),
    ).toEqual([]);
  });

  it("is nothing while no version is published: drafts and private journals never ask", () => {
    expect(
      removals({
        published: [],
        base: { albumRating: 9, drafts: { [ONE]: shown } },
        sent: {
          albumRating: null,
          drafts: { [ONE]: { ...shown, text: "", isPublished: false } },
        },
      }),
    ).toEqual([]);
  });

  it("is nothing for a reflection that was not shown: not included, or without text", () => {
    expect(
      removals({
        tracks: [
          track(ONE, "[Test] Song", { texts: { en: "[Test] private" } }),
          track(TWO, "[Test] Other", { isPublished: true }),
        ],
        base: {
          albumRating: null,
          drafts: {
            [ONE]: draft({ text: "[Test] private" }),
            [TWO]: draft({ isPublished: true }),
          },
        },
        sent: {
          albumRating: null,
          drafts: {
            [ONE]: draft({ text: "" }),
            [TWO]: draft({ isPublished: false }),
          },
        },
      }),
    ).toEqual([]);
  });

  it("keeps each language apart: clearing the English text takes nothing from a published Portuguese version", () => {
    const both = track(ONE, "[Test] Song", {
      isPublished: true,
      texts: { en: "[Test] shown", "pt-BR": "[Teste] mostrada" },
    });
    // Only Portuguese is published; the editor writes English.
    expect(
      removals({
        published: ["pt-BR"],
        tracks: [both],
        sent: { albumRating: null, drafts: { [ONE]: { ...shown, text: "" } } },
      }),
    ).toEqual([]);
    // Unflagging takes it away from the published Portuguese version.
    expect(
      removals({
        published: ["pt-BR"],
        tracks: [both],
        sent: {
          albumRating: null,
          drafts: { [ONE]: { ...shown, isPublished: false } },
        },
      }),
    ).toEqual([
      {
        kind: "reflection",
        trackId: ONE,
        title: "[Test] Song",
        locale: "pt-BR",
      },
    ]);
    // Both published: unflagging takes it away from both, one item each.
    expect(
      removals({
        published: ["en", "pt-BR"],
        tracks: [both],
        sent: {
          albumRating: null,
          drafts: { [ONE]: { ...shown, isPublished: false } },
        },
      }).map((removal) => removal.kind === "reflection" && removal.locale),
    ).toEqual(["en", "pt-BR"]);
  });

  it("writes Portuguese: clearing the Portuguese text takes it from the published Portuguese version only", () => {
    const both = track(ONE, "[Test] Song", {
      isPublished: true,
      texts: { en: "[Test] shown", "pt-BR": "[Teste] mostrada" },
    });
    const ptShown = draft({ text: "[Teste] mostrada", isPublished: true });
    expect(
      removals({
        published: ["en", "pt-BR"],
        editing: "pt-BR",
        tracks: [both],
        base: { albumRating: null, drafts: { [ONE]: ptShown } },
        sent: {
          albumRating: null,
          drafts: { [ONE]: { ...ptShown, text: "" } },
        },
      }),
    ).toEqual([
      {
        kind: "reflection",
        trackId: ONE,
        title: "[Test] Song",
        locale: "pt-BR",
      },
    ]);
  });

  it("counts a text the plain editor cannot show as there, so unflagging it is a removal", () => {
    expect(
      removals({
        tracks: [
          track(ONE, "[Test] Song", { isPublished: true, texts: { en: null } }),
        ],
        base: {
          albumRating: null,
          drafts: { [ONE]: draft({ isPublished: true }) },
        },
        sent: {
          albumRating: null,
          drafts: { [ONE]: draft({ isPublished: false }) },
        },
      }),
    ).toHaveLength(1);
  });

  it("does not count adding text or including a reflection as a removal", () => {
    expect(
      removals({
        tracks: [track(ONE, "[Test] Song", { texts: {} })],
        base: { albumRating: null, drafts: { [ONE]: draft() } },
        sent: {
          albumRating: 7,
          drafts: { [ONE]: draft({ text: "[Test] new", isPublished: true }) },
        },
      }),
    ).toEqual([]);
  });
});
