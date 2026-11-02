import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { connection } from "next/server";
import { cache, Suspense } from "react";

import {
  getPublicAlbumJournal,
  publicReadsEnabled,
  publicSiteOrigin,
  resolvePublicAlbumJournalSlug,
  type PublicAlbumJournal,
} from "@/modules/publication/public";

import { JournalView } from "./journal-view";

// A public album journal, read through the Publication module alone. The
// status of this address was decided before the page was rendered (src/proxy.ts);
// this page resolves it again, because it must not trust that a request went
// through the proxy, and because the state can change in between. In that
// narrow case it can only stream a not-found view, never publish anything.
//
// Nothing is cached: the data is read per request after `connection()`, behind
// a Suspense boundary, so the static shell holds a loading line and no data,
// and the response is `no-store` (docs/evidence/m3-1.md).

// The interface is English until next-intl arrives; this selects the version
// only (ADR 0002, D1.2).
const READER_LOCALE = "en";

type Loaded =
  | { kind: "page"; slug: string; journal: PublicAlbumJournal }
  | { kind: "redirect"; currentSlug: string }
  | { kind: "not_found" };

// Deduplicated within one request, so the metadata and the page agree.
const load = cache(async (slug: string): Promise<Loaded> => {
  // Runtime only, never at build time.
  await connection();
  if (!publicReadsEnabled()) {
    return { kind: "not_found" };
  }
  const resolution = await resolvePublicAlbumJournalSlug(slug);
  if (resolution.outcome === "redirect") {
    return { kind: "redirect", currentSlug: resolution.currentSlug };
  }
  if (resolution.outcome !== "found") {
    return { kind: "not_found" };
  }
  const journal = await getPublicAlbumJournal(
    resolution.entryId,
    READER_LOCALE,
  );
  return journal ? { kind: "page", slug, journal } : { kind: "not_found" };
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
  const { journal } = loaded;
  const credits = journal.credits.map((credit) => credit.name).join(", ");
  const title = credits
    ? `${journal.album.title} · ${credits} · refrain`
    : `${journal.album.title} · refrain`;
  const description = journal.opening?.trim() || "An album journal.";
  const origin = publicSiteOrigin();
  return {
    title,
    description,
    ...(origin
      ? {
          metadataBase: new URL(origin),
          alternates: { canonical: `/albums/${loaded.slug}` },
        }
      : {}),
    openGraph: {
      type: "article",
      siteName: "refrain",
      title,
      description,
      locale: journal.locale === "pt-BR" ? "pt_BR" : "en_US",
    },
  };
}

export default function AlbumJournalPage({
  params,
}: Readonly<{ params: Promise<{ slug: string }> }>) {
  return (
    <Suspense fallback={<AlbumJournalLoading />}>
      <AlbumJournal params={params} />
    </Suspense>
  );
}

function AlbumJournalLoading() {
  return (
    <main className="public-shell public-loading" id="main" aria-busy="true">
      <p>Loading…</p>
    </main>
  );
}

async function AlbumJournal({
  params,
}: Readonly<{ params: Promise<{ slug: string }> }>) {
  const { slug } = await params;
  const loaded = await load(slug);
  if (loaded.kind === "redirect") {
    permanentRedirect(`/albums/${loaded.currentSlug}`);
  }
  if (loaded.kind !== "page") {
    notFound();
  }
  return <JournalView journal={loaded.journal} />;
}
