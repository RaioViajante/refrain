// The Studio's dashboard: real counts and the work still missing, computed
// from the data (never a hand-kept list). Callers authorize first.
import "server-only";

import { asc, count, desc, eq, sql } from "drizzle-orm";

import { SITE_TEXTS } from "@/content/site-texts";
import { images, mixtapeTracks, siteTexts, songs } from "@/db/schema";
import type { Database } from "@/db/types";

import { listStudioMixtapes } from "./mixtapes";

export type Pending = { label: string; where: string; href: string };

export async function getDashboard(db: Database) {
  const credits = count(mixtapeTracks.id);
  const [
    tapes,
    [tracks],
    [catalogue],
    [photos],
    texts,
    topArtists,
    reflections,
  ] = await Promise.all([
    listStudioMixtapes(db),
    db
      .select({
        total: count(),
        notes:
          sql<number>`count(*) filter (where ${mixtapeTracks.note} <> '')`.mapWith(
            Number,
          ),
      })
      .from(mixtapeTracks),
    db.select({ songs: count() }).from(songs),
    db
      .select({
        total: count(),
        unconfirmed:
          sql<number>`count(*) filter (where not ${images.rightsConfirmed})`.mapWith(
            Number,
          ),
      })
      .from(images),
    db
      .select({ key: siteTexts.key, published: siteTexts.published })
      .from(siteTexts),
    db
      .select({ artist: songs.artist, count: credits })
      .from(mixtapeTracks)
      .innerJoin(songs, eq(songs.id, mixtapeTracks.songId))
      .groupBy(songs.artist)
      .orderBy(desc(credits), asc(songs.artist))
      .limit(8),
    db.execute<{ id: string; empty: boolean; cover: boolean }>(
      sql`select id, reflection = '' as empty, cover_image_id is null as cover from mixtapes`,
    ),
  ]);

  const published = tapes.filter((t) => t.status === "published").length;
  const withTracks = tapes.filter((t) => t.trackCount > 0).length;
  const noteLeaders = [...tapes]
    .filter((t) => t.noteCount > 0)
    .sort((a, b) => b.noteCount - a.noteCount)
    .slice(0, 2);
  const byId = new Map(reflections.rows.map((r) => [r.id, r]));

  const pending: Pending[] = [];
  for (const t of tapes) {
    const edit = `/studio/mixtapes/${t.id}`;
    const r = byId.get(t.id);
    if (t.trackCount === 0)
      pending.push({
        label: `faixas de ${t.title}`,
        where: t.title,
        href: edit,
      });
    if (r?.empty)
      pending.push({
        label: `escrever a reflexão de ${t.title}`,
        where: t.title,
        href: edit,
      });
    if (r?.cover)
      pending.push({ label: `capa de ${t.title}`, where: t.title, href: edit });
    if (t.status === "draft")
      pending.push({
        label: `publicar ${t.title}`,
        where: "rascunho",
        href: edit,
      });
  }
  if ((photos?.unconfirmed ?? 0) > 0) {
    pending.push({
      label: `confirmar os direitos de ${photos!.unconfirmed} foto${photos!.unconfirmed === 1 ? "" : "s"}`,
      where: "fotos",
      href: "/studio/fotos",
    });
  }
  const draftTexts = texts.filter((t) => !t.published).length;
  const missingTexts = Object.keys(SITE_TEXTS).length - texts.length;
  if (draftTexts > 0) {
    pending.push({
      label: `publicar ${draftTexts} texto${draftTexts === 1 ? "" : "s"} do site`,
      where: "textos",
      href: "/studio/textos",
    });
  }
  if (missingTexts > 0) {
    pending.push({
      label: `escrever ${missingTexts} texto${missingTexts === 1 ? "" : "s"} do site`,
      where: "textos",
      href: "/studio/textos",
    });
  }

  return {
    tapes,
    counts: {
      tapes: tapes.length,
      published,
      drafts: tapes.length - published,
      tracks: tracks?.total ?? 0,
      tapesWithTracks: withTracks,
      tapesWithoutTracks: tapes.length - withTracks,
      notes: tracks?.notes ?? 0,
      noteLeaders: noteLeaders.map((t) => ({
        title: t.title,
        notes: t.noteCount,
      })),
      songs: catalogue?.songs ?? 0,
      photos: photos?.total ?? 0,
      unconfirmedPhotos: photos?.unconfirmed ?? 0,
    },
    pending,
    topArtists,
  };
}
