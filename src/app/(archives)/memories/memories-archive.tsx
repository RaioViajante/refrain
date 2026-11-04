import Link from "next/link";

import type { PublicMemoryCard } from "@/modules/publication/public";

import {
  ArchiveEmpty,
  ArchiveFrame,
  ArchiveUnavailable,
  Published,
} from "@/app/(archives)/_components/archive-frame";
import { musicLine } from "@/app/(archives)/_components/archive-lines";
import { NoteIcon } from "@/app/(public)/_components/note-icon";

// The Memories archive (the approved V4.4 `Memories` screen, M3.8a): an
// editorial list in the writing column, each memory its "when" in Kalam, its
// title (the only link), a short excerpt of its writing, a quiet line of its
// music with the note mark, and its publication date. It renders only what the
// Publication read model returned: the excerpt is already cut on the server,
// so the page never carries a memory's whole writing.
//
// The screen groups memories under a year in the margin; "when" is free text
// ("a date, a season, a year") and is never read as a date, so there is no
// grouping: the memories are in one list, the newest publication first.

/**
 * The page's lead, the owner's words (M3.8a review). The screen's own lead
 * said the memories were dated the way they are remembered, while the list is
 * ordered by publication date. Also the description.
 */
export const MEMORIES_LEAD = "Memories and the music woven through them.";

function MemoryItem({ memory }: Readonly<{ memory: PublicMemoryCard }>) {
  return (
    <li className="px-memory">
      <article aria-labelledby={`px-memory-${memory.slug}`}>
        {memory.rememberedWhen ? (
          <p className="px-when" lang={memory.locale}>
            {memory.rememberedWhen}
          </p>
        ) : null}
        <h2 className="px-memory-title" id={`px-memory-${memory.slug}`}>
          <Link
            className="px-memory-link"
            href={`/memories/${memory.slug}`}
            lang={memory.locale}
          >
            {memory.title}
          </Link>
        </h2>
        {memory.excerpt ? (
          <p className="px-excerpt" lang={memory.locale}>
            {memory.excerpt}
          </p>
        ) : null}
        {memory.music.length > 0 ? (
          <p className="px-music">
            <NoteIcon className="px-music-icon" size={16} />
            <span>
              <span className="pj-visually-hidden">Music: </span>
              {musicLine(memory.music)}
            </span>
          </p>
        ) : null}
        <p className="px-published">
          Published <Published at={memory.publishedAt} />
        </p>
      </article>
    </li>
  );
}

export function MemoriesArchive({
  memories,
}: Readonly<{ memories: readonly PublicMemoryCard[] | null }>) {
  return (
    <ArchiveFrame section="memories" title="Memories" lead={MEMORIES_LEAD}>
      {memories === null ? (
        <ArchiveUnavailable />
      ) : memories.length === 0 ? (
        <ArchiveEmpty />
      ) : (
        <ol className="px-memories" role="list">
          {memories.map((memory) => (
            <MemoryItem key={memory.slug} memory={memory} />
          ))}
        </ol>
      )}
    </ArchiveFrame>
  );
}
