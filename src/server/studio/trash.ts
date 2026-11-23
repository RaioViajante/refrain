// The Studio's 30-day trash (decision 0003 § 3). Deleting a tape, a song, a
// track, or a photo moves a snapshot of its rows here, in the same
// transaction that removes them from the live tables, so public pages (which
// read only the live tables) can never show a deleted item. Restoring writes
// the rows back and resolves what changed meanwhile. Callers authorize first.
//
// Rules that hold for every kind:
// - an expired item (`purge_after` passed) cannot be restored, even before
//   the daily purge has removed it;
// - nothing is consumed that was not applied: a part that cannot go back
//   stays in the trash as its own `track` item, with the original dates, and
//   a note that cannot be reapplied is kept as a text version;
// - restoring a tape always brings it back as a draft; restoring a song or a
//   track onto a published tape changes that page at once, so it needs an
//   explicit confirmation naming the tape (RestoreNeedsConfirmation);
// - shelf changes are serialized with the lock tape creation already takes.
import "server-only";

import { and, asc, eq, gt, inArray, lte, max, sql } from "drizzle-orm";
import { z } from "zod";

import {
  images,
  mixtapes,
  mixtapeTracks,
  songs,
  textVersions,
  trashImageRefs,
  trashItems,
} from "@/db/schema";
import type { Database } from "@/db/types";

import { setTrackOrder } from "../tracklist";
import { pgCode, StudioError } from "./errors";
import { MAX_NUMBER, uniqueSlug } from "./shelf";

export type TrashKind = "mixtape" | "song" | "track" | "image";

/** The snapshot format these functions write and read (`payload_version`). */
const PAYLOAD_VERSION = 1;

// ---------- snapshots ----------

const isoDate = z.iso.datetime({ offset: true });
const id = z.uuid();
const noteSide = z.enum(["left", "right"]);
const songRef = z.object({
  id,
  title: z.string().min(1),
  artist: z.string().min(1),
});

const mixtapeSnapshot = z.object({
  mixtape: z.object({
    id,
    number: z.number().int().positive(),
    slug: z.string().min(1),
    title: z.string().min(1),
    theme: z.string(),
    feeling: z.string(),
    description: z.string(),
    reflection: z.string(),
    pullQuote: z.string(),
    pullQuoteCredit: z.string(),
    playlistUrl: z.string().nullable(),
    year: z.number().int().nullable(),
    coverImageId: id.nullable(),
    detailImageId: id.nullable(),
    detailCaption: z.string(),
    featuredRank: z.number().int().nullable(),
    status: z.enum(["draft", "published"]),
    publishedAt: isoDate.nullable(),
    createdAt: isoDate,
  }),
  tracks: z.array(
    z.object({
      id,
      position: z.number().int().positive(),
      note: z.string(),
      noteSide,
      createdAt: isoDate,
      song: songRef,
    }),
  ),
});

const songSnapshot = z.object({
  song: z.object({
    id,
    title: z.string().min(1),
    artist: z.string().min(1),
    createdAt: isoDate,
  }),
  tracks: z.array(
    z.object({
      id,
      mixtapeId: id,
      mixtapeTitle: z.string().min(1),
      position: z.number().int().positive(),
      note: z.string(),
      noteSide,
      createdAt: isoDate,
    }),
  ),
});

const trackSnapshot = z.object({
  track: z.object({
    id,
    mixtapeId: id,
    mixtapeTitle: z.string().min(1),
    position: z.number().int().positive(),
    note: z.string(),
    noteSide,
    createdAt: isoDate,
    song: songRef,
  }),
});

const imageSnapshot = z.object({
  image: z.object({
    id,
    alt: z.string().min(1),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    focus: z.number().int().min(0).max(8),
    treatment: z.enum(["mood", "original"]),
    rightsConfirmed: z.boolean(),
    rightsNote: z.string(),
    createdAt: isoDate,
  }),
});

const SNAPSHOTS = {
  mixtape: mixtapeSnapshot,
  song: songSnapshot,
  track: trackSnapshot,
  image: imageSnapshot,
} as const;
type Snapshot<K extends TrashKind> = z.infer<(typeof SNAPSHOTS)[K]>;
type TrackSnapshot = Snapshot<"track">["track"];

const iso = (date: Date) => date.toISOString();
const clip = (text: string, length: number) =>
  text.length <= length ? text : `${text.slice(0, length - 1)}…`;
const trackLabel = (t: TrackSnapshot) =>
  clip(`${t.song.title} — ${t.song.artist} · ${t.mixtapeTitle}`, 500);

type Item = typeof trashItems.$inferSelect;

/**
 * Writes one item. An expired item for the same row (not yet purged) is
 * removed first, so it never blocks a new deletion. `dates` carries an
 * original item's deletion and expiry over to a part of it.
 */
async function putInTrash<K extends TrashKind>(
  tx: Database,
  entry: {
    kind: K;
    subjectId: string;
    label: string;
    snapshot: Snapshot<K>;
    imageIds?: readonly (string | null)[];
    dates?: Pick<Item, "deletedAt" | "purgeAfter">;
  },
): Promise<string> {
  SNAPSHOTS[entry.kind].parse(entry.snapshot);
  await tx
    .delete(trashItems)
    .where(
      and(
        eq(trashItems.kind, entry.kind),
        eq(trashItems.subjectId, entry.subjectId),
        lte(trashItems.purgeAfter, sql`now()`),
      ),
    );
  const [item] = await tx
    .insert(trashItems)
    .values({
      kind: entry.kind,
      subjectId: entry.subjectId,
      label: clip(entry.label, 500),
      payload: entry.snapshot,
      payloadVersion: PAYLOAD_VERSION,
      // Undefined leaves the database's defaults (now, now + 30 days).
      deletedAt: entry.dates?.deletedAt,
      purgeAfter: entry.dates?.purgeAfter,
    })
    .returning({ id: trashItems.id });
  const imageIds = [
    ...new Set((entry.imageIds ?? []).filter((i): i is string => !!i)),
  ];
  if (imageIds.length > 0) {
    await tx
      .insert(trashImageRefs)
      .values(imageIds.map((imageId) => ({ trashItemId: item!.id, imageId })));
  }
  return item!.id;
}

/** Whether an unexpired item for this row is in the trash. */
async function inTrash(tx: Database, kind: TrashKind, subjectId: string) {
  const [item] = await tx
    .select({ id: trashItems.id })
    .from(trashItems)
    .where(
      and(
        eq(trashItems.kind, kind),
        eq(trashItems.subjectId, subjectId),
        gt(trashItems.purgeAfter, sql`now()`),
      ),
    )
    .limit(1);
  return !!item;
}

/** Rewrites a tape's positions 1…n in their current order. */
async function compact(tx: Database, mixtapeId: string) {
  const rest = await tx
    .select({ id: mixtapeTracks.id })
    .from(mixtapeTracks)
    .where(eq(mixtapeTracks.mixtapeId, mixtapeId))
    .orderBy(asc(mixtapeTracks.position));
  await setTrackOrder(
    tx,
    mixtapeId,
    rest.map((t) => t.id),
  );
}

// ---------- moving to the trash ----------

/** Moves a tape, its tracklist, and its notes to the trash. */
export async function trashMixtape(tx: Database, mixtapeId: string) {
  const [m] = await tx
    .select()
    .from(mixtapes)
    .where(eq(mixtapes.id, mixtapeId))
    .for("update");
  if (!m) throw new StudioError("essa fita não existe.");
  const tracks = await tx
    .select({
      id: mixtapeTracks.id,
      position: mixtapeTracks.position,
      note: mixtapeTracks.note,
      noteSide: mixtapeTracks.noteSide,
      createdAt: mixtapeTracks.createdAt,
      songId: songs.id,
      title: songs.title,
      artist: songs.artist,
    })
    .from(mixtapeTracks)
    .innerJoin(songs, eq(songs.id, mixtapeTracks.songId))
    .where(eq(mixtapeTracks.mixtapeId, mixtapeId))
    .orderBy(asc(mixtapeTracks.position));
  await putInTrash(tx, {
    kind: "mixtape",
    subjectId: m.id,
    label: m.title,
    imageIds: [m.coverImageId, m.detailImageId],
    snapshot: {
      mixtape: {
        id: m.id,
        number: m.number,
        slug: m.slug,
        title: m.title,
        theme: m.theme,
        feeling: m.feeling,
        description: m.description,
        reflection: m.reflection,
        pullQuote: m.pullQuote,
        pullQuoteCredit: m.pullQuoteCredit,
        playlistUrl: m.playlistUrl,
        year: m.year,
        coverImageId: m.coverImageId,
        detailImageId: m.detailImageId,
        detailCaption: m.detailCaption,
        featuredRank: m.featuredRank,
        status: m.status as "draft" | "published",
        publishedAt: m.publishedAt ? iso(m.publishedAt) : null,
        createdAt: iso(m.createdAt),
      },
      tracks: tracks.map((t) => ({
        id: t.id,
        position: t.position,
        note: t.note,
        noteSide: t.noteSide as "left" | "right",
        createdAt: iso(t.createdAt),
        song: { id: t.songId, title: t.title, artist: t.artist },
      })),
    },
  });
  await tx.delete(mixtapeTracks).where(eq(mixtapeTracks.mixtapeId, mixtapeId));
  await tx.delete(mixtapes).where(eq(mixtapes.id, mixtapeId));
}

/** Moves one track and its note to the trash; the tape closes the gap. */
export async function trashTrack(tx: Database, trackId: string) {
  const [t] = await tx
    .select({
      id: mixtapeTracks.id,
      mixtapeId: mixtapeTracks.mixtapeId,
      mixtapeTitle: mixtapes.title,
      position: mixtapeTracks.position,
      note: mixtapeTracks.note,
      noteSide: mixtapeTracks.noteSide,
      createdAt: mixtapeTracks.createdAt,
      songId: songs.id,
      title: songs.title,
      artist: songs.artist,
    })
    .from(mixtapeTracks)
    .innerJoin(songs, eq(songs.id, mixtapeTracks.songId))
    .innerJoin(mixtapes, eq(mixtapes.id, mixtapeTracks.mixtapeId))
    .where(eq(mixtapeTracks.id, trackId))
    .for("update", { of: mixtapeTracks });
  if (!t) throw new StudioError("essa faixa não existe.");
  const track: TrackSnapshot = {
    id: t.id,
    mixtapeId: t.mixtapeId,
    mixtapeTitle: t.mixtapeTitle,
    position: t.position,
    note: t.note,
    noteSide: t.noteSide as "left" | "right",
    createdAt: iso(t.createdAt),
    song: { id: t.songId, title: t.title, artist: t.artist },
  };
  await putInTrash(tx, {
    kind: "track",
    subjectId: t.id,
    label: trackLabel(track),
    snapshot: { track },
  });
  await tx.delete(mixtapeTracks).where(eq(mixtapeTracks.id, trackId));
  await compact(tx, t.mixtapeId);
}

/**
 * Moves a song to the trash, with its track and note on every tape it is
 * on; those tapes close their gaps.
 */
export async function trashSong(tx: Database, songId: string) {
  const [s] = await tx
    .select()
    .from(songs)
    .where(eq(songs.id, songId))
    .for("update");
  if (!s) throw new StudioError("essa música não existe.");
  const tracks = await tx
    .select({
      id: mixtapeTracks.id,
      mixtapeId: mixtapeTracks.mixtapeId,
      mixtapeTitle: mixtapes.title,
      position: mixtapeTracks.position,
      note: mixtapeTracks.note,
      noteSide: mixtapeTracks.noteSide,
      createdAt: mixtapeTracks.createdAt,
    })
    .from(mixtapeTracks)
    .innerJoin(mixtapes, eq(mixtapes.id, mixtapeTracks.mixtapeId))
    .where(eq(mixtapeTracks.songId, songId))
    .orderBy(asc(mixtapes.number));
  await putInTrash(tx, {
    kind: "song",
    subjectId: s.id,
    label: `${s.title} — ${s.artist}`,
    snapshot: {
      song: {
        id: s.id,
        title: s.title,
        artist: s.artist,
        createdAt: iso(s.createdAt),
      },
      tracks: tracks.map((t) => ({
        ...t,
        noteSide: t.noteSide as "left" | "right",
        createdAt: iso(t.createdAt),
      })),
    },
  });
  await tx.delete(mixtapeTracks).where(eq(mixtapeTracks.songId, songId));
  for (const mixtapeId of new Set(tracks.map((t) => t.mixtapeId))) {
    await compact(tx, mixtapeId);
  }
  await tx.delete(songs).where(eq(songs.id, songId));
}

/**
 * Removes expired trash items that still reference a photo, so that only
 * restorable items keep it from being deleted.
 */
export async function purgeExpiredReferencesTo(tx: Database, imageId: string) {
  await tx
    .delete(trashItems)
    .where(
      and(
        lte(trashItems.purgeAfter, sql`now()`),
        inArray(
          trashItems.id,
          tx
            .select({ id: trashImageRefs.trashItemId })
            .from(trashImageRefs)
            .where(eq(trashImageRefs.imageId, imageId)),
        ),
      ),
    );
}

/**
 * Moves a photo to the trash with its bytes, copied inside PostgreSQL byte
 * for byte. The caller has checked that nothing uses it.
 */
export async function trashImage(tx: Database, imageId: string) {
  const [i] = await tx
    .select()
    .from(images)
    .where(eq(images.id, imageId))
    .for("update");
  if (!i) throw new StudioError("essa foto não existe.");
  const itemId = await putInTrash(tx, {
    kind: "image",
    subjectId: i.id,
    label: i.alt,
    snapshot: {
      image: {
        id: i.id,
        alt: i.alt,
        width: i.width,
        height: i.height,
        focus: i.focus,
        treatment: i.treatment as "mood" | "original",
        rightsConfirmed: i.rightsConfirmed,
        rightsNote: i.rightsNote,
        createdAt: iso(i.createdAt),
      },
    },
  });
  const copied = await tx.execute(sql`
    insert into trash_files (trash_item_id, content_type, byte_size, bytes)
    select ${itemId}, content_type, byte_size, bytes
    from image_files where image_id = ${imageId}
  `);
  if (copied.rowCount !== 1) {
    throw new StudioError("os arquivos dessa foto não foram encontrados.");
  }
  await tx.delete(images).where(eq(images.id, imageId));
}

// ---------- restoring ----------

/** A published tape a restore would change, for the confirmation. */
export type PublishedTape = { id: string; title: string; path: string };

/**
 * Restoring would change these published pages at once. The owner must
 * confirm them by id (`confirmedTapeIds`); nothing was written.
 */
export class RestoreNeedsConfirmation extends StudioError {
  override name = "RestoreNeedsConfirmation";
  constructor(readonly tapes: readonly PublishedTape[]) {
    super(
      `restaurar muda na hora a página publicada de ${tapes
        .map((t) => `${t.title} (${t.path})`)
        .join(", ")}. confirme para restaurar.`,
    );
  }
}

export type RestoreResult = {
  kind: TrashKind;
  /** The restored row's id (a merged song's is the existing song's). */
  id: string;
  /** What happened, in the Studio's words. */
  message: string;
};

type LiveTape = {
  id: string;
  title: string;
  slug: string;
  status: string;
};
const published = (tape: LiveTape): PublishedTape => ({
  id: tape.id,
  title: tape.title,
  path: `/mixtapes/${tape.slug}`,
});

async function liveTape(tx: Database, mixtapeId: string, lock: boolean) {
  const query = tx
    .select({
      id: mixtapes.id,
      title: mixtapes.title,
      slug: mixtapes.slug,
      status: mixtapes.status,
    })
    .from(mixtapes)
    .where(eq(mixtapes.id, mixtapeId));
  const [tape] = lock ? await query.for("update") : await query;
  return tape;
}

/** The live song a snapshot's song is now: the same one, or one with its name. */
async function existingSong(
  tx: Database,
  song: { id: string; title: string; artist: string },
) {
  const [same] = await tx
    .select({ id: songs.id })
    .from(songs)
    .where(eq(songs.id, song.id));
  if (same) return { id: same.id, merged: false };
  const [named] = await tx
    .select({ id: songs.id })
    .from(songs)
    .where(
      and(
        sql`lower(${songs.title}) = lower(${song.title})`,
        sql`lower(${songs.artist}) = lower(${song.artist})`,
      ),
    )
    .limit(1);
  return named ? { id: named.id, merged: true } : null;
}

async function trackOfSong(tx: Database, mixtapeId: string, songId: string) {
  const [track] = await tx
    .select({ id: mixtapeTracks.id })
    .from(mixtapeTracks)
    .where(
      and(
        eq(mixtapeTracks.mixtapeId, mixtapeId),
        eq(mixtapeTracks.songId, songId),
      ),
    );
  return track;
}

/** Puts a track back at `position`, or at the end if the tape got shorter. */
async function insertTrackAt(
  tx: Database,
  mixtapeId: string,
  track: {
    id: string;
    songId: string;
    note: string;
    noteSide: "left" | "right";
    createdAt: string;
  },
  position: number,
) {
  const order = (
    await tx
      .select({ id: mixtapeTracks.id })
      .from(mixtapeTracks)
      .where(eq(mixtapeTracks.mixtapeId, mixtapeId))
      .orderBy(asc(mixtapeTracks.position))
  ).map((t) => t.id);
  const [last] = await tx
    .select({ p: max(mixtapeTracks.position) })
    .from(mixtapeTracks)
    .where(eq(mixtapeTracks.mixtapeId, mixtapeId));
  await tx.insert(mixtapeTracks).values({
    id: track.id,
    mixtapeId,
    songId: track.songId,
    position: (last?.p ?? 0) + 1,
    note: track.note,
    noteSide: track.noteSide,
    createdAt: new Date(track.createdAt),
  });
  order.splice(Math.min(position - 1, order.length), 0, track.id);
  await setTrackOrder(tx, mixtapeId, order);
}

/** Keeps a note whose track cannot take it, as a version of that track's note. */
async function keepNote(
  tx: Database,
  item: Item,
  trackId: string,
  label: string,
  note: string,
) {
  if (note === "") return;
  await tx.insert(textVersions).values({
    subject: "track",
    subjectKey: trackId,
    field: "note",
    label: clip(label, 300),
    body: note,
    purgeAfter: item.purgeAfter,
  });
}

function requireConfirmation(
  tapes: readonly LiveTape[],
  confirmed: readonly string[],
) {
  const missing = tapes
    .filter((t) => t.status === "published" && !confirmed.includes(t.id))
    .map(published);
  if (missing.length > 0) throw new RestoreNeedsConfirmation(missing);
}

async function readItem(tx: Database, itemId: string, lock: boolean) {
  const query = tx
    .select({
      item: trashItems,
      expired: sql<boolean>`${trashItems.purgeAfter} <= now()`,
    })
    .from(trashItems)
    .where(eq(trashItems.id, itemId));
  const [row] = lock ? await query.for("update") : await query;
  if (!row) throw new StudioError("esse item não está mais na lixeira.");
  if (row.expired) {
    throw new StudioError(
      "esse item passou dos 30 dias na lixeira e não pode mais ser restaurado.",
    );
  }
  if (row.item.payloadVersion !== PAYLOAD_VERSION) {
    throw new StudioError(
      "esse item foi guardado num formato que esta versão do studio não conhece.",
    );
  }
  return row.item;
}

const snapshotOf = <K extends TrashKind>(item: Item, kind: K): Snapshot<K> =>
  SNAPSHOTS[kind].parse(item.payload) as Snapshot<K>;

/** Where a deleted song's tracks would go, decided before anything is written. */
async function planSong(tx: Database, item: Item, lock: boolean) {
  const { song, tracks } = snapshotOf(item, "song");
  const existing = await existingSong(tx, song);
  const back: { track: (typeof tracks)[number]; tape: LiveTape }[] = [];
  const onTapeAlready: {
    track: (typeof tracks)[number];
    tape: LiveTape;
    liveTrackId: string;
  }[] = [];
  const tapeInTrash: (typeof tracks)[number][] = [];
  const tapeGone: (typeof tracks)[number][] = [];
  for (const track of tracks) {
    const tape = await liveTape(tx, track.mixtapeId, lock);
    if (!tape) {
      if (await inTrash(tx, "mixtape", track.mixtapeId))
        tapeInTrash.push(track);
      else tapeGone.push(track);
      continue;
    }
    const already = existing && (await trackOfSong(tx, tape.id, existing.id));
    if (already) onTapeAlready.push({ track, tape, liveTrackId: already.id });
    else back.push({ track, tape });
  }
  return { song, existing, back, onTapeAlready, tapeInTrash, tapeGone };
}

/** What restoring a track would meet, decided before anything is written. */
async function planTrack(tx: Database, item: Item, lock: boolean) {
  const { track } = snapshotOf(item, "track");
  const tape = await liveTape(tx, track.mixtapeId, lock);
  if (!tape) {
    throw new StudioError(
      (await inTrash(tx, "mixtape", track.mixtapeId))
        ? `a fita ${track.mixtapeTitle} está na lixeira: restaure a fita antes da faixa.`
        : `a fita ${track.mixtapeTitle} não existe mais; essa faixa não pode voltar.`,
    );
  }
  const existing = await existingSong(tx, track.song);
  if (existing && (await trackOfSong(tx, tape.id, existing.id))) {
    throw new StudioError(`${tape.title} já tem ${track.song.title}.`);
  }
  return { track, tape, existing };
}

/**
 * The published pages restoring this item would change at once, for the
 * confirmation the owner must give first (empty for tapes and photos).
 */
export async function getRestoreImpact(
  db: Database,
  itemId: string,
): Promise<{
  kind: TrashKind;
  label: string;
  publishedTapes: PublishedTape[];
}> {
  return db.transaction(async (tx) => {
    const item = await readItem(tx, itemId, false);
    let tapes: LiveTape[] = [];
    if (item.kind === "song") {
      tapes = (await planSong(tx, item, false)).back.map((b) => b.tape);
    } else if (item.kind === "track") {
      tapes = [(await planTrack(tx, item, false)).tape];
    }
    return {
      kind: item.kind as TrashKind,
      label: item.label,
      publishedTapes: tapes
        .filter((t) => t.status === "published")
        .map(published),
    };
  });
}

/** The song a snapshot refers to, created anew (with a new id) if gone. */
async function songFor(
  tx: Database,
  song: { id: string; title: string; artist: string },
  existing: { id: string; merged: boolean } | null,
  notes: string[],
) {
  if (existing) {
    if (existing.merged)
      notes.push(`${song.title} juntou-se à música de mesmo nome no catálogo`);
    return existing.id;
  }
  const [created] = await tx
    .insert(songs)
    .values({ title: song.title, artist: song.artist })
    .returning({ id: songs.id });
  notes.push(`${song.title} voltou ao catálogo`);
  return created!.id;
}

async function restoreMixtape(
  tx: Database,
  item: Item,
): Promise<RestoreResult> {
  const { mixtape: m, tracks } = snapshotOf(item, "mixtape");
  const notes: string[] = [];

  let number = m.number;
  const [numberTaken] = await tx
    .select({ id: mixtapes.id })
    .from(mixtapes)
    .where(eq(mixtapes.number, number));
  if (numberTaken) {
    const [last] = await tx.select({ n: max(mixtapes.number) }).from(mixtapes);
    number = (last?.n ?? 0) + 1;
    if (number > MAX_NUMBER) {
      throw new StudioError(
        `o número ${m.number} está ocupado e a estante está cheia: libere um número antes de restaurar.`,
      );
    }
    notes.push(`ficou com o número ${String(number).padStart(2, "0")}`);
  }

  let slug = m.slug;
  const [slugTaken] = await tx
    .select({ id: mixtapes.id })
    .from(mixtapes)
    .where(eq(mixtapes.slug, slug));
  if (slugTaken) {
    // Leaves room for the "-n" suffix within the 80 characters allowed.
    slug = await uniqueSlug(tx, m.slug.slice(0, 77).replace(/-+$/, ""));
    notes.push(`ficou com o endereço ${slug}`);
  }

  let featuredRank = m.featuredRank;
  if (featuredRank !== null) {
    const [rankTaken] = await tx
      .select({ id: mixtapes.id })
      .from(mixtapes)
      .where(eq(mixtapes.featuredRank, featuredRank));
    if (rankTaken) {
      notes.push(`o ${featuredRank}º lugar de destaque já estava ocupado`);
      featuredRank = null;
    }
  }

  await tx.insert(mixtapes).values({
    id: m.id,
    number,
    slug,
    title: m.title,
    theme: m.theme,
    feeling: m.feeling,
    description: m.description,
    reflection: m.reflection,
    pullQuote: m.pullQuote,
    pullQuoteCredit: m.pullQuoteCredit,
    playlistUrl: m.playlistUrl,
    year: m.year,
    coverImageId: m.coverImageId,
    detailImageId: m.detailImageId,
    detailCaption: m.detailCaption,
    featuredRank,
    status: "draft",
    publishedAt: null,
    createdAt: new Date(m.createdAt),
  });

  // Every song is resolved before its track is written; a second track that
  // resolves to a song already on the tape stays in the trash.
  const onTape = new Set<string>();
  let position = 0;
  for (const t of [...tracks].sort((a, b) => a.position - b.position)) {
    const existing = await existingSong(tx, t.song);
    if (existing && onTape.has(existing.id)) {
      const held: TrackSnapshot = {
        id: t.id,
        mixtapeId: m.id,
        mixtapeTitle: m.title,
        position: t.position,
        note: t.note,
        noteSide: t.noteSide,
        createdAt: t.createdAt,
        song: t.song,
      };
      await putInTrash(tx, {
        kind: "track",
        subjectId: t.id,
        label: trackLabel(held),
        snapshot: { track: held },
        dates: item,
      });
      notes.push(
        `${t.song.title} ficou na lixeira: outra faixa da fita já é essa música (renomeie uma delas para restaurá-la)`,
      );
      continue;
    }
    const songId = await songFor(tx, t.song, existing, notes);
    onTape.add(songId);
    await tx.insert(mixtapeTracks).values({
      id: t.id,
      mixtapeId: m.id,
      songId,
      position: ++position,
      note: t.note,
      noteSide: t.noteSide,
      createdAt: new Date(t.createdAt),
    });
  }

  await tx.delete(trashItems).where(eq(trashItems.id, item.id));
  return {
    kind: "mixtape",
    id: m.id,
    message: [`${m.title} voltou como rascunho`, ...notes].join("; ") + ".",
  };
}

async function restoreSong(
  tx: Database,
  item: Item,
  confirmed: readonly string[],
): Promise<RestoreResult> {
  const plan = await planSong(tx, item, true);
  requireConfirmation(
    plan.back.map((b) => b.tape),
    confirmed,
  );
  const { song } = plan;
  const notes: string[] = [];
  let songId: string;
  if (plan.existing) {
    songId = plan.existing.id;
    if (plan.existing.merged) {
      notes.push("juntou-se à música de mesmo nome no catálogo");
    }
  } else {
    await tx.insert(songs).values({
      id: song.id,
      title: song.title,
      artist: song.artist,
      createdAt: new Date(song.createdAt),
    });
    songId = song.id;
  }

  for (const { track, tape } of plan.back) {
    await insertTrackAt(tx, tape.id, { ...track, songId }, track.position);
  }
  for (const { track, tape, liveTrackId } of plan.onTapeAlready) {
    await keepNote(
      tx,
      item,
      liveTrackId,
      `nota anterior de ${song.title} em ${tape.title}`,
      track.note,
    );
    notes.push(
      `${tape.title} já tinha essa música${track.note ? "; a nota antiga ficou no histórico da faixa" : ""}`,
    );
  }
  for (const track of plan.tapeInTrash) {
    const snapshot: TrackSnapshot = {
      id: track.id,
      mixtapeId: track.mixtapeId,
      mixtapeTitle: track.mixtapeTitle,
      position: track.position,
      note: track.note,
      noteSide: track.noteSide,
      createdAt: track.createdAt,
      song: { id: songId, title: song.title, artist: song.artist },
    };
    await putInTrash(tx, {
      kind: "track",
      subjectId: track.id,
      label: trackLabel(snapshot),
      snapshot: { track: snapshot },
      dates: item,
    });
    notes.push(
      `a faixa de ${track.mixtapeTitle} ficou na lixeira, junto com a fita`,
    );
  }
  for (const track of plan.tapeGone) {
    await keepNote(
      tx,
      item,
      track.id,
      `nota de ${song.title} em ${track.mixtapeTitle}`,
      track.note,
    );
    notes.push(
      `${track.mixtapeTitle} não existe mais${track.note ? "; a nota ficou guardada" : ""}`,
    );
  }

  await tx.delete(trashItems).where(eq(trashItems.id, item.id));
  const where = plan.back.map((b) => b.tape.title);
  return {
    kind: "song",
    id: songId,
    message:
      [
        `${song.title} voltou${where.length > 0 ? ` para ${where.join(", ")}` : " ao catálogo"}`,
        ...notes,
      ].join("; ") + ".",
  };
}

async function restoreTrack(
  tx: Database,
  item: Item,
  confirmed: readonly string[],
): Promise<RestoreResult> {
  const { track, tape, existing } = await planTrack(tx, item, true);
  requireConfirmation([tape], confirmed);
  const notes: string[] = [];
  const songId = await songFor(tx, track.song, existing, notes);
  await insertTrackAt(tx, tape.id, { ...track, songId }, track.position);
  await tx.delete(trashItems).where(eq(trashItems.id, item.id));
  return {
    kind: "track",
    id: track.id,
    message:
      [`${track.song.title} voltou para ${tape.title}`, ...notes].join("; ") +
      ".",
  };
}

async function restoreImage(tx: Database, item: Item): Promise<RestoreResult> {
  const { image } = snapshotOf(item, "image");
  await tx.insert(images).values({
    ...image,
    createdAt: new Date(image.createdAt),
  });
  const copied = await tx.execute(sql`
    insert into image_files (image_id, content_type, byte_size, bytes)
    select ${image.id}, content_type, byte_size, bytes
    from trash_files where trash_item_id = ${item.id}
  `);
  if (copied.rowCount !== 1) {
    throw new StudioError("os arquivos dessa foto não estão na lixeira.");
  }
  await tx.delete(trashItems).where(eq(trashItems.id, item.id));
  return {
    kind: "image",
    id: image.id,
    message: "a foto voltou para a biblioteca.",
  };
}

/** Errors a concurrent change can cause; the restore is rolled back. */
const CONCURRENT = new Set(["23505", "23503", "23001", "40P01", "40001"]);

/**
 * Restores one item in a single transaction. A tape always comes back as a
 * draft. A song or a track that would change a published tape needs that
 * tape's id in `confirmedTapeIds`; otherwise RestoreNeedsConfirmation is
 * thrown and nothing is written. On any failure the item stays in the trash.
 */
export async function restoreFromTrash(
  db: Database,
  itemId: string,
  options: { confirmedTapeIds?: readonly string[] } = {},
): Promise<RestoreResult> {
  const confirmed = options.confirmedTapeIds ?? [];
  try {
    return await db.transaction(async (tx) => {
      // The same lock creating or reordering a tape takes, taken before the
      // item, so a free number, address, or place stays free until written.
      await tx.execute(sql`lock table ${mixtapes} in share row exclusive mode`);
      const item = await readItem(tx, itemId, true);
      switch (item.kind as TrashKind) {
        case "mixtape":
          return restoreMixtape(tx, item);
        case "song":
          return restoreSong(tx, item, confirmed);
        case "track":
          return restoreTrack(tx, item, confirmed);
        case "image":
          return restoreImage(tx, item);
        default:
          throw new StudioError("esse item não pode ser restaurado.");
      }
    });
  } catch (error) {
    if (error instanceof StudioError) throw error;
    if (CONCURRENT.has(pgCode(error) ?? "")) {
      throw new StudioError("algo mudou enquanto restaurava; tente de novo.");
    }
    throw error;
  }
}
