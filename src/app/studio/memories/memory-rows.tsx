import Link from "next/link";

import { Icon } from "@/app/studio/icons";
import { StatusMark } from "@/app/studio/status-mark";
import { formatDate } from "@/i18n/format";
import type { InterfaceLocale } from "@/i18n/locales";
import { localizedHref } from "@/i18n/paths";
import { studioWords, type StudioDictionary } from "@/i18n/studio";
import type { MemorySummary } from "@/modules/journals";

/** The songs of a memory on one line: the first few, then how many more. */
export function songsLine(
  t: StudioDictionary,
  titles: readonly string[],
): string {
  if (titles.length === 0) {
    return t.memories.noSongs;
  }
  const shown = titles.slice(0, 3).join(", ");
  return titles.length > 3
    ? t.memories.andMore(shown, titles.length - 3)
    : shown;
}

/**
 * The author's memories as Desk rows: the note icon, the title, its "when"
 * and songs, a preview of the writing, and the status. Private writing: for
 * studio pages only.
 */
export function MemoryRows({
  locale,
  memories,
  label,
  compact,
}: {
  locale: InterfaceLocale;
  memories: MemorySummary[];
  label: string;
  /** The Desk's form: no preview, with an Edit link. */
  compact?: boolean;
}) {
  const t = studioWords(locale);
  const href = (path: string) => localizedHref(locale, path);
  return (
    <ul className="studio-list" aria-label={label}>
      {memories.map((memory) => (
        <li key={memory.entryId} className="studio-row studio-entry">
          <span className="studio-thumb" aria-hidden="true">
            <Icon name="note" size={26} />
          </span>
          <span className="studio-entry-body">
            <span className="studio-row-title">
              <Link
                href={href(`/studio/memories/${memory.entryId}`)}
                lang={memory.locale}
              >
                {memory.title}
              </Link>
            </span>
            <span className="studio-meta">
              {t.memories.kind}
              {memory.rememberedWhen ? (
                <>
                  {" · "}
                  <span lang={memory.locale}>{memory.rememberedWhen}</span>
                </>
              ) : null}
              {" · "}
              {songsLine(t, memory.recordingTitles)}
            </span>
            {compact ? null : (
              <span
                className="studio-excerpt"
                lang={memory.excerpt ? memory.locale : undefined}
              >
                {memory.excerpt || t.album.nothingWritten}
              </span>
            )}
          </span>
          {compact ? (
            <span className="studio-entry-end studio-entry-end-row">
              <Link
                href={href(`/studio/memories/${memory.entryId}`)}
                className="studio-link studio-meta studio-end-link"
                aria-label={t.memories.editLabel(memory.title)}
              >
                {t.common.edit}
              </Link>
              <StatusMark locale={locale} status={memory.status} />
            </span>
          ) : (
            <span className="studio-entry-end">
              <StatusMark locale={locale} status={memory.status} />
              <span className="studio-meta">
                {t.journals.rowDates(
                  formatDate(locale, memory.createdAt),
                  formatDate(locale, memory.updatedAt),
                  memory.wordCount,
                )}
              </span>
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}
