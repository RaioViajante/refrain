import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { loadMixtapePage } from "@/server/site";

import { MixtapeView } from "./mixtape-view";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const page = await loadMixtapePage((await params).slug);
  if (!page) return {};
  return {
    title: page.mixtape.title,
    description: page.mixtape.description || undefined,
  };
}

export default async function MixtapePage({ params }: Props) {
  const page = await loadMixtapePage((await params).slug);
  if (!page) notFound();
  return <MixtapeView page={page} />;
}
