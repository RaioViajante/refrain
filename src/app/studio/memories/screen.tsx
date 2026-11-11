import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { Suspense } from "react";

import { accessDenied } from "@/app/studio/access";
import { StudioFrame } from "@/app/studio/frame";
import { Icon } from "@/app/studio/icons";
import { MemoryRows } from "@/app/studio/memories/memory-rows";
import { StudioLoading } from "@/app/studio/studio-loading";
import { studio } from "@/app/studio/studio-words";
import type { InterfaceLocale } from "@/i18n/locales";
import { authorizeAuthor } from "@/modules/identity";
import {
  getJournalStatistics,
  getMemoryStatistics,
  listMemories,
} from "@/modules/journals";

// A fixed title: a memory's words never reach page metadata.
export function memoriesMetadata(locale: InterfaceLocale): Metadata {
  return { title: studio(locale).words.meta.memories };
}

type MemoriesProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
  locale: InterfaceLocale;
};

export function MemoriesScreen({ searchParams, locale }: MemoriesProps) {
  return (
    <Suspense fallback={<StudioLoading locale={locale} />}>
      <Memories searchParams={searchParams} locale={locale} />
    </Suspense>
  );
}

async function Memories({ searchParams, locale }: MemoriesProps) {
  const authorization = await authorizeAuthor(await headers());
  if (!authorization.ok) {
    return accessDenied(authorization.reason, locale);
  }
  const { words, href } = studio(locale);
  const w = words.memories;
  const { author } = authorization;
  const [memories, statistics, journals] = await Promise.all([
    listMemories(author),
    getMemoryStatistics(author),
    getJournalStatistics(author),
  ]);
  // Only a fixed word picks the notice; the query string is never shown.
  const { deleted } = await searchParams;

  return (
    <StudioFrame locale={locale} path="/studio/memories" current="memories">
      <h1 className="studio-title">{w.title}</h1>
      <p className="studio-lede">{w.lead}</p>
      <p>
        <Link
          href={href("/studio/memories/new")}
          className="studio-button studio-button-primary"
        >
          <Icon name="plus" />
          {words.desk.writeMemory}
        </Link>
      </p>

      {deleted === "1" ? (
        <p role="status" className="studio-panel">
          {w.movedToDeleted}
        </p>
      ) : null}

      {memories.length === 0 ? (
        <div className="studio-panel studio-empty">
          <p className="studio-section-title">{w.emptyTitle}</p>
          <p>{w.emptyBody}</p>
        </div>
      ) : (
        <>
          <p className="studio-meta" aria-label={w.totalsLabel}>
            {words.desk.memoriesSummary(
              statistics.total,
              statistics.draft,
              statistics.private,
              statistics.published,
            )}
          </p>
          <MemoryRows locale={locale} memories={memories} label={w.title} />
        </>
      )}

      <p className="studio-meta">
        <Link
          href={href("/studio/journals/deleted")}
          className="studio-link inline-flex items-center gap-2"
        >
          <Icon name="trash" size={16} />
          {words.desk.recentlyDeleted(statistics.deleted + journals.deleted)}
        </Link>
      </p>
      <p className="studio-hint" style={{ maxWidth: "62ch" }}>
        {w.publishingNote}
      </p>
    </StudioFrame>
  );
}
