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
import { dictionaryFor } from "@/i18n/dictionaries";
import type { InterfaceLocale } from "@/i18n/locales";
import { localizedHref } from "@/i18n/paths";

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

// The page's lead is the owner's words (M3.8a review), in the dictionaries
// (src/i18n). The screen's own lead said the memories were dated the way they
// are remembered, while the list is ordered by publication date. Also the
// description.

function MemoryItem({
  memory,
  locale,
}: Readonly<{ memory: PublicMemoryCard; locale: InterfaceLocale }>) {
  const t = dictionaryFor(locale);
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
            href={localizedHref(locale, `/memories/${memory.slug}`)}
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
              <span className="pj-visually-hidden">{t.lists.music}</span>
              {musicLine(locale, memory.music)}
            </span>
          </p>
        ) : null}
        <p className="px-published">
          {t.archives.memoryPublished}{" "}
          <Published at={memory.publishedAt} locale={locale} />
        </p>
      </article>
    </li>
  );
}

export function MemoriesArchive({
  memories,
  locale,
}: Readonly<{
  memories: readonly PublicMemoryCard[] | null;
  locale: InterfaceLocale;
}>) {
  const t = dictionaryFor(locale);
  return (
    <ArchiveFrame
      locale={locale}
      section="memories"
      title={t.archives.memories.title}
      lead={t.archives.memories.lead}
    >
      {memories === null ? (
        <ArchiveUnavailable locale={locale} />
      ) : memories.length === 0 ? (
        <ArchiveEmpty locale={locale} />
      ) : (
        <ol className="px-memories" role="list">
          {memories.map((memory) => (
            <MemoryItem key={memory.slug} memory={memory} locale={locale} />
          ))}
        </ol>
      )}
    </ArchiveFrame>
  );
}
