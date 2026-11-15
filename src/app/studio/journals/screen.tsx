import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { Suspense } from "react";
import { z } from "zod";

import { accessDenied } from "@/app/studio/access";
import { StudioFrame } from "@/app/studio/frame";
import { StudioLoading } from "@/app/studio/studio-loading";
import { studio } from "@/app/studio/studio-words";
import { formatDate } from "@/i18n/format";
import type { InterfaceLocale } from "@/i18n/locales";
import { v3StringsFor } from "@/i18n/v3";
import { authorizeAuthor } from "@/modules/identity";
import {
  getJournalStatistics,
  getMemoryStatistics,
  listAlbumJournals,
  listMemories,
  type VisibilityStatus,
} from "@/modules/journals";

// A fixed title: a journal's words never reach page metadata.
export function journalsMetadata(locale: InterfaceLocale): Metadata {
  return { title: studio(locale).words.meta.journals };
}

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export function JournalsScreen({
  locale,
  searchParams,
}: {
  locale: InterfaceLocale;
  searchParams: SearchParams;
}) {
  return (
    <Suspense fallback={<StudioLoading locale={locale} />}>
      <Library locale={locale} searchParams={searchParams} />
    </Suspense>
  );
}

// The Library's filters, from the address only (no state anywhere else). An
// unknown value is the default, never an error: the address is untrusted.
const KINDS = ["all", "album", "memory"] as const;
const STATUSES = ["all", "draft", "private", "published"] as const;
const filters = z.object({
  type: z.enum(KINDS).catch("all"),
  status: z.enum(STATUSES).catch("all"),
  q: z
    .string()
    .transform((value) => value.replace(/\s+/g, " ").trim().slice(0, 200))
    .catch(""),
});
type Filters = z.infer<typeof filters>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

interface LibraryRow {
  key: string;
  kind: "album" | "memory";
  title: string;
  /** The album's artists, or the memory's first song. */
  context: string | null;
  locale: string;
  status: VisibilityStatus;
  updatedAt: Date;
  view: string;
  edit: string;
  editLabel: string;
}

async function Library({
  locale,
  searchParams,
}: {
  locale: InterfaceLocale;
  searchParams: SearchParams;
}) {
  // The authorization boundary comes first: nothing below runs otherwise.
  const authorization = await authorizeAuthor(await headers());
  if (!authorization.ok) {
    return accessDenied(authorization.reason, locale);
  }
  const params = await searchParams;
  const chosen: Filters = filters.parse({
    type: first(params.type),
    status: first(params.status),
    q: first(params.q),
  });
  const speech = studio(locale);
  const { words, href } = speech;
  const w = words.journals;
  const v3 = v3StringsFor(locale).library;
  const { author } = authorization;
  const [journals, memories, statistics, memoryStatistics] = await Promise.all([
    listAlbumJournals(author),
    listMemories(author),
    getJournalStatistics(author),
    getMemoryStatistics(author),
  ]);

  // Every live entry, newest edit first; Recently deleted is the Bin.
  const everything: LibraryRow[] = [
    ...journals.map((journal): LibraryRow => ({
      key: journal.entryId,
      kind: "album",
      title: journal.albumTitle,
      context: journal.artistNames || null,
      locale: journal.locale,
      status: journal.status,
      updatedAt: journal.updatedAt,
      view: href(`/studio/journals/${journal.entryId}`),
      edit: href(`/studio/journals/${journal.entryId}/edit`),
      editLabel: words.desk.editJournalAbout(journal.albumTitle),
    })),
    ...memories.map((memory): LibraryRow => ({
      key: memory.entryId,
      kind: "memory",
      title: memory.title,
      context: memory.recordingTitles[0] ?? null,
      locale: memory.locale,
      status: memory.status,
      updatedAt: memory.updatedAt,
      view: href(`/studio/memories/${memory.entryId}`),
      edit: href(`/studio/memories/${memory.entryId}`),
      editLabel: `${v3.edit}: ${memory.title}`,
    })),
  ].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());

  const needle = chosen.q.toLocaleLowerCase(locale);
  const shown = everything.filter(
    (row) =>
      (chosen.type === "all" || row.kind === chosen.type) &&
      (chosen.status === "all" || row.status === chosen.status) &&
      (needle === "" ||
        `${row.title} ${row.context ?? ""}`
          .toLocaleLowerCase(locale)
          .includes(needle)),
  );
  const binCount = statistics.deleted + memoryStatistics.deleted;

  // A filter link keeps the other filters and the search.
  const linkTo = (change: Partial<Filters>) => {
    const next = { ...chosen, ...change };
    const query = new URLSearchParams();
    if (next.type !== "all") query.set("type", next.type);
    if (next.status !== "all") query.set("status", next.status);
    if (next.q) query.set("q", next.q);
    const text = `${query}`;
    return href(`/studio/journals${text ? `?${text}` : ""}`);
  };
  const kindLabel = { album: v3.k_album, memory: v3.k_memory };

  return (
    <StudioFrame
      locale={locale}
      path="/studio/journals"
      current="journals"
      layout="wide"
    >
      <div className="lib-head">
        <div>
          <h1 className="t1">{v3.s1}</h1>
          <p className="sub">{v3.s2}</p>
        </div>
        <Link href={href("/studio/journals/new")} className="btn pri">
          + {v3.s3}
        </Link>
      </div>

      <div className="filters">
        <form
          action={href("/studio/journals")}
          method="get"
          role="search"
          className="lib-search"
        >
          {chosen.type !== "all" ? (
            <input type="hidden" name="type" value={chosen.type} />
          ) : null}
          {chosen.status !== "all" ? (
            <input type="hidden" name="status" value={chosen.status} />
          ) : null}
          <label htmlFor="library-search" className="studio-sr-only">
            {w.searchLabel}
          </label>
          <input
            id="library-search"
            className="in"
            type="search"
            name="q"
            defaultValue={chosen.q}
            placeholder={v3.s4}
            maxLength={200}
          />
          <button type="submit" className="studio-sr-only">
            {w.searchSubmit}
          </button>
        </form>
        <nav className="seg" aria-label={v3.s6}>
          {(
            [
              ["all", v3.f_all],
              ["album", v3.f_album],
              ["memory", v3.f_memory],
            ] as const
          ).map(([value, label]) => (
            <Link
              key={value}
              href={linkTo({ type: value })}
              aria-current={chosen.type === value ? "true" : undefined}
            >
              {label}
            </Link>
          ))}
        </nav>
        <nav className="seg" aria-label={w.statusFilter}>
          {(
            [
              ["all", v3.g_all],
              ["draft", v3.g_draft],
              ["private", w.privateFilter],
              ["published", v3.g_pub],
            ] as const
          ).map(([value, label]) => (
            <Link
              key={value}
              href={linkTo({ status: value })}
              aria-current={chosen.status === value ? "true" : undefined}
            >
              {label}
            </Link>
          ))}
          <Link href={href("/studio/journals/deleted")}>
            {words.desk.recentlyDeleted(binCount)}
          </Link>
        </nav>
        <p className="ms lib-count" aria-live="polite">
          {shown.length} {v3.s7}
        </p>
      </div>

      <div className="panel lib-panel">
        {shown.length > 0 ? (
          <table className="tbl">
            <caption className="studio-sr-only">{w.tableLabel}</caption>
            <thead>
              <tr>
                <th scope="col">{v3.s9}</th>
                <th scope="col" className="hide-m">
                  {v3.s10}
                </th>
                <th scope="col" className="hide-m">
                  {v3.s11}
                </th>
                <th scope="col">{w.status}</th>
                <th scope="col" className="hide-m">
                  {v3.s12}
                </th>
                <th scope="col" className="ac">
                  <span className="studio-sr-only">{v3.edit}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {shown.map((row) => (
                <tr key={row.key}>
                  <td>
                    <Link href={row.view} className="ti lib-title">
                      {row.title}
                    </Link>
                    {row.context ? (
                      <span className="m lib-context">{row.context}</span>
                    ) : null}
                  </td>
                  <td className="m hide-m">{kindLabel[row.kind]}</td>
                  <td className="m hide-m">
                    {row.locale === "pt-BR" ? "PT" : "EN"}
                  </td>
                  <td>
                    <span
                      className={`tag${row.status === "published" ? " pub" : row.status === "draft" ? " drf" : ""}`}
                    >
                      {row.kind === "memory"
                        ? words.memoryStatus[row.status]
                        : words.status[row.status]}
                    </span>
                  </td>
                  <td className="m hide-m">
                    {formatDate(locale, row.updatedAt)}
                  </td>
                  <td className="ac">
                    <Link
                      href={row.edit}
                      className="btn sm"
                      aria-label={row.editLabel}
                    >
                      {v3.edit}
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="sec">
            {everything.length === 0 ? (
              <>
                <h2>{w.emptyTitle}</h2>
                <p className="hint">{w.emptyBody}</p>
              </>
            ) : (
              <p className="hint">{v3.s14}</p>
            )}
          </div>
        )}
      </div>

      {binCount > 0 ? (
        <section aria-labelledby="library-bin" className="lib-bin">
          <h2 id="library-bin">{words.desk.recentlyDeleted(binCount)}</h2>
          <p className="hint">{w.deletedHint}</p>
          <p>
            <Link href={href("/studio/journals/deleted")} className="lnk">
              {w.openDeleted}
            </Link>
          </p>
        </section>
      ) : null}
    </StudioFrame>
  );
}
