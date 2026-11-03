import Link from "next/link";

import { formatDate, plural } from "@/app/studio/format";
import { Icon } from "@/app/studio/icons";
import { StatusMark } from "@/app/studio/status-mark";
import type { MemorySummary } from "@/modules/journals";

/** The songs of a memory on one line: the first few, then how many more. */
export function songsLine(titles: readonly string[]): string {
  if (titles.length === 0) {
    return "No songs yet";
  }
  const shown = titles.slice(0, 3).join(", ");
  return titles.length > 3 ? `${shown}, and ${titles.length - 3} more` : shown;
}

/**
 * The author's memories as Desk rows: the note icon, the title, its "when"
 * and songs, a preview of the writing, and the status. Private writing: for
 * studio pages only.
 */
export function MemoryRows({
  memories,
  label,
  compact,
}: {
  memories: MemorySummary[];
  label: string;
  /** The Desk's form: no preview, with an Edit link. */
  compact?: boolean;
}) {
  return (
    <ul className="studio-list" aria-label={label}>
      {memories.map((memory) => (
        <li key={memory.entryId} className="studio-row studio-entry">
          <span className="studio-thumb" aria-hidden="true">
            <Icon name="note" size={26} />
          </span>
          <span className="studio-entry-body">
            <span className="studio-row-title">
              <Link href={`/studio/memories/${memory.entryId}`} lang="en">
                {memory.title}
              </Link>
            </span>
            <span className="studio-meta">
              Memory
              {memory.rememberedWhen ? (
                <>
                  {" · "}
                  <span lang={memory.locale}>{memory.rememberedWhen}</span>
                </>
              ) : null}
              {" · "}
              {songsLine(memory.recordingTitles)}
            </span>
            {compact ? null : (
              <span
                className="studio-excerpt"
                lang={memory.excerpt ? memory.locale : undefined}
              >
                {memory.excerpt || "Nothing written yet"}
              </span>
            )}
          </span>
          {compact ? (
            <span className="studio-entry-end studio-entry-end-row">
              <Link
                href={`/studio/memories/${memory.entryId}`}
                className="studio-link studio-meta studio-end-link"
                aria-label={`Edit the memory ${memory.title}`}
              >
                Edit
              </Link>
              <StatusMark status={memory.status} />
            </span>
          ) : (
            <span className="studio-entry-end">
              <StatusMark status={memory.status} />
              <span className="studio-meta">
                started {formatDate(memory.createdAt)} · edited{" "}
                {formatDate(memory.updatedAt)} ·{" "}
                {plural(memory.wordCount, "word")}
              </span>
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}
