import type { Metadata } from "next";

import { getDatabase } from "@/db/client";
import { requireStudio } from "@/server/auth/studio";
import { listStudioMixtapes } from "@/server/studio/mixtapes";
import { getCatalogueStats, listSongs } from "@/server/studio/songs";

import { parseSongParams } from "./params";
import { SongsScreen } from "./songs-screen";

export const metadata: Metadata = { title: "músicas" };

// Reference: StudioSongs.dc.html (1440) and StudioSongsMobile.dc.html (390).
export default async function SongsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireStudio();
  const db = getDatabase();
  const [tapes, stats, raw] = await Promise.all([
    listStudioMixtapes(db),
    getCatalogueStats(db),
    searchParams,
  ]);
  const ids = new Set(tapes.map((t) => t.id));
  const params = parseSongParams(raw, (id) => ids.has(id));
  const [list, withNotes] = await Promise.all([
    listSongs(db, {
      q: params.q || undefined,
      tape: params.fita || undefined,
      notesOnly: params.notas,
      sort: params.ordem,
      limit: params.limite,
    }),
    listSongs(db, { notesOnly: true, limit: 1 }),
  ]);

  return (
    <SongsScreen
      params={params}
      rows={list.rows}
      found={list.found}
      totals={{
        songs: stats.songs,
        artists: stats.artists,
        withNotes: withNotes.found,
        emptyTapes: tapes.filter((t) => t.trackCount === 0).length,
      }}
      top={stats.top}
      tapes={tapes.map((t) => ({ id: t.id, number: t.number, title: t.title }))}
    />
  );
}
