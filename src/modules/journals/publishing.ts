import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import type { DatabaseExecutor, Locale, VisibilityStatus } from "@/db";
import type { AuthorizedAuthor } from "@/modules/identity";
import {
  previewPublication,
  publishLanguageVersion,
  type PublicChangeDelta,
  type PublishDisclosure,
} from "@/modules/publication";

import { documentToText, textToParagraphs } from "./body";
import { previewAlbumJournalChange, translatePublication } from "./commands";
import { JournalError } from "./errors";

// The Writing Studio's way to preview and to publish a language version of an
// album journal (ADR 0006 § 9: "a studio action calls a Journals wrapper that
// checks the entry's kind and calls the Publication engine"). Presentation
// never names the Publication commands.
//
// Two wrappers, and nothing here calls both:
//
//   previewAlbumJournalPublication  reads the disclosure and mints a token.
//   publishAlbumJournalVersion      consumes a token that the caller got from a
//                                   separate preview request.
//
// The kind check reads the subtype table without a lock. An entry's kind never
// changes and the Publication engine takes the entry lock itself, after it
// has authenticated the token, so a forged token never holds a lock
// (ADR 0006 § 4, step 2).

/**
 * A text as a person reads it: paragraphs, each a list of lines. `null` is a
 * text that the plain view cannot show without loss (it is public exactly as
 * stored; the studio says so). An absent text is an empty list.
 */
export type ReviewText = string[][] | null;

/** One track reflection that will be public in the language being published. */
export interface ReviewedReflection {
  trackId: string;
  trackTitle: string;
  locale: Locale;
  text: ReviewText;
  isFavourite: boolean;
  ratingHalfSteps: number | null;
  isStillWriting: boolean;
}

/**
 * Exactly what publishing one language version makes public, as the dialog
 * shows it, plus what stays private. Private writing: returned only to an
 * authorized request, never logged. It carries no token.
 */
export interface PublicationReview {
  entryId: string;
  locale: Locale;
  /** `entries.version` the disclosure was computed at. */
  entryVersion: number;
  /** The status the version has now; publishing moves it to `published`. */
  status: VisibilityStatus;
  opening: string | null;
  text: ReviewText;
  address: { slug: string; wasPublic: boolean };
  albumRating: { halfSteps: number; alreadyPublic: boolean } | null;
  /** The pairs (track reflection, language) that become public. */
  reflections: ReviewedReflection[];
  /** Flagged to show, but with no text in this language, so not public in it. */
  flaggedWithoutText: number;
  /**
   * Reflections written in this language that are not included when published. They stay
   * private. Titles only: their writing is not part of this review.
   */
  stayingPrivate: { trackId: string; trackTitle: string }[];
  /**
   * The artist pages publishing would open (M3.5), with their address and
   * whether each shows a photograph, and the public artist pages whose
   * address it would change. Both are bound into the confirmation.
   */
  artistPages: {
    name: string;
    address: string | null;
    photo: { title: string; credit: string; license: string } | null;
  }[];
  artistAddressChanges: { name: string; from: string; to: string | null }[];
}

export interface PublicationPreview {
  review: PublicationReview;
  /** The confirmation token. It goes only to the dialog that shows `review`. */
  confirmation: string;
  expiresAtMs: number;
}

function readable(document: unknown): ReviewText {
  const text = documentToText(document);
  return text === null ? null : textToParagraphs(text);
}

function toReview(
  disclosure: PublishDisclosure,
  stayingPrivate: PublicationReview["stayingPrivate"],
): PublicationReview {
  return {
    entryId: disclosure.entryId,
    locale: disclosure.locale,
    entryVersion: disclosure.entryVersion,
    status: disclosure.status,
    opening: disclosure.version.opening,
    text: readable(disclosure.version.body),
    address: disclosure.address,
    albumRating: disclosure.albumRating,
    reflections: disclosure.reflections.map((reflection) => ({
      trackId: reflection.trackId,
      trackTitle: reflection.trackTitle,
      locale: reflection.locale,
      text: readable(reflection.body),
      isFavourite: reflection.isFavourite,
      ratingHalfSteps: reflection.ratingHalfSteps,
      isStillWriting: reflection.isStillWriting,
    })),
    flaggedWithoutText: disclosure.flaggedWithoutText,
    stayingPrivate,
    artistPages: disclosure.artistPages.map((page) => ({
      name: page.name,
      address: page.address,
      photo: page.photo
        ? {
            title: page.photo.title,
            credit: page.photo.credit,
            license: page.photo.license,
          }
        : null,
    })),
    artistAddressChanges: disclosure.artistAddressChanges.map((change) => ({
      name: change.name,
      from: change.from,
      to: change.to,
    })),
  };
}

// Loose on purpose: the Publication engine validates the whole input strictly,
// and an unknown key is `invalid_input` there. This only finds the entry.
const target = z.object({ entryId: z.uuid() });

async function assertAlbumJournal(
  db: DatabaseExecutor,
  input: unknown,
): Promise<void> {
  const parsed = target.safeParse(input);
  if (!parsed.success) {
    throw new JournalError("invalid_input");
  }
  const found = await db.execute(sql`
    select 1 from album_journals where entry_id = ${parsed.data.entryId}`);
  if (found.rows.length === 0) {
    throw new JournalError("entry_not_found");
  }
}

/**
 * Previews publishing one language version of an album journal (ADR 0006
 * §§ 2 and 3): what readers would see, what stays private, and the
 * confirmation token for exactly that. One read-only snapshot: it writes
 * nothing, holds no lock, and changes no visibility.
 *
 * Refused: `invalid_input`, `unavailable`, `entry_not_found` (also for an
 * entry that is not an album journal, and for a missing language version),
 * `entry_deleted`, `nothing_to_publish`, `no_current_slug`.
 *
 * The token is evidence that this server computed this disclosure for this
 * session. It is not proof that the author read it, and nothing may say so.
 */
export async function previewAlbumJournalPublication(
  db: DatabaseExecutor,
  author: AuthorizedAuthor,
  input: unknown,
): Promise<PublicationPreview> {
  return translatePublication(() =>
    db.transaction(
      async (tx) => {
        await assertAlbumJournal(tx, input);
        const preview = await previewPublication(tx, author, input);
        const { entryId, locale } = preview.disclosure;
        const staying = await tx.execute<{ track_id: string; title: string }>(
          sql`
          select tr.track_id, t.title
            from track_reflections tr
            join track_reflection_texts trt
              on trt.track_reflection_id = tr.id and trt.locale = ${locale}
            join tracks t on t.id = tr.track_id
           where tr.album_journal_id = ${entryId}
             and not tr.is_published
           order by tr.id asc`,
        );
        return {
          review: toReview(
            preview.disclosure,
            staying.rows.map((row) => ({
              trackId: row.track_id,
              trackTitle: row.title,
            })),
          ),
          confirmation: preview.confirmation,
          expiresAtMs: preview.expiresAtMs,
        };
      },
      { isolationLevel: "repeatable read", accessMode: "read only" },
    ),
  );
}

/**
 * Publishes one language version of an album journal, with the confirmation
 * token that a separate preview request returned and the dialog sent (ADR 0006
 * § 4). Everything is decided by the Publication engine, in one transaction
 * under the entry lock: this wrapper adds only the kind check and the
 * translation of failures. Draft and Private take the same path, and an empty
 * disclosure needs its token too.
 *
 * Refused, writing nothing: everything `previewAlbumJournalPublication`
 * refuses, `version_conflict`, `confirmation_required`, `confirmation_invalid`,
 * `confirmation_expired`, `confirmation_stale`. A refusal carries no token.
 *
 * Returns `changed: false` for a version that is already public with an
 * unchanged disclosure.
 */
export async function publishAlbumJournalVersion(
  db: DatabaseExecutor,
  author: AuthorizedAuthor,
  input: unknown,
): Promise<{ changed: boolean }> {
  return translatePublication(async () => {
    await assertAlbumJournal(db, input);
    return publishLanguageVersion(db, author, input);
  });
}

// ---------------------------------------------------------------------------
// The review of a change to a public journal (ADR 0006 § 5).

/** One thing a reader would see added or changed on the public page. */
export interface ReviewedChange {
  kind: "added" | "edited";
  /** Words for the place on the page, for example "Your reflection". */
  label: string;
  /** The language the change is in; the album rating has none. */
  locale?: Locale;
  /** The track, for a reflection. */
  trackTitle?: string;
  before?: ReviewedValue;
  after: ReviewedValue;
}

export type ReviewedValue =
  | { type: "text"; text: ReviewText }
  | { type: "rating"; halfSteps: number | null }
  | { type: "flag"; value: boolean };

export interface PublicChangeReview {
  entryVersion: number;
  changes: ReviewedChange[];
}

const FIELD_LABELS = {
  title: "Title",
  opening: "Opening sentence",
  marginNote: "Margin note",
  body: "Your reflection",
} as const;

/**
 * The delta of a proposed save, in words and plain text for the confirmation
 * dialog. `trackTitles` names the tracks in the delta. Private writing; for an
 * authorized request only.
 */
export function toChangeReview(
  delta: PublicChangeDelta,
  trackTitles: ReadonlyMap<string, string>,
): PublicChangeReview {
  const text = (value: unknown): ReviewedValue => ({
    type: "text",
    text:
      typeof value === "string"
        ? textToParagraphs(value)
        : value === null || value === undefined
          ? []
          : readable(value),
  });
  const changes = delta.changes.map((change): ReviewedChange => {
    const subject = change.subject;
    if (subject.type === "albumRating") {
      return {
        kind: change.kind,
        label: "Your rating for the album",
        before:
          change.before === undefined
            ? undefined
            : { type: "rating", halfSteps: change.before as number | null },
        after: { type: "rating", halfSteps: change.after as number | null },
      };
    }
    if (subject.type === "version") {
      return {
        kind: change.kind,
        label: FIELD_LABELS[subject.field],
        locale: subject.locale,
        before: change.before === undefined ? undefined : text(change.before),
        after: text(change.after),
      };
    }
    const trackTitle = trackTitles.get(subject.trackId) ?? "a track";
    switch (subject.field) {
      case "text":
        return {
          kind: change.kind,
          label: "Reflection on the track",
          locale: subject.locale,
          trackTitle,
          before: change.before === undefined ? undefined : text(change.before),
          after: text(change.after),
        };
      case "rating":
        return {
          kind: change.kind,
          label: "Rating of the track",
          locale: subject.locale,
          trackTitle,
          before:
            change.before === undefined
              ? undefined
              : { type: "rating", halfSteps: change.before as number | null },
          after: { type: "rating", halfSteps: change.after as number | null },
        };
      case "favourite":
        return {
          kind: change.kind,
          label: "Marked as a favourite",
          locale: subject.locale,
          trackTitle,
          before:
            change.before === undefined
              ? undefined
              : { type: "flag", value: change.before === true },
          after: { type: "flag", value: change.after === true },
        };
      case "stillWriting":
        return {
          kind: change.kind,
          label: "Labelled “still writing”",
          locale: subject.locale,
          trackTitle,
          before:
            change.before === undefined
              ? undefined
              : { type: "flag", value: change.before === true },
          after: { type: "flag", value: change.after === true },
        };
    }
  });
  return { entryVersion: delta.entryVersion, changes };
}

export interface PublicChangePreviewReview {
  review: PublicChangeReview;
  /**
   * The confirmation token for exactly this change, or `null` when nothing a
   * reader sees would change and the save needs none. It goes only to the
   * dialog that shows `review`.
   */
  confirmation: string | null;
  expiresAtMs: number | null;
}

/**
 * Previews a save of an album journal for the confirmation dialog (ADR 0006
 * § 5): what a reader would see added or changed, in plain text, with the
 * `change_public` token for exactly that change. It takes the save's input,
 * makes the save's refusals, and writes nothing. Track titles come from a
 * separate read, because they are labels and not part of what is confirmed.
 */
export async function previewAlbumJournalPublicChange(
  db: DatabaseExecutor,
  author: AuthorizedAuthor,
  input: unknown,
): Promise<PublicChangePreviewReview> {
  const preview = await previewAlbumJournalChange(db, author, input);
  const trackIds = [
    ...new Set(
      preview.delta.changes.flatMap((change) =>
        change.subject.type === "reflection" ? [change.subject.trackId] : [],
      ),
    ),
  ];
  const titles = new Map<string, string>();
  if (trackIds.length > 0) {
    const found = await db.execute<{ id: string; title: string }>(sql`
      select id, title from tracks
       where id in (${sql.join(
         trackIds.map((id) => sql`${id}`),
         sql`, `,
       )})`);
    for (const row of found.rows) {
      titles.set(row.id, row.title);
    }
  }
  return {
    review: toChangeReview(preview.delta, titles),
    confirmation: preview.confirmation,
    expiresAtMs: preview.expiresAtMs,
  };
}
