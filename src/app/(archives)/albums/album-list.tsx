import Link from "next/link";

import { HEADER_RINGS } from "@/app/v3/rings";

// The Albums archive's list (docs/design-system.md, Part I, Pages: Albums),
// with the reference's four orders: the order written (no groups); the year,
// oldest first, grouped by decade; the artist, A to Z, ignoring a leading
// "The", grouped by letter, with kraft tabs to jump to a letter; and the
// rating, highest first, grouped by rating. The order is the address's
// `?sort=` (validated by the screen), so each order is a link that works the
// same without JavaScript, and a sorted list can be shared or reloaded.

export interface AlbumListRow {
  n: number;
  href: string;
  title: string;
  artist: string;
  year: number | null;
  key: string;
  rating: number | null;
  ratingText: string | null;
  /** The album's other public journals, each linked so none is unreachable. */
  others: { href: string; label: string; about: string }[];
}

export const ALBUM_SORTS = ["written", "year", "artist", "rating"] as const;
export type AlbumSort = (typeof ALBUM_SORTS)[number];
type Sort = AlbumSort;
const SORTS = ALBUM_SORTS;

/** Where the list starts, so that choosing an order keeps the reader there. */
export const ALBUM_LIST_ID = "pp-list";

const pad = (n: number) => String(n).padStart(2, "0");

const ORDER: Record<Sort, (a: AlbumListRow, b: AlbumListRow) => number> = {
  written: (a, b) => a.n - b.n,
  year: (a, b) => (a.year ?? 9999) - (b.year ?? 9999) || a.n - b.n,
  artist: (a, b) => a.key.localeCompare(b.key) || a.n - b.n,
  rating: (a, b) => (b.rating ?? -1) - (a.rating ?? -1) || a.n - b.n,
};

function heading(sort: Sort, row: AlbumListRow): string | null {
  switch (sort) {
    case "year":
      return row.year ? `${Math.floor(row.year / 10) * 10}s` : "—";
    case "artist":
      return (row.key.charAt(0) || "#").toUpperCase();
    case "rating":
      return row.ratingText ?? "—";
    default:
      return null;
  }
}

const RING_PATHS = [
  HEADER_RINGS.albums.d,
  HEADER_RINGS.artists.d,
  HEADER_RINGS.memories.d,
  HEADER_RINGS.albums.d,
];

export function AlbumList({
  rows,
  sort,
  base,
  strings,
}: Readonly<{
  rows: AlbumListRow[];
  /** The order chosen in the address. */
  sort: Sort;
  /** The archive's own address in the reader's language. */
  base: string;
  strings: {
    listS: string;
    sortBy: string;
    jump: string;
    h1: string;
    titles: Record<Sort, string>;
    sorts: Record<Sort, string>;
  };
}>) {
  const sorted = [...rows].sort(ORDER[sort]);
  const items: React.ReactNode[] = [];
  const jump: { label: string; id: string }[] = [];
  let last: string | null = null;
  for (const row of sorted) {
    const head = heading(sort, row);
    if (head !== null && head !== last) {
      const id = `pp-g-${head.replace(/[^A-Za-z0-9]/g, "") || "x"}`;
      items.push(
        <li key={`h-${head}`} className="gh" id={id}>
          <span className="hand">{head}</span>
        </li>,
      );
      if (sort === "artist") jump.push({ label: head, id });
      last = head;
    }
    items.push(
      <li key={row.n}>
        <span className="n">{pad(row.n)}</span>
        <a href={row.href}>
          {row.title}
          {row.artist ? ` — ${row.artist}` : ""}
        </a>
        <span className="sd">
          {sort === "year" && row.year ? String(row.year) : ""}
        </span>
      </li>,
    );
    for (const other of row.others) {
      items.push(
        <li key={other.href} className="oj">
          <span className="n" />
          <a href={other.href}>
            {other.label}
            <span className="sr">{other.about}</span>
          </a>
        </li>,
      );
    }
  }
  return (
    <div className="alist" id={ALBUM_LIST_ID} data-a="up" data-d="0">
      <div className="top pix">
        <span>{strings.titles[sort]}</span>
        <span>{strings.listS}</span>
      </div>
      <div className="sorts" role="group" aria-label={strings.sortBy}>
        <span className="sb hand" aria-hidden="true">
          {strings.sortBy}
        </span>
        {SORTS.map((option, i) => (
          <Link
            key={option}
            href={`${base}${option === "written" ? "" : `?sort=${option}`}#${ALBUM_LIST_ID}`}
            aria-current={sort === option ? "true" : undefined}
            prefetch={false}
          >
            {strings.sorts[option]}
            <svg
              className="penring"
              viewBox="0 0 120 50"
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              <path pathLength={1} d={RING_PATHS[i]} />
            </svg>
          </Link>
        ))}
      </div>
      {jump.length > 0 ? (
        <nav className="jump pix" aria-label={strings.jump}>
          <span className="hand">{strings.jump}</span>
          {jump.map((entry) => (
            <a key={entry.id} href={`#${entry.id}`}>
              {entry.label}
            </a>
          ))}
        </nav>
      ) : null}
      <ol aria-label={strings.h1}>{items}</ol>
    </div>
  );
}
