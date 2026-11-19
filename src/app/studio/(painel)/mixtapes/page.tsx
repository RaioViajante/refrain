import type { Metadata } from "next";

import { getDatabase } from "@/db/client";
import { requireStudio } from "@/server/auth/studio";
import { listStudioMixtapes } from "@/server/studio/mixtapes";

import { MixtapesList } from "./mixtapes-list";

export const metadata: Metadata = { title: "mixtapes" };

/** Reference: StudioMixtapes.dc.html / StudioMixtapesMobile.dc.html. */
export default async function StudioMixtapesPage() {
  await requireStudio();
  const rows = await listStudioMixtapes(getDatabase());
  return (
    <MixtapesList
      rows={rows.map((r) => ({
        id: r.id,
        number: r.number,
        slug: r.slug,
        title: r.title,
        theme: r.theme,
        published: r.status === "published",
        coverUrl: r.coverUrl,
        trackCount: r.trackCount,
        noteCount: r.noteCount,
      }))}
    />
  );
}
