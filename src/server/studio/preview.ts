// Previews for the signed-in owner: a draft tape, or the pages with draft
// texts, rendered exactly as the public pages would. Photographs still need
// confirmed rights, as on the public site. Callers authorize first; nothing
// here is ever reachable without a Studio session.
import "server-only";

import { inArray } from "drizzle-orm";

import { siteTexts } from "@/db/schema";
import type { Database } from "@/db/types";
import type {
  ArtistCount,
  MixtapePage,
  PublicImage,
} from "@/server/public-queries";

import { getStudioMixtape } from "./mixtapes";

function publicImage(
  image: {
    url: string;
    alt: string;
    width: number;
    height: number;
    focus: number;
    treatment: string;
    rightsConfirmed: boolean;
  } | null,
): PublicImage | null {
  if (!image || !image.rightsConfirmed) return null;
  return {
    url: image.url,
    alt: image.alt,
    width: image.width,
    height: image.height,
    focus: image.focus,
    treatment: image.treatment === "original" ? "original" : "mood",
  };
}

/** A tape's page as it will look once published (no neighbours). */
export async function getMixtapePreview(
  db: Database,
  id: string,
): Promise<MixtapePage | null> {
  const tape = await getStudioMixtape(db, id);
  if (!tape) return null;
  const m = tape.mixtape;
  const counts = new Map<string, number>();
  for (const t of tape.tracks)
    counts.set(t.artist, (counts.get(t.artist) ?? 0) + 1);
  const artists: ArtistCount[] = [...counts]
    .map(([artist, count]) => ({ artist, count }))
    .sort((a, b) => b.count - a.count || a.artist.localeCompare(b.artist));
  return {
    mixtape: {
      number: m.number,
      slug: m.slug,
      title: m.title,
      theme: m.theme,
      feeling: m.feeling,
      description: m.description,
      year: m.year,
      featuredRank: m.featuredRank,
      cover: publicImage(tape.cover),
      reflection: m.reflection,
      pullQuote: m.pullQuote,
      pullQuoteCredit: m.pullQuoteCredit,
      playlistUrl: m.playlistUrl,
      detailImage: publicImage(tape.detail),
      detailCaption: m.detailCaption,
      tracks: tape.tracks.map((t) => ({
        position: t.position,
        title: t.title,
        artist: t.artist,
        note: t.note,
        noteSide: t.noteSide,
      })),
    },
    noteCount: tape.tracks.filter((t) => t.note !== "").length,
    artists,
    previous: null,
    next: null,
  };
}

/** The given texts, drafts included. */
export async function getSiteTextsPreview<K extends string>(
  db: Database,
  keys: readonly K[],
): Promise<Partial<Record<K, string>>> {
  const rows = await db
    .select({ key: siteTexts.key, body: siteTexts.body })
    .from(siteTexts)
    .where(inArray(siteTexts.key, [...keys]));
  return Object.fromEntries(rows.map((r) => [r.key, r.body])) as Partial<
    Record<K, string>
  >;
}
