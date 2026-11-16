import "server-only";

import { sql, type SQL } from "drizzle-orm";
import { z } from "zod";

import { locales, type DatabaseExecutor, type Locale } from "@/db";

import {
  getPublicAlbumJournal,
  type PublicAlbumJournal,
} from "./public-album-journal";
import {
  listPublicAlbumArchive,
  listPublicArtistArchive,
  listPublicMemoryArchive,
  type PublicArtistCard,
  type PublicMemoryCard,
} from "./public-archives";
import { getPublicArtist, type PublicArtist } from "./public-artist";
import { getPublicHome, type PublicJournalCard } from "./public-home";
import { getPublicMemory, type PublicMemory } from "./public-memory";
import {
  publicArtistAddresses,
  servedAlbumJournalAddresses,
  servedMemoryAddresses,
} from "./queries";

// The public impact of a catalog change (ADR 0013 § 1.2, step 1 of § 7):
// which served pages would render different catalog wording, and exactly how.
// Studio-only and server-only. Nothing here is wired to a command yet.
//
// How it is computed, so that it cannot disagree with the pages:
//
// 1. "Before" is rendered by the public read functions themselves
//    (`getPublicAlbumJournal`, `getPublicMemory`, `getPublicArtist`, the
//    archives, the Home, and the sitemap's lists), for every served page and
//    both interface languages. They select through the publication predicate,
//    and never consult the public-reads or the cover switch, so a page counts
//    whether or not reads are on (ADR 0013 § 1.1).
// 2. "After" is rendered by the same functions over **temporary copies** of
//    the eight catalog tables, with the change applied to the copies only. A
//    temporary table is private to this session and, unqualified, is found
//    before the permanent table of the same name, so the reads, unchanged,
//    see the changed catalog. Entries, versions, slugs, reflections, and
//    memory links are never copied: they are read as they are.
// 3. Each page is reduced to its **catalog atoms** (titles, years, labels,
//    credits, track lists, artist names and addresses, the links between
//    pages, counts, and list order), never its writing, rating, dates, or
//    images, and the two sides are compared atom by atom.
//
// Read-only with respect to every shared table:
// - the whole computation runs in a transaction (or, inside a caller's
//   transaction, a savepoint) that is **always rolled back**, which drops the
//   copies with everything written to them;
// - the copies are created `on commit drop` as well, and are written only
//   through names qualified with `pg_temp`, so a write can never reach a
//   permanent table; and the computation refuses to start if a copy already
//   exists in the session, and checks afterwards that none is left.
// - Called on its own, it reads one REPEATABLE READ snapshot. Called inside a
//   caller's transaction (ADR 0013 § 4.2), it reads under the caller's locks.

/** The catalog tables the public reads use; each one is copied. */
export const CATALOG_TABLES = [
  "artists",
  "albums",
  "album_artists",
  "album_editions",
  "tracks",
  "track_artists",
  "album_tracks",
  "edition_tracks",
] as const;

const id = z.uuid();
const title = z.string().trim().min(1).max(500);
const year = z.number().int().min(1).max(9999).nullable();
const optionalText = z.string().trim().max(500).nullable();

const credit = z
  .object({ artistId: id, creditedAs: optionalText.default(null) })
  .strict();
const tracklistItem = z
  .object({ trackId: id, discNumber: z.number().int().min(1).max(99) })
  .strict();

/** One operation of a catalog change, as the change would leave the rows. */
const catalogChangeOperation = z.discriminatedUnion("op", [
  z
    .object({
      op: z.literal("update_artist"),
      artistId: id,
      name: title.optional(),
      archived: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      op: z.literal("update_album"),
      albumId: id,
      title: title.optional(),
      firstReleaseYear: year.optional(),
      /** The reference edition's label; one is created if there is none. */
      label: optionalText.optional(),
      /** The complete new credit list, in order. */
      credits: z.array(credit).max(100).optional(),
    })
    .strict(),
  z.object({ op: z.literal("delete_album"), albumId: id }).strict(),
  z
    .object({
      op: z.literal("create_album"),
      albumId: id,
      title,
      firstReleaseYear: year.default(null),
      credits: z.array(credit).max(100).default([]),
    })
    .strict(),
  z
    .object({
      op: z.literal("update_track"),
      trackId: id,
      title: title.optional(),
      credit: optionalText.optional(),
      /** The complete new list of credited artists, in order. */
      artistIds: z.array(id).max(100).optional(),
    })
    .strict(),
  z
    .object({
      op: z.literal("create_track"),
      trackId: id,
      title,
      credit: optionalText.default(null),
      artistIds: z.array(id).max(100).default([]),
    })
    .strict(),
  z
    .object({
      op: z.literal("set_tracklist"),
      albumId: id,
      /** The album's complete tracklist in reference-edition order. */
      tracks: z.array(tracklistItem).max(1000),
    })
    .strict(),
]);

const catalogChange = z.array(catalogChangeOperation).min(1).max(50);

export type CatalogChangeOperation = z.input<typeof catalogChangeOperation>;
/** A catalog change: its operations, applied in order. */
export type CatalogChange = readonly CatalogChangeOperation[];
type ParsedOperation = z.output<typeof catalogChangeOperation>;

export class CatalogImpactError extends Error {
  constructor(
    readonly code: "invalid_change" | "shadow_conflict",
    message: string,
  ) {
    super(message);
    this.name = "CatalogImpactError";
  }
}

export type ImpactSurface =
  | "album_journal"
  | "memory"
  | "artist"
  | "album_archive"
  | "artist_archive"
  | "memory_archive"
  | "home"
  | "sitemap";

/** One catalog atom that differs; `null` when it is absent on that side. */
export interface AtomChange {
  atom: string;
  before: string | null;
  after: string | null;
}

/** A served page whose catalog wording would change. Studio-only. */
export interface AffectedPage {
  surface: ImpactSurface;
  /** The interface language, or null for the sitemap (both in one file). */
  locale: Locale | null;
  /** The English address before the change (`/albums/x`, `/artists/y`). */
  path: string;
  /** The address after the change, when it moves (an artist page). */
  pathAfter: string | null;
  /** The served entry, for an album journal or a memory page. */
  entryId: string | null;
  /** The artist, for an artist page. */
  artistId: string | null;
  changes: AtomChange[];
}

/** A public artist address that the change moves, opens, or closes. */
export interface ArtistAddressChange {
  artistId: string;
  /** The address before, or null when the artist had no page. */
  before: string | null;
  /** The address after, or null when the artist has no page after. */
  after: string | null;
}

export interface CatalogPublicImpact {
  /** Every affected page, in a stable order. Empty: nothing served changes. */
  pages: AffectedPage[];
  /** Every public artist address that changes, namesakes included. */
  artistAddresses: ArtistAddressChange[];
  /**
   * True when the change would give an artist a page it does not have. Such
   * a change is refused, never confirmed (ADR 0006 A5; ADR 0013 § 1.3).
   */
  opensArtistPage: boolean;
}

/** Parses a change at the boundary, or throws `invalid_change`. */
export function parseCatalogChange(input: unknown): ParsedOperation[] {
  const parsed = catalogChange.safeParse(input);
  if (!parsed.success) {
    throw new CatalogImpactError(
      "invalid_change",
      "The catalog change is not valid.",
    );
  }
  return parsed.data;
}

/**
 * The served pages whose catalog wording `change` would change, with every
 * changed atom before and after, and every artist address that moves. Writes
 * nothing to any permanent table (see above).
 */
export async function catalogPublicImpact(
  db: DatabaseExecutor,
  change: CatalogChange,
): Promise<CatalogPublicImpact> {
  const operations = parseCatalogChange(change);
  return inRolledBackScope(db, async (tx) => {
    await assertNoShadow(tx);
    const before = await renderServedCatalog(tx);
    await createShadow(tx);
    for (const operation of operations) {
      await applyOperation(tx, operation);
    }
    const after = await renderServedCatalog(tx);
    return compareRenders(before, after);
  });
}

// ---------------------------------------------------------------------------
// The rolled-back scope and the temporary copies

class ImpactRollback extends Error {
  constructor(readonly impact: CatalogPublicImpact) {
    super("rolled back");
  }
}

async function inRolledBackScope(
  db: DatabaseExecutor,
  work: (tx: DatabaseExecutor) => Promise<CatalogPublicImpact>,
): Promise<CatalogPublicImpact> {
  const nested = "rollback" in db;
  try {
    await db.transaction(
      async (tx) => {
        throw new ImpactRollback(await work(tx));
      },
      nested ? undefined : { isolationLevel: "repeatable read" },
    );
  } catch (error) {
    if (!(error instanceof ImpactRollback)) {
      throw error;
    }
    if (nested) {
      // The savepoint's rollback dropped the copies; the caller's transaction
      // goes on, so this is checked rather than assumed.
      await assertNoShadow(db);
    }
    return error.impact;
  }
  throw new Error("unreachable: the impact scope always rolls back");
}

async function assertNoShadow(tx: DatabaseExecutor): Promise<void> {
  const found = await tx.execute<{ name: string }>(sql`
    select c.relname as name
      from pg_class c
     where c.relnamespace = pg_my_temp_schema()
       and c.relname in (${sql.join(
         CATALOG_TABLES.map((table) => sql`${table}`),
         sql`, `,
       )})`);
  if (found.rows.length > 0) {
    throw new CatalogImpactError(
      "shadow_conflict",
      "A temporary catalog copy already exists in this session.",
    );
  }
}

// Each copy is created by its own literal statement, and every write below
// names its table as `pg_temp.<table>`, so a reader (and the publication
// scans) can see that only the copies are ever written.
const CREATE_COPIES = [
  sql`create temporary table artists on commit drop as table public.artists`,
  sql`create temporary table albums on commit drop as table public.albums`,
  sql`create temporary table album_artists on commit drop
        as table public.album_artists`,
  sql`create temporary table album_editions on commit drop
        as table public.album_editions`,
  sql`create temporary table tracks on commit drop as table public.tracks`,
  sql`create temporary table track_artists on commit drop
        as table public.track_artists`,
  sql`create temporary table album_tracks on commit drop
        as table public.album_tracks`,
  sql`create temporary table edition_tracks on commit drop
        as table public.edition_tracks`,
] as const;

async function createShadow(tx: DatabaseExecutor): Promise<void> {
  for (const statement of CREATE_COPIES) {
    await tx.execute(statement);
  }
}

async function applyOperation(
  tx: DatabaseExecutor,
  operation: ParsedOperation,
): Promise<void> {
  const run = (statement: SQL) => tx.execute(statement);
  switch (operation.op) {
    case "update_artist": {
      if (operation.name !== undefined) {
        await run(sql`update pg_temp.artists set name = ${operation.name}
                       where id = ${operation.artistId}`);
      }
      if (operation.archived !== undefined) {
        await run(sql`update pg_temp.artists
                         set archived_at = ${
                           operation.archived
                             ? sql`coalesce(archived_at, now())`
                             : sql`null`
                         }
                       where id = ${operation.artistId}`);
      }
      return;
    }
    case "update_album": {
      const albumId = operation.albumId;
      if (operation.title !== undefined) {
        await run(sql`update pg_temp.albums set title = ${operation.title}
                       where id = ${albumId}`);
      }
      if (operation.firstReleaseYear !== undefined) {
        await run(sql`update pg_temp.albums
                         set first_release_year = ${operation.firstReleaseYear}
                       where id = ${albumId}`);
      }
      if (operation.label !== undefined) {
        await ensureReferenceEdition(tx, albumId);
        await run(sql`update pg_temp.album_editions
                         set label = ${operation.label}
                       where album_id = ${albumId} and is_reference`);
      }
      if (operation.credits !== undefined) {
        await replaceAlbumCredits(tx, albumId, operation.credits);
      }
      return;
    }
    case "delete_album": {
      // The album's own rows go with it, as the foreign keys cascade them.
      const albumId = operation.albumId;
      await run(
        sql`delete from pg_temp.edition_tracks where album_id = ${albumId}`,
      );
      await run(
        sql`delete from pg_temp.album_editions where album_id = ${albumId}`,
      );
      await run(
        sql`delete from pg_temp.album_tracks where album_id = ${albumId}`,
      );
      await run(
        sql`delete from pg_temp.album_artists where album_id = ${albumId}`,
      );
      await run(sql`delete from pg_temp.albums
                     where id = ${operation.albumId}`);
      return;
    }
    case "create_album": {
      await run(sql`insert into pg_temp.albums (id, title, first_release_year)
                    values (${operation.albumId}, ${operation.title},
                            ${operation.firstReleaseYear})`);
      await replaceAlbumCredits(tx, operation.albumId, operation.credits);
      return;
    }
    case "update_track": {
      if (operation.title !== undefined) {
        await run(sql`update pg_temp.tracks set title = ${operation.title}
                       where id = ${operation.trackId}`);
      }
      if (operation.credit !== undefined) {
        await run(sql`update pg_temp.tracks set credit = ${operation.credit}
                       where id = ${operation.trackId}`);
      }
      if (operation.artistIds !== undefined) {
        await replaceTrackArtists(tx, operation.trackId, operation.artistIds);
      }
      return;
    }
    case "create_track": {
      await run(sql`insert into pg_temp.tracks (id, title, credit)
                    values (${operation.trackId}, ${operation.title},
                            ${operation.credit})`);
      await replaceTrackArtists(tx, operation.trackId, operation.artistIds);
      return;
    }
    case "set_tracklist": {
      await setTracklist(tx, operation.albumId, operation.tracks);
      return;
    }
  }
}

async function ensureReferenceEdition(
  tx: DatabaseExecutor,
  albumId: string,
): Promise<void> {
  await tx.execute(sql`
    insert into pg_temp.album_editions (id, album_id, is_reference)
    select gen_random_uuid(), ${albumId}, true
     where not exists (select 1 from pg_temp.album_editions
                        where album_id = ${albumId} and is_reference)`);
}

async function replaceAlbumCredits(
  tx: DatabaseExecutor,
  albumId: string,
  credits: readonly { artistId: string; creditedAs: string | null }[],
): Promise<void> {
  await tx.execute(sql`delete from pg_temp.album_artists
                        where album_id = ${albumId}`);
  for (const [index, entry] of credits.entries()) {
    await tx.execute(sql`
      insert into pg_temp.album_artists
             (album_id, artist_id, position, credited_as)
      values (${albumId}, ${entry.artistId}, ${index + 1}, ${entry.creditedAs})`);
  }
}

async function replaceTrackArtists(
  tx: DatabaseExecutor,
  trackId: string,
  artistIds: readonly string[],
): Promise<void> {
  await tx.execute(sql`delete from pg_temp.track_artists
                        where track_id = ${trackId}`);
  for (const [index, artistId] of artistIds.entries()) {
    await tx.execute(sql`
      insert into pg_temp.track_artists (track_id, artist_id, position)
      values (${trackId}, ${artistId}, ${index + 1})`);
  }
}

// As the catalog's `rewriteTracklist` leaves the rows: the membership is the
// given set, and the reference edition holds exactly the given order,
// numbered from 1 within each disc.
async function setTracklist(
  tx: DatabaseExecutor,
  albumId: string,
  tracks: readonly { trackId: string; discNumber: number }[],
): Promise<void> {
  await ensureReferenceEdition(tx, albumId);
  await tx.execute(sql`delete from pg_temp.edition_tracks
                        where album_id = ${albumId}
                          and edition_id = (select id from pg_temp.album_editions
                                             where album_id = ${albumId}
                                               and is_reference)`);
  await tx.execute(sql`delete from pg_temp.album_tracks
                        where album_id = ${albumId}`);
  const nextPosition = new Map<number, number>();
  for (const track of tracks) {
    const position = (nextPosition.get(track.discNumber) ?? 0) + 1;
    nextPosition.set(track.discNumber, position);
    await tx.execute(sql`
      insert into pg_temp.album_tracks (album_id, track_id)
      values (${albumId}, ${track.trackId})`);
    await tx.execute(sql`
      insert into pg_temp.edition_tracks
             (edition_id, album_id, track_id, disc_number, position)
      select ed.id, ${albumId}, ${track.trackId}, ${track.discNumber}, ${position}
        from pg_temp.album_editions ed
       where ed.album_id = ${albumId} and ed.is_reference`);
  }
}

// ---------------------------------------------------------------------------
// Rendering served pages to catalog atoms

type Atoms = Map<string, string | null>;

interface RenderedPage {
  surface: ImpactSurface;
  locale: Locale | null;
  path: string;
  entryId: string | null;
  artistId: string | null;
  atoms: Atoms;
}

export interface ServedCatalogRender {
  /** By a key that does not depend on the catalog (entry or artist id). */
  pages: Map<string, RenderedPage>;
  /** Every public artist address, by artist id. */
  artistAddresses: Map<string, string>;
}

const link = (prefix: string, slug: string | null) =>
  slug === null ? null : `${prefix}/${slug}`;

function flatten(value: unknown, prefix: string, out: Atoms): Atoms {
  if (Array.isArray(value)) {
    out.set(`${prefix}.count`, String(value.length));
    value.forEach((item, index) =>
      flatten(item, `${prefix}.${index + 1}`, out),
    );
  } else if (value !== null && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      flatten(item, prefix === "" ? key : `${prefix}.${key}`, out);
    }
  } else {
    out.set(
      prefix,
      value === null || value === undefined ? null : String(value),
    );
  }
  return out;
}

const atomsOf = (value: Record<string, unknown>) =>
  flatten(value, "", new Map());

// Each projection keeps only catalog wording and the links between pages.
// Writing, ratings, dates, languages of versions, and images are left out.

function albumJournalAtoms(page: PublicAlbumJournal): Atoms {
  return atomsOf({
    album: {
      title: page.album.title,
      year: page.album.firstReleaseYear,
      label: page.album.label,
    },
    credits: page.credits.map((entry) => ({
      name: entry.name,
      link: link("/artists", entry.artistAddress),
    })),
    tracks: page.tracks.map((track) => ({
      title: track.title,
      credit: track.credit,
    })),
  });
}

function memoryAtoms(page: PublicMemory): Atoms {
  return atomsOf({
    music: page.music.map((item) => ({
      kind: item.kind,
      title: item.title,
      artists: item.artists.map((artist) => ({
        name: artist.name,
        link: link("/artists", artist.address),
      })),
      album:
        item.album === null
          ? null
          : {
              title: item.album.title,
              link: link("/albums", item.album.journalSlug),
            },
    })),
  });
}

function artistAtoms(page: PublicArtist): Atoms {
  return atomsOf({
    address: link("/artists", page.address),
    name: page.name,
    albums: page.albums.map((album) => ({
      link: link("/albums", album.slug),
      title: album.title,
      year: album.firstReleaseYear,
      trackCount: album.trackCount,
      writtenTrackCount: album.writtenTrackCount,
    })),
    tracks: page.tracks.map((track) => ({
      title: track.title,
      albumTitle: track.albumTitle,
      link: link("/albums", track.slug),
      number: track.number,
    })),
  });
}

const journalCard = (card: PublicJournalCard) => ({
  link: link("/albums", card.slug),
  albumTitle: card.albumTitle,
  credits: card.credits,
  year: card.firstReleaseYear,
});

const artistCard = (card: PublicArtistCard) => ({
  link: link("/artists", card.address),
  name: card.name,
  albumCount: card.albumCount,
  journalCount: card.journalCount,
});

const memoryCard = (card: PublicMemoryCard) => ({
  link: link("/memories", card.slug),
  music: card.music.map((song) => ({
    title: song.title,
    artists: song.artists,
  })),
});

/** Internal; exported for the integration tests' oracle only. */
export async function renderServedCatalog(
  tx: DatabaseExecutor,
): Promise<ServedCatalogRender> {
  const pages = new Map<string, RenderedPage>();
  const put = (key: string, page: RenderedPage) => pages.set(key, page);

  // The served entries come from entry tables only, which are never copied:
  // a catalog change cannot change which entries are served.
  const journals = await tx.execute<{ entry_id: string; slug: string }>(sql`
    select served.entry_id, served.slug
      from (${servedAlbumJournalAddresses}) served
     order by served.slug asc`);
  const memories = await tx.execute<{ entry_id: string; slug: string }>(sql`
    select served.entry_id, served.slug
      from (${servedMemoryAddresses}) served
     order by served.slug asc`);
  const artistAddresses = await publicArtistAddresses(tx);
  const artistIds = [...artistAddresses.keys()].sort();

  for (const locale of locales) {
    for (const journal of journals.rows) {
      const page = await getPublicAlbumJournal(tx, journal.entry_id, locale);
      if (page) {
        put(`album_journal:${journal.entry_id}:${locale}`, {
          surface: "album_journal",
          locale,
          path: `/albums/${journal.slug}`,
          entryId: journal.entry_id,
          artistId: null,
          atoms: albumJournalAtoms(page),
        });
      }
    }
    for (const memory of memories.rows) {
      const page = await getPublicMemory(tx, memory.entry_id, locale);
      if (page) {
        put(`memory:${memory.entry_id}:${locale}`, {
          surface: "memory",
          locale,
          path: `/memories/${memory.slug}`,
          entryId: memory.entry_id,
          artistId: null,
          atoms: memoryAtoms(page),
        });
      }
    }
    for (const artistId of artistIds) {
      const page = await getPublicArtist(tx, artistId, locale);
      if (page) {
        put(`artist:${artistId}:${locale}`, {
          surface: "artist",
          locale,
          path: `/artists/${page.address}`,
          entryId: null,
          artistId,
          atoms: artistAtoms(page),
        });
      }
    }

    const archive = (surface: ImpactSurface, path: string, atoms: Atoms) =>
      put(`${surface}:${locale}`, {
        surface,
        locale,
        path,
        entryId: null,
        artistId: null,
        atoms,
      });
    archive(
      "album_archive",
      "/albums",
      atomsOf({
        cards: (await listPublicAlbumArchive(tx, locale)).map((card) => ({
          ...journalCard(card),
          trackCount: card.trackCount,
          writtenTrackCount: card.writtenTrackCount,
          otherJournals: card.otherJournals.map((other) =>
            link("/albums", other.slug),
          ),
        })),
      }),
    );
    archive(
      "artist_archive",
      "/artists",
      atomsOf({ cards: (await listPublicArtistArchive(tx)).map(artistCard) }),
    );
    archive(
      "memory_archive",
      "/memories",
      atomsOf({
        cards: (await listPublicMemoryArchive(tx, locale)).map(memoryCard),
      }),
    );

    const home = await getPublicHome(tx, locale);
    archive(
      "home",
      "/",
      atomsOf({
        recent: home.recent.map((entry) =>
          entry.kind === "album_journal"
            ? { kind: entry.kind, ...journalCard(entry) }
            : {
                kind: entry.kind,
                link: link("/memories", entry.slug),
                firstSong: entry.firstSong,
              },
        ),
        albums: home.albums.map(journalCard),
        artists: home.artists.map(artistCard),
        memories: home.memories.map(memoryCard),
      }),
    );
  }

  // The sitemap: one file listing every served address in both languages.
  // Album-journal and memory addresses do not depend on the catalog; the
  // artist addresses do.
  put("sitemap", {
    surface: "sitemap",
    locale: null,
    path: "/sitemap.xml",
    entryId: null,
    artistId: null,
    atoms: atomsOf({
      artists: [...artistAddresses.values()]
        .sort()
        .map((address) => `/artists/${address}`),
    }),
  });

  return { pages, artistAddresses };
}

// ---------------------------------------------------------------------------
// Comparing the two renders

const SURFACE_ORDER: readonly ImpactSurface[] = [
  "album_journal",
  "memory",
  "artist",
  "album_archive",
  "artist_archive",
  "memory_archive",
  "home",
  "sitemap",
];

function compareAtoms(before: Atoms, after: Atoms): AtomChange[] {
  const changes: AtomChange[] = [];
  const keys = new Set([...before.keys(), ...after.keys()]);
  for (const atom of keys) {
    const was = before.has(atom) ? before.get(atom)! : null;
    const will = after.has(atom) ? after.get(atom)! : null;
    if (was !== will || before.has(atom) !== after.has(atom)) {
      changes.push({ atom, before: was, after: will });
    }
  }
  return changes;
}

/** Internal; exported for the integration tests' oracle only. */
export function compareRenders(
  before: ServedCatalogRender,
  after: ServedCatalogRender,
): CatalogPublicImpact {
  const pages: AffectedPage[] = [];
  const keys = new Set([...before.pages.keys(), ...after.pages.keys()]);
  for (const key of keys) {
    const was = before.pages.get(key);
    const will = after.pages.get(key);
    const shape = (was ?? will)!;
    const changes = compareAtoms(
      was?.atoms ?? new Map(),
      will?.atoms ?? new Map(),
    );
    if (changes.length === 0) {
      continue;
    }
    pages.push({
      surface: shape.surface,
      locale: shape.locale,
      path: (was ?? will)!.path,
      pathAfter: was && will && was.path !== will.path ? will.path : null,
      entryId: shape.entryId,
      artistId: shape.artistId,
      changes,
    });
  }
  pages.sort(
    (a, b) =>
      SURFACE_ORDER.indexOf(a.surface) - SURFACE_ORDER.indexOf(b.surface) ||
      compareText(a.path, b.path) ||
      compareText(a.locale ?? "", b.locale ?? ""),
  );

  const artistAddresses: ArtistAddressChange[] = [];
  const artistIds = new Set([
    ...before.artistAddresses.keys(),
    ...after.artistAddresses.keys(),
  ]);
  for (const artistId of [...artistIds].sort()) {
    const was = before.artistAddresses.get(artistId) ?? null;
    const will = after.artistAddresses.get(artistId) ?? null;
    if (was !== will) {
      artistAddresses.push({ artistId, before: was, after: will });
    }
  }

  return {
    pages,
    artistAddresses,
    opensArtistPage: artistAddresses.some(
      (change) => change.before === null && change.after !== null,
    ),
  };
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** True when nothing served would change. */
export function isEmptyImpact(impact: CatalogPublicImpact): boolean {
  return impact.pages.length === 0 && impact.artistAddresses.length === 0;
}
