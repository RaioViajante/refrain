import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { connection } from "next/server";
import { cache, Suspense } from "react";

import {
  getPublicAlbumJournal,
  listPublicAlbumArchive,
  publicReadsEnabled,
  resolvePublicAlbumJournalSlug,
  type PublicAlbumCard,
  type PublicAlbumJournal,
} from "@/modules/publication/public";

import {
  notFoundMetadata,
  publicPageMetadata,
} from "@/app/(public)/_components/page-metadata";
import { V3_CONTENT_ID, V3Frame } from "@/app/v3/frame";
import { dictionaryFor } from "@/i18n/dictionaries";
import { OPEN_GRAPH_LOCALE, type InterfaceLocale } from "@/i18n/locales";
import { localizedHref } from "@/i18n/paths";

import { JournalView, type JournalNeighbours } from "./journal-view";

// A public album journal, read through the Publication module alone. The
// status of this address was decided before the page was rendered (src/proxy.ts);
// this page resolves it again, because it must not trust that a request went
// through the proxy, and because the state can change in between. In that
// narrow case it can only stream a not-found view, never publish anything.
//
// Nothing is cached: the data is read per request after `connection()`, behind
// a Suspense boundary, so the static shell holds a loading line and no data,
// and the response is `no-store` (docs/evidence/m3-1.md).

// The interface language reaches the read only as the reader's locale, which
// selects among versions that are already public (ADR 0002, D1.2; ADR 0006
// A7, item 1).

type Loaded =
  | { kind: "page"; slug: string; journal: PublicAlbumJournal }
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
    const resolution = await resolvePublicAlbumJournalSlug(slug);
    if (resolution.outcome === "redirect") {
      return { kind: "redirect", currentSlug: resolution.currentSlug };
    }
    if (resolution.outcome !== "found") {
      return { kind: "not_found" };
    }
    const journal = await getPublicAlbumJournal(resolution.entryId, locale);
    return journal ? { kind: "page", slug, journal } : { kind: "not_found" };
  },
);

export async function albumJournalMetadata(
  params: Promise<{ slug: string }>,
  locale: InterfaceLocale,
): Promise<Metadata> {
  const { slug } = await params;
  const loaded = await load(slug, locale);
  // The same metadata as the not-found view for anything that is not served,
  // so a title or description never tells one case from another.
  if (loaded.kind !== "page") {
    return notFoundMetadata(locale);
  }
  const { journal } = loaded;
  const credits = journal.credits.map((credit) => credit.name).join(", ");
  const title = credits
    ? `${journal.album.title} · ${credits} · refrain`
    : `${journal.album.title} · refrain`;
  return publicPageMetadata({
    locale,
    path: `/albums/${loaded.slug}`,
    title,
    description:
      journal.opening?.trim() || dictionaryFor(locale).albumJournal.description,
    type: "article",
    // The writing's language, as before: the version shown.
    openGraphLocale: OPEN_GRAPH_LOCALE[journal.locale],
    openGraphUrl: false,
  });
}

export function AlbumJournalScreen({
  params,
  locale,
}: Readonly<{ params: Promise<{ slug: string }>; locale: InterfaceLocale }>) {
  // The frame waits for the journal: its languages link to the journal's own
  // address, which is known only once the journal is found to be served.
  return (
    <Suspense fallback={<AlbumJournalLoading locale={locale} />}>
      <AlbumJournal params={params} locale={locale} />
    </Suspense>
  );
}

function AlbumJournalLoading({
  locale,
}: Readonly<{ locale: InterfaceLocale }>) {
  return (
    <V3Frame locale={locale} path={null} page="album" current="albums" inside>
      <main className="wrap" id={V3_CONTENT_ID} tabIndex={-1} aria-busy="true">
        <p className="say">{dictionaryFor(locale).loading}</p>
      </main>
    </V3Frame>
  );
}

/**
 * The journals written just before and just after this one, in writing order
 * (first publication), from the public archive: one card per album, so a
 * neighbour is always a page that is served.
 */
async function neighboursOf(
  slug: string,
  locale: InterfaceLocale,
): Promise<JournalNeighbours> {
  let cards: PublicAlbumCard[];
  try {
    cards = await listPublicAlbumArchive(locale);
  } catch {
    return { before: null, after: null };
  }
  const ordered = [...cards].sort(
    (a, b) => a.publishedAt.getTime() - b.publishedAt.getTime(),
  );
  const index = ordered.findIndex(
    (card) =>
      card.slug === slug ||
      card.otherJournals.some((other) => other.slug === slug),
  );
  if (index < 0) return { before: null, after: null };
  return {
    before: ordered[index - 1] ?? null,
    after: ordered[index + 1] ?? null,
  };
}

async function AlbumJournal({
  params,
  locale,
}: Readonly<{ params: Promise<{ slug: string }>; locale: InterfaceLocale }>) {
  const { slug } = await params;
  const loaded = await load(slug, locale);
  if (loaded.kind === "redirect") {
    permanentRedirect(localizedHref(locale, `/albums/${loaded.currentSlug}`));
  }
  if (loaded.kind !== "page") {
    notFound();
  }
  const neighbours = await neighboursOf(loaded.slug, locale);
  return (
    <V3Frame
      locale={locale}
      path={`/albums/${loaded.slug}`}
      page="album"
      current="albums"
      inside
    >
      <JournalView
        journal={loaded.journal}
        locale={locale}
        neighbours={neighbours}
        slug={loaded.slug}
      />
    </V3Frame>
  );
}
