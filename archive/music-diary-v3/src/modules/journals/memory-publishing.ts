import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import type { DatabaseExecutor, Locale, VisibilityStatus } from "@/db";
import type { AuthorizedAuthor } from "@/modules/identity";
import {
  previewPublication,
  publishLanguageVersion,
  type PublicChangeDelta,
  type PublicMemoryMusic,
} from "@/modules/publication";

import { textToParagraphs } from "./body";
import { translatePublication } from "./commands";
import { JournalError } from "./errors";
import { previewMemoryChange } from "./memories";
import {
  readable,
  type PublicChangePreviewReview,
  type PublicChangeReview,
  type ReviewedChange,
  type ReviewText,
} from "./publishing";

// The Writing Studio's way to preview and to publish a memory (M3.7), and to
// review a change to a published one (ADR 0006 § 9: "a studio action calls a
// Journals wrapper that checks the entry's kind and calls the Publication
// engine"). The same engine, token, and rules as an album journal's; only the
// kind check and the words differ. Presentation never names the Publication
// commands.
//
// Three wrappers, and nothing here calls a preview together with its consumer:
//
//   previewMemoryPublication   reads the disclosure and mints a `publish` token.
//   publishMemoryVersion       consumes a token that the caller got from a
//                              separate preview request.
//   previewMemoryPublicChange  reads the delta of a save and, when there is
//                              one, mints a `change_public` token; `saveMemory`
//                              consumes it.
//
// The kind check reads the subtype table without a lock. An entry's kind never
// changes, and the Publication engine takes the entry lock itself after it has
// authenticated the token, so a forged token never holds a lock (ADR 0006 § 4,
// step 2). The album-journal wrappers check their own kind, so neither pair
// can act on the other's entries.

/** One song as the review names it: the same words and links as the page. */
export type ReviewedMemoryMusic = PublicMemoryMusic;

/**
 * Exactly what publishing a memory makes public, as the dialog shows it.
 * Private writing: returned only to an authorized request, never logged. It
 * carries no token.
 */
export interface MemoryPublicationReview {
  entryId: string;
  locale: Locale;
  /** `entries.version` the disclosure was computed at. */
  entryVersion: number;
  /** The status the version has now; publishing moves it to `published`. */
  status: VisibilityStatus;
  title: string | null;
  /** "A date, a season, a year", or null when the memory has none. */
  rememberedWhen: string | null;
  text: ReviewText;
  /** The address that will be public: `/memories/<slug>`. */
  address: { slug: string; wasPublic: boolean };
  /** The songs, in order, with the words and links the page shows. */
  music: ReviewedMemoryMusic[];
}

export interface MemoryPublicationPreview {
  review: MemoryPublicationReview;
  /** The confirmation token. It goes only to the dialog that shows `review`. */
  confirmation: string;
  expiresAtMs: number;
}

// Loose on purpose: the Publication engine validates the whole input strictly,
// and an unknown key is `invalid_input` there. This only finds the entry.
const target = z.object({ entryId: z.uuid() });

async function assertMemory(
  db: DatabaseExecutor,
  input: unknown,
): Promise<void> {
  const parsed = target.safeParse(input);
  if (!parsed.success) {
    throw new JournalError("invalid_input");
  }
  const found = await db.execute(sql`
    select 1 from memories where entry_id = ${parsed.data.entryId}`);
  if (found.rows.length === 0) {
    throw new JournalError("entry_not_found");
  }
}

/**
 * Previews publishing one language version of a memory (ADR 0006 §§ 2 and 3):
 * the title, the writing, the "when", the songs as the page names and links
 * them, and the address, with the confirmation token for exactly that. One
 * read-only snapshot: it writes nothing, holds no lock, and changes no
 * visibility.
 *
 * Refused: `invalid_input`, `unavailable`, `entry_not_found` (also for an
 * entry that is not a memory, and for a missing language version),
 * `entry_deleted`, `nothing_to_publish` (no writing, or no title),
 * `no_current_slug`.
 *
 * The token is evidence that this server computed this disclosure for this
 * session. It is not proof that the author read it, and nothing may say so.
 */
export async function previewMemoryPublication(
  db: DatabaseExecutor,
  author: AuthorizedAuthor,
  input: unknown,
): Promise<MemoryPublicationPreview> {
  return translatePublication(() =>
    db.transaction(
      async (tx) => {
        await assertMemory(tx, input);
        const preview = await previewPublication(tx, author, input);
        const { disclosure } = preview;
        return {
          review: {
            entryId: disclosure.entryId,
            locale: disclosure.locale,
            entryVersion: disclosure.entryVersion,
            status: disclosure.status,
            title: disclosure.version.title,
            rememberedWhen: disclosure.memory?.rememberedWhen?.trim()
              ? disclosure.memory.rememberedWhen
              : null,
            text: readable(disclosure.version.body),
            address: disclosure.address,
            music: disclosure.memoryMusic,
          },
          confirmation: preview.confirmation,
          expiresAtMs: preview.expiresAtMs,
        };
      },
      { isolationLevel: "repeatable read", accessMode: "read only" },
    ),
  );
}

/**
 * Publishes one language version of a memory, with the confirmation token
 * that a separate preview request returned and the dialog sent (ADR 0006
 * § 4). Everything is decided by the Publication engine, in one transaction
 * under the entry lock: this wrapper adds only the kind check and the
 * translation of failures. Draft and Private take the same path.
 *
 * Refused, writing nothing: everything `previewMemoryPublication` refuses,
 * `version_conflict`, `confirmation_required`, `confirmation_invalid`,
 * `confirmation_expired`, `confirmation_stale`. A refusal carries no token.
 *
 * Returns `changed: false` for a version that is already public with an
 * unchanged disclosure.
 */
export async function publishMemoryVersion(
  db: DatabaseExecutor,
  author: AuthorizedAuthor,
  input: unknown,
): Promise<{ changed: boolean }> {
  return translatePublication(async () => {
    await assertMemory(db, input);
    return publishLanguageVersion(db, author, input);
  });
}

const MEMORY_FIELD_LABELS = {
  title: "Title",
  opening: "Opening sentence",
  marginNote: "Margin note",
  body: "The memory",
} as const;

/** A song as the change review names it: its title, then its artists. */
function songLabel(song: { title: string; artists: string[] }): string {
  return song.artists.length > 0
    ? `${song.title} · ${song.artists.join(", ")}`
    : song.title;
}

/**
 * The delta of a proposed save of a memory, in words and plain text for the
 * confirmation dialog. Every change to the songs (one added, one moved) is
 * shown as one change, "The music", with the list published now and the list
 * published after saving, because a reader sees the list, not its pairs.
 * Private writing; for an authorized request only.
 */
export function toMemoryChangeReview(
  delta: PublicChangeDelta,
  music: { before: string[]; after: string[] },
): PublicChangeReview {
  const changes: ReviewedChange[] = [];
  let musicChanged = false;
  for (const change of delta.changes) {
    const subject = change.subject;
    if (subject.type === "version") {
      changes.push({
        kind: change.kind,
        label: MEMORY_FIELD_LABELS[subject.field],
        locale: subject.locale,
        before:
          change.before === undefined ? undefined : textValue(change.before),
        after: textValue(change.after),
      });
    } else if (subject.type === "memoryWhen") {
      changes.push({
        kind: change.kind,
        label: "When",
        before:
          change.before === undefined ? undefined : textValue(change.before),
        after: textValue(change.after),
      });
    } else if (
      subject.type === "memoryLink" ||
      subject.type === "memoryOrder"
    ) {
      musicChanged = true;
    } else {
      throw new Error("An album journal's change was reviewed as a memory's.");
    }
  }
  if (musicChanged) {
    changes.push({
      kind: music.before.length > 0 ? "edited" : "added",
      label: "The music",
      before:
        music.before.length > 0
          ? { type: "list", items: music.before }
          : undefined,
      after: { type: "list", items: music.after },
    });
  }
  return { entryVersion: delta.entryVersion, changes };
}

function textValue(value: unknown): { type: "text"; text: ReviewText } {
  return {
    type: "text",
    text:
      typeof value === "string"
        ? textToParagraphs(value)
        : value === null || value === undefined
          ? []
          : readable(value),
  };
}

/**
 * Previews a save of a memory for the confirmation dialog (ADR 0006 § 5):
 * what a reader would see added or changed, in plain text, with the
 * `change_public` token for exactly that change. It takes the save's input,
 * makes the save's refusals, and writes nothing. The songs' names come from
 * a separate read in the same snapshot, because they are labels and not part
 * of what is confirmed (the token binds the songs themselves and their order).
 */
export async function previewMemoryPublicChange(
  db: DatabaseExecutor,
  author: AuthorizedAuthor,
  input: unknown,
): Promise<PublicChangePreviewReview> {
  // One read-only snapshot for the delta and the songs' names, so the lists
  // shown are those of the state the token binds.
  return db.transaction(
    async (tx) => {
      const preview = await previewMemoryChange(tx, author, input);
      const touchesMusic = preview.delta.changes.some(
        (change) =>
          change.subject.type === "memoryLink" ||
          change.subject.type === "memoryOrder",
      );
      let music = { before: [] as string[], after: [] as string[] };
      if (touchesMusic) {
        music = await songListsOf(tx, preview.delta.entryId, input);
      }
      return {
        review: toMemoryChangeReview(preview.delta, music),
        confirmation: preview.confirmation,
        expiresAtMs: preview.expiresAtMs,
      };
    },
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
}

const proposedList = z.object({
  trackIds: z.array(z.uuid().transform((id) => id.toLowerCase())).optional(),
});

/**
 * The songs published now and after the save, by their names. `before` is the
 * memory's list as stored; `after` is the list the save names (the preview
 * has already validated it), or the stored one when it names none.
 */
async function songListsOf(
  db: DatabaseExecutor,
  memoryId: string,
  input: unknown,
): Promise<{ before: string[]; after: string[] }> {
  const stored = await db.execute<{
    track_id: string | null;
    title: string;
    artists: string[];
  }>(sql`
    select mm.track_id, coalesce(t.title, a.title) as title,
           coalesce((select json_agg(ar.name order by ta.position)
                       from track_artists ta
                       join artists ar on ar.id = ta.artist_id
                      where ta.track_id = mm.track_id), '[]'::json) as artists
      from memory_music mm
      left join tracks t on t.id = mm.track_id
      left join albums a on a.id = mm.album_id
     where mm.memory_id = ${memoryId}
     order by mm.position asc, mm.id asc`);
  const before = stored.rows.map((row) => songLabel(row));
  const proposed = proposedList.safeParse(input);
  const trackIds =
    proposed.success && proposed.data.trackIds !== undefined
      ? proposed.data.trackIds
      : null;
  if (trackIds === null) {
    return { before, after: before };
  }
  const named = new Map<string, string>();
  if (trackIds.length > 0) {
    const found = await db.execute<{
      id: string;
      title: string;
      artists: string[];
    }>(sql`
      select t.id, t.title,
             coalesce((select json_agg(ar.name order by ta.position)
                         from track_artists ta
                         join artists ar on ar.id = ta.artist_id
                        where ta.track_id = t.id), '[]'::json) as artists
        from tracks t
       where t.id in (${sql.join(
         trackIds.map((id) => sql`${id}`),
         sql`, `,
       )})`);
    for (const row of found.rows) {
      named.set(row.id, songLabel(row));
    }
  }
  return {
    before,
    after: trackIds.map((id) => named.get(id) ?? "A song"),
  };
}
