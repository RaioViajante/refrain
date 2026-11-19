import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";

import { MixtapeView } from "@/app/mixtapes/[slug]/mixtape-view";
import { getDatabase } from "@/db/client";
import { requireStudio } from "@/server/auth/studio";
import { getMixtapePreview } from "@/server/studio/preview";
import { idSchema } from "@/server/studio/schemas";

type Props = { params: Promise<{ id: string }> };

/** The tape as it will look once published, draft or not. */
const loadPreview = cache(async (id: string) => {
  const parsed = idSchema.safeParse(id);
  return parsed.success ? getMixtapePreview(getDatabase(), parsed.data) : null;
});

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  await requireStudio();
  const page = await loadPreview((await params).id);
  return page ? { title: page.mixtape.title } : {};
}

export default async function MixtapePreview({ params }: Props) {
  await requireStudio();
  const page = await loadPreview((await params).id);
  if (!page) notFound();
  return <MixtapeView page={page} />;
}
