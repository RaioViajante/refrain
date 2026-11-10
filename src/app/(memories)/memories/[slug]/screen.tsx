import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { connection } from "next/server";
import { cache } from "react";

import {
  getPublicMemory,
  publicReadsEnabled,
  publicSiteOrigin,
  resolvePublicMemorySlug,
  type PublicMemory,
} from "@/modules/publication/public";

import { MemoryView } from "./memory-view";

// A public memory (M3.7), read through the Publication module's reading entry
// point alone. A memory is public only while one of its language versions is
// published and the entry is not deleted (the publication predicate); a
// draft, private, deleted, restored, or unpublished memory answers exactly as
// an unknown address does. The status was decided before the page rendered
// (src/proxy.ts); this page resolves the address again, because it must not
// trust that a request went through the proxy, and because the state can
// change in between. In that narrow case it can only answer not found or
// redirect, never show anything.
//
// The page is rendered on the server per request, in one pass, and sent
// complete (`instant = false`, as the Home and the artist pages are): it reads
// the same without client JavaScript, and the build prerenders nothing of it.
// Nothing is cached, and every response is `no-store` (next.config.ts).

// The interface is English until next-intl arrives; this selects the version
// only (ADR 0002, D1.2).
const READER_LOCALE = "en";

type Loaded =
  | { kind: "page"; memory: PublicMemory }
  | { kind: "redirect"; currentSlug: string }
  | { kind: "not_found" };

// Deduplicated within one request, so the metadata and the page agree.
const load = cache(async (slug: string): Promise<Loaded> => {
  // Runtime only, never at build time.
  await connection();
  if (!publicReadsEnabled()) {
    return { kind: "not_found" };
  }
  const resolution = await resolvePublicMemorySlug(slug);
  if (resolution.outcome === "redirect") {
    return { kind: "redirect", currentSlug: resolution.currentSlug };
  }
  if (resolution.outcome !== "found") {
    return { kind: "not_found" };
  }
  const memory = await getPublicMemory(resolution.entryId, READER_LOCALE);
  return memory ? { kind: "page", memory } : { kind: "not_found" };
});

const NOT_FOUND_METADATA: Metadata = {
  title: "Not found · refrain",
  description: "A personal music journal.",
};

export async function generateMetadata({
  params,
}: Readonly<{ params: Promise<{ slug: string }> }>): Promise<Metadata> {
  const { slug } = await params;
  const loaded = await load(slug);
  // The same metadata as the not-found view for anything that is not served,
  // so a title or description never tells one case from another.
  if (loaded.kind !== "page") {
    return NOT_FOUND_METADATA;
  }
  const { memory } = loaded;
  const title = `${memory.title} · refrain`;
  // What the page is, in the site's own words: nothing the author did not
  // write, and no excerpt of the writing.
  const description = "A memory in a personal music journal.";
  const origin = publicSiteOrigin();
  return {
    title,
    description,
    ...(origin
      ? {
          metadataBase: new URL(origin),
          alternates: { canonical: `/memories/${memory.slug}` },
        }
      : {}),
    openGraph: {
      type: "article",
      siteName: "refrain",
      title,
      description,
      locale: memory.locale === "pt-BR" ? "pt_BR" : "en_US",
      ...(origin ? { url: `/memories/${memory.slug}` } : {}),
    },
  };
}

export default async function MemoryPage({
  params,
}: Readonly<{ params: Promise<{ slug: string }> }>) {
  const { slug } = await params;
  const loaded = await load(slug);
  if (loaded.kind === "redirect") {
    permanentRedirect(`/memories/${loaded.currentSlug}`);
  }
  if (loaded.kind !== "page") {
    notFound();
  }
  return <MemoryView memory={loaded.memory} />;
}
