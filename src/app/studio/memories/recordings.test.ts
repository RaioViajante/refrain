import { describe, expect, it } from "vitest";

import { studioEn } from "@/i18n/studio/en";
import { studioPtBR } from "@/i18n/studio/pt-BR";

import {
  derivedArtists,
  matchRecordings,
  MAX_MATCHES,
  moveRecording,
  recordingFacts,
  type Recording,
} from "./recordings";

function recording(overrides: Partial<Recording> & { trackId: string }) {
  return {
    title: "[Test] Song",
    artists: [],
    albums: [],
    lengthMs: null,
    archived: false,
    ...overrides,
  } satisfies Recording;
}

const singer = { id: "a1", name: "[Test] Sigur Rós" };
const band = { id: "a2", name: "[Test] Band" };

describe("recordingFacts", () => {
  it("says the facts in the page's language, and the catalog's words as they are", () => {
    expect(
      recordingFacts(
        studioPtBR,
        recording({
          trackId: "t",
          artists: [singer],
          albums: ["[Test] One"],
          lengthMs: 222_000,
          archived: true,
        }),
      ),
    ).toBe(
      "Música · [Test] Sigur Rós · em [Test] One · 3:42 · arquivada no seu catálogo",
    );
  });

  it("says only what the catalog records", () => {
    expect(recordingFacts(studioEn, recording({ trackId: "t" }))).toBe("Song");
    expect(
      recordingFacts(
        studioEn,
        recording({
          trackId: "t",
          artists: [singer, band],
          albums: ["[Test] One", "[Test] Two"],
          lengthMs: 222_000,
          archived: true,
        }),
      ),
    ).toBe(
      "Song · [Test] Sigur Rós, [Test] Band · on [Test] One, [Test] Two · 3:42 · archived in your catalog",
    );
  });

  it("tells two recordings with one title apart by their facts", () => {
    const onAlbum = recording({
      trackId: "x",
      title: "[Test] Twin",
      artists: [band],
      albums: ["[Test] LP"],
    });
    const single = recording({
      trackId: "y",
      title: "[Test] Twin",
      artists: [band],
      lengthMs: 185_000,
    });
    expect(recordingFacts(studioEn, onAlbum)).not.toBe(
      recordingFacts(studioEn, single),
    );
  });
});

describe("derivedArtists", () => {
  it("lists each credited artist once, in the music's order", () => {
    expect(
      derivedArtists([
        recording({ trackId: "1", artists: [band] }),
        recording({ trackId: "2", artists: [singer, band] }),
        recording({ trackId: "3" }),
      ]),
    ).toEqual(["[Test] Band", "[Test] Sigur Rós"]);
    expect(derivedArtists([])).toEqual([]);
  });
});

describe("matchRecordings", () => {
  const choices = [
    recording({ trackId: "1", title: "[Test] Holocene", artists: [band] }),
    recording({ trackId: "2", title: "[Test] Hoppípolla", artists: [singer] }),
    recording({
      trackId: "3",
      title: "[Test] Other",
      albums: ["[Test] Holiday Album"],
    }),
  ];

  it("matches title, artist, and album words, ignoring case and accents", () => {
    expect(
      matchRecordings(choices, "sigur", new Set()).map((c) => c.trackId),
    ).toEqual(["2"]);
    expect(
      matchRecordings(choices, "HOPPIPOLLA", new Set()).map((c) => c.trackId),
    ).toEqual(["2"]);
    expect(
      matchRecordings(choices, "holiday", new Set()).map((c) => c.trackId),
    ).toEqual(["3"]);
    expect(
      matchRecordings(choices, "test band", new Set()).map((c) => c.trackId),
    ).toEqual(["1"]);
  });

  it("puts titles that start with the words first, leaves linked ones out, and stops at a few", () => {
    expect(
      matchRecordings(choices, "[test] ho", new Set()).map((c) => c.trackId),
    ).toEqual(["1", "2", "3"]);
    expect(
      matchRecordings(choices, "[test] ho", new Set(["1"])).map(
        (c) => c.trackId,
      ),
    ).toEqual(["2", "3"]);
    expect(matchRecordings(choices, "   ", new Set())).toEqual([]);
    const many = Array.from({ length: 20 }, (_, index) =>
      recording({ trackId: String(index), title: `[Test] Song ${index}` }),
    );
    expect(matchRecordings(many, "song", new Set())).toHaveLength(MAX_MATCHES);
  });
});

describe("moveRecording", () => {
  it("moves one place and never off the ends", () => {
    expect(moveRecording(["a", "b", "c"], 1, "up")).toEqual(["b", "a", "c"]);
    expect(moveRecording(["a", "b", "c"], 1, "down")).toEqual(["a", "c", "b"]);
    expect(moveRecording(["a", "b"], 0, "up")).toEqual(["a", "b"]);
    expect(moveRecording(["a", "b"], 1, "down")).toEqual(["a", "b"]);
  });
});
