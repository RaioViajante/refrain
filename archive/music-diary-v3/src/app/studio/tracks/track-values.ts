// The values of the track form, and how a track's stored fields become them.
// Kept apart from the form itself, which is a Client Component: a server page
// cannot call a function (or read a value) exported from a "use client"
// module, and calling one made the track pages fail to render.
import type { CreditRow } from "@/app/studio/artist-rows";
import { formatDuration } from "@/app/studio/format";

export interface TrackValues {
  title: string;
  length: string;
  credit: string;
  mbRecordingId: string;
  artists: CreditRow[];
  albumId: string;
}

export function initialTrackValues(track?: {
  title: string;
  lengthMs: number | null;
  credit: string | null;
  mbRecordingId: string | null;
  artistIds: string[];
}): TrackValues {
  return {
    title: track?.title ?? "",
    length: formatDuration(track?.lengthMs ?? null),
    credit: track?.credit ?? "",
    mbRecordingId: track?.mbRecordingId ?? "",
    artists: (track?.artistIds ?? []).map((artistId) => ({
      artistId,
      creditedAs: "",
    })),
    albumId: "",
  };
}
