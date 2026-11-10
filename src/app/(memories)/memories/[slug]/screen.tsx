import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { connection } from "next/server";
import { cache } from "react";

import {
  getPublicMemory,
  publicReadsEnabled,
  resolvePublicMemorySlug,
  type PublicMemory,
} from "@/modules/publication/public";

import {
  notFoundMetadata,
  publicPageMetadata,
} from "@/app/(public)/_components/page-metadata";
import { PublicFrame } from "@/app/(public)/_components/public-frame";
import { dictionaryFor } from "@/i18n/dictionaries";
import { OPEN_GRAPH_LOCALE, type InterfaceLocale } from "@/i18n/locales";
import { localizedHref } from "@/i18n/paths";

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

// The interface language reaches the read only as the reader's locale, which
// selects among versions that are already public (ADR 0002, D1.2; ADR 0006
// A7, item 1).

type Loaded =
  | { kind: "page"; memory: PublicMemory }
  | { kind: "redirect"; currentSlug: string }
  | { kind: "not_found" };

// Deduplicated within one request, so the metadata and the page agree.
const load = cache(
  async (slug: string, locale: InterfaceLocale): Promise<Loaded> => {
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
    const memory = await getPublicMemory(resolution.entryId, locale);
    return memory ? { kind: "page", memory } : { kind: "not_found" };
  },
);

export async function memoryMetadata(
  params: Promise<{ slug: string }>,
  locale: InterfaceLocale,
): Promise<Metadata> {
  const { slug } = await params;
  const loaded = await load(slug, locale);
  // The not-found view's metadata for anything that is not served.
  if (loaded.kind !== "page") {
    return notFoundMetadata(locale);
  }
  const { memory } = loaded;
  return publicPageMetadata({
    locale,
    path: `/memories/${memory.slug}`,
    title: `${memory.title} · refrain`,
    description: dictionaryFor(locale).memory.description,
    type: "article",
    // The writing's language, as before: the version shown.
    openGraphLocale: OPEN_GRAPH_LOCALE[memory.locale],
  });
}

export async function MemoryScreen({
  params,
  locale,
}: Readonly<{ params: Promise<{ slug: string }>; locale: InterfaceLocale }>) {
  const { slug } = await params;
  const loaded = await load(slug, locale);
  if (loaded.kind === "redirect") {
    permanentRedirect(localizedHref(locale, `/memories/${loaded.currentSlug}`));
  }
  if (loaded.kind !== "page") {
    notFound();
  }
  return (
    <PublicFrame
      locale={locale}
      path={`/memories/${loaded.memory.slug}`}
      current="memories"
      inside
    >
      <MemoryView memory={loaded.memory} locale={locale} />
    </PublicFrame>
  );
}
