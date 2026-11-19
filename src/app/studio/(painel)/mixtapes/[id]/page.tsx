import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { getDatabase } from "@/db/client";
import { requireStudio } from "@/server/auth/studio";
import { listImagesForStudio } from "@/server/studio/images";
import { getStudioMixtape, listStudioMixtapes } from "@/server/studio/mixtapes";
import { idSchema } from "@/server/studio/schemas";
import { listSongs } from "@/server/studio/songs";

import { Editor } from "./editor";
import type { EditorImage, EditorTape } from "./types";

export const metadata: Metadata = { title: "editar fita" };

/** Reference: StudioEditor.dc.html / StudioEditorMobile.dc.html. */
export default async function MixtapeEditorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireStudio();
  const { id } = await params;
  if (!idSchema.safeParse(id).success) notFound();
  const db = getDatabase();
  const [found, library, shelf, catalogue] = await Promise.all([
    getStudioMixtape(db, id),
    listImagesForStudio(db),
    listStudioMixtapes(db),
    listSongs(db, { sort: "musica", limit: 500 }),
  ]);
  if (!found) notFound();
  const { mixtape: m } = found;

  const image = (row: typeof found.cover): EditorImage | null => {
    if (!row) return null;
    const usage = library.find((i) => i.id === row.id)?.usage ?? [];
    return {
      id: row.id,
      url: row.url,
      alt: row.alt,
      width: row.width,
      height: row.height,
      focus: row.focus,
      treatment: row.treatment === "original" ? "original" : "mood",
      rightsConfirmed: row.rightsConfirmed,
      rightsNote: row.rightsNote,
      usage,
    };
  };

  // Form posts send line breaks as CRLF; the editor compares with LF.
  const lf = (text: string) => text.replace(/\r\n?/g, "\n");

  const tape: EditorTape = {
    id: m.id,
    number: m.number,
    published: m.status === "published",
    fields: {
      title: m.title,
      slug: m.slug,
      theme: m.theme,
      feeling: m.feeling,
      description: m.description,
      reflection: lf(m.reflection),
      pullQuote: m.pullQuote,
      pullQuoteCredit: m.pullQuoteCredit,
      detailCaption: m.detailCaption,
      playlistUrl: m.playlistUrl ?? "",
      year: m.year === null ? "" : String(m.year),
      featuredRank: m.featuredRank === null ? "" : String(m.featuredRank),
    },
    savedSlug: m.slug,
    cover: image(found.cover),
    detail: image(found.detail),
    tracks: found.tracks.map((t) => ({
      id: t.id,
      title: t.title,
      artist: t.artist,
      note: lf(t.note),
      noteSide: t.noteSide,
    })),
  };

  const themes = [
    ...new Set(shelf.map((s) => s.theme.trim()).filter(Boolean)),
  ].sort((a, b) => a.localeCompare(b, "pt-BR"));
  const holders = Object.fromEntries(
    shelf
      .filter((s) => s.featuredRank !== null && s.id !== m.id)
      .map((s) => [String(s.featuredRank), s.title]),
  );

  return (
    <Editor
      tape={tape}
      themes={themes}
      holders={holders}
      library={library.map((i) => ({
        id: i.id,
        url: i.url,
        alt: i.alt,
        treatment: i.treatment,
        focus: i.focus,
        rightsConfirmed: i.rightsConfirmed,
      }))}
      songs={catalogue.rows.map((s) => ({ title: s.title, artist: s.artist }))}
    />
  );
}
