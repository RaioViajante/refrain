import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { Suspense } from "react";

import { accessDenied } from "@/app/studio/access";
import { plural } from "@/app/studio/format";
import { StudioFrame } from "@/app/studio/frame";
import { Icon } from "@/app/studio/icons";
import { MemoryRows } from "@/app/studio/memories/memory-rows";
import { StudioLoading } from "@/app/studio/studio-loading";
import { authorizeAuthor } from "@/modules/identity";
import {
  getJournalStatistics,
  getMemoryStatistics,
  listMemories,
} from "@/modules/journals";

// A fixed title: a memory's words never reach page metadata.
export const metadata: Metadata = { title: "Memories · refrain" };

type MemoriesProps = {
  searchParams: Promise<{ deleted?: string | string[] }>;
};

export default function MemoriesPage({ searchParams }: MemoriesProps) {
  return (
    <Suspense fallback={<StudioLoading />}>
      <Memories searchParams={searchParams} />
    </Suspense>
  );
}

async function Memories({ searchParams }: MemoriesProps) {
  const authorization = await authorizeAuthor(await headers());
  if (!authorization.ok) {
    return accessDenied(authorization.reason);
  }
  const { author } = authorization;
  const [memories, statistics, journals] = await Promise.all([
    listMemories(author),
    getMemoryStatistics(author),
    getJournalStatistics(author),
  ]);
  // Only a fixed word picks the notice; the query string is never shown.
  const { deleted } = await searchParams;

  return (
    <StudioFrame current="memories">
      <h1 className="studio-title">Memories</h1>
      <p className="studio-lede">
        The moments songs take you back to. A memory belongs to as many songs as
        you want, in the order you choose.
      </p>
      <p>
        <Link
          href="/studio/memories/new"
          className="studio-button studio-button-primary"
        >
          <Icon name="plus" />
          Write a memory
        </Link>
      </p>

      {deleted === "1" ? (
        <p role="status" className="studio-panel">
          The memory is in Recently deleted. Its writing is kept, and you can
          restore it from there.
        </p>
      ) : null}

      {memories.length === 0 ? (
        <div className="studio-panel studio-empty">
          <p className="studio-section-title">No memories yet</p>
          <p>
            Write down a moment a song takes you back to. It begins as a draft
            that only you can see, and it is saved only when you save it.
          </p>
        </div>
      ) : (
        <>
          <p className="studio-meta" aria-label="Memory totals">
            {plural(statistics.total, "memory", "memories")}: {statistics.draft}{" "}
            {statistics.draft === 1 ? "draft" : "drafts"}, {statistics.private}{" "}
            private
            {statistics.published > 0
              ? `, ${statistics.published} published`
              : ""}
            .
          </p>
          <MemoryRows memories={memories} label="Memories" />
        </>
      )}

      <p className="studio-meta">
        <Link
          href="/studio/journals/deleted"
          className="studio-link inline-flex items-center gap-2"
        >
          <Icon name="trash" size={16} />
          Recently deleted ({statistics.deleted + journals.deleted})
        </Link>
      </p>
      <p className="studio-hint" style={{ maxWidth: "62ch" }}>
        Publishing memories isn’t available yet.
      </p>
    </StudioFrame>
  );
}
