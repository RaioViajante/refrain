import "server-only";

import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import type { z } from "zod";

import {
  databaseErrorOf,
  locales,
  schema,
  type Locale,
  type Transaction,
} from "@/db";
import type { ProposedChange, ProposedReflection } from "@/modules/publication";

import { documentToText, editableText, textToDocument } from "./body";
import { JournalError } from "./errors";
import type { saveAlbumJournalInput } from "./input";

// Track reflections inside the album-journal save (docs/data-model.md,
// transaction boundary 3). `prepareChange` validates what the save names
// against the rows and turns it into the `ProposedChange` that the
// Publication module weighs; `writeReflection` is the only writer of
// `track_reflections` and `track_reflection_texts`, and it runs under the
// entry lock, after the confirmation gate, never before.
//
// No explicit lock is taken on a catalog row (ADR 0006 § 7, L3): the checks
// below are plain reads, and the foreign-key check that an insert triggers is
// the only catalog lock this transaction holds.

export type ParsedSave = z.output<typeof saveAlbumJournalInput>;

/**
 * Validates a save against the stored rows, and returns what it would change
 * in the form the Publication module weighs. Nothing is written. Throws
 * `entry_not_found`, `unsupported_content`, `track_not_in_album`, or
 * `track_archived`, in that order of the save's own fields.
 *
 * Works inside the locked save and inside the preview's read-only snapshot, so
 * the two refuse exactly the same requests.
 */
export async function prepareChange(
  tx: Transaction,
  data: ParsedSave,
  journal: { albumId: string },
): Promise<ProposedChange> {
  const change: ProposedChange = {};

  if (data.opening !== undefined || data.body !== undefined) {
    const [stored] = await tx
      .select({
        locale: schema.entryTexts.locale,
        body: schema.entryTexts.body,
      })
      .from(schema.entryTexts)
      .where(
        and(
          eq(schema.entryTexts.entryId, data.entryId),
          eq(schema.entryTexts.isOriginal, true),
        ),
      );
    if (!stored) {
      throw new JournalError("entry_not_found");
    }
    const version: NonNullable<ProposedChange["version"]> = {
      locale: stored.locale,
    };
    if (data.opening !== undefined) {
      version.opening = data.opening;
    }
    if (data.body !== undefined) {
      // The stored text is only replaced when the editor reproduces it
      // exactly. Otherwise it is left untouched.
      if (editableText(stored.body) === null) {
        throw new JournalError("unsupported_content");
      }
      const document = textToDocument(data.body ?? "");
      version.body = {
        document,
        text: document ? documentToText(document)! : "",
      };
    }
    change.version = version;
  }

  if (data.albumRating !== undefined) {
    change.albumRating = data.albumRating;
  }

  const named = data.reflections ?? [];
  if (named.length > 0) {
    const trackIds = named.map((reflection) => reflection.trackId);
    const members = await tx
      .select({
        trackId: schema.albumTracks.trackId,
        archived: isNotNull(schema.tracks.archivedAt),
      })
      .from(schema.albumTracks)
      .innerJoin(
        schema.tracks,
        eq(schema.tracks.id, schema.albumTracks.trackId),
      )
      .where(
        and(
          eq(schema.albumTracks.albumId, journal.albumId),
          inArray(schema.albumTracks.trackId, trackIds),
        ),
      );
    const stored = await tx
      .select({
        trackId: schema.trackReflections.trackId,
        locale: schema.trackReflectionTexts.locale,
        body: schema.trackReflectionTexts.body,
      })
      .from(schema.trackReflections)
      .leftJoin(
        schema.trackReflectionTexts,
        eq(
          schema.trackReflectionTexts.trackReflectionId,
          schema.trackReflections.id,
        ),
      )
      .where(
        and(
          eq(schema.trackReflections.albumJournalId, data.entryId),
          inArray(schema.trackReflections.trackId, trackIds),
        ),
      );

    change.reflections = named.map((reflection) => {
      const member = members.find(
        (item) => item.trackId === reflection.trackId,
      );
      if (!member) {
        throw new JournalError("track_not_in_album");
      }
      const rows = stored.filter((row) => row.trackId === reflection.trackId);
      // A new reflection cannot start on an archived recording. One that
      // already exists stays editable: archiving never locks the writing.
      if (member.archived && rows.length === 0) {
        throw new JournalError("track_archived");
      }

      const proposed: ProposedReflection = { trackId: reflection.trackId };
      if (reflection.isPublished !== undefined) {
        proposed.isPublished = reflection.isPublished;
      }
      if (reflection.isStillWriting !== undefined) {
        proposed.isStillWriting = reflection.isStillWriting;
      }
      if (reflection.isFavourite !== undefined) {
        proposed.isFavourite = reflection.isFavourite;
      }
      if (reflection.ratingHalfSteps !== undefined) {
        proposed.ratingHalfSteps = reflection.ratingHalfSteps;
      }
      if (reflection.texts) {
        proposed.texts = {};
        for (const locale of locales) {
          const text = reflection.texts[locale];
          if (text === undefined) {
            continue;
          }
          const current = rows.find((row) => row.locale === locale);
          if (current && editableText(current.body) === null) {
            throw new JournalError("unsupported_content");
          }
          const document = text === null ? null : textToDocument(text);
          proposed.texts[locale] = document
            ? { document, text: documentToText(document)! }
            : null;
        }
      }
      return proposed;
    });
  }
  return change;
}

/**
 * Writes one track reflection: its row, created on first use, and its texts
 * (one row per language, removed when the text is cleared, so a row always
 * means text). Called under the entry lock, after the confirmation gate.
 * Another language's text is never touched.
 */
export async function writeReflection(
  tx: Transaction,
  entryId: string,
  albumId: string,
  reflection: ProposedReflection,
): Promise<void> {
  const columns: {
    isPublished?: boolean;
    isStillWriting?: boolean;
    isFavourite?: boolean;
    ratingHalfSteps?: number | null;
  } = {};
  if (reflection.isPublished !== undefined) {
    columns.isPublished = reflection.isPublished;
  }
  if (reflection.isStillWriting !== undefined) {
    columns.isStillWriting = reflection.isStillWriting;
  }
  if (reflection.isFavourite !== undefined) {
    columns.isFavourite = reflection.isFavourite;
  }
  if (reflection.ratingHalfSteps !== undefined) {
    columns.ratingHalfSteps = reflection.ratingHalfSteps;
  }

  const [existing] = await tx
    .select({ id: schema.trackReflections.id })
    .from(schema.trackReflections)
    .where(
      and(
        eq(schema.trackReflections.albumJournalId, entryId),
        eq(schema.trackReflections.trackId, reflection.trackId),
      ),
    );

  let reflectionId: string;
  if (existing) {
    reflectionId = existing.id;
    // `updated_at` moves with every save of the reflection, text included.
    await tx
      .update(schema.trackReflections)
      .set({ ...columns, updatedAt: sql`now()` })
      .where(eq(schema.trackReflections.id, reflectionId));
  } else {
    try {
      const [created] = await tx
        .insert(schema.trackReflections)
        .values({
          albumJournalId: entryId,
          albumId,
          trackId: reflection.trackId,
          ...columns,
        })
        .returning({ id: schema.trackReflections.id });
      reflectionId = created!.id;
    } catch (error) {
      // The recording left the album between the check and the insert (a
      // tracklist rewrite): a domain failure, never a raw database error.
      if (
        databaseErrorOf(error)?.constraint ===
        "track_reflections_album_track_fk"
      ) {
        throw new JournalError("track_not_in_album");
      }
      throw error;
    }
  }

  for (const locale of Object.keys(reflection.texts ?? {}) as Locale[]) {
    const text = reflection.texts![locale];
    if (text === null || text === undefined) {
      await tx
        .delete(schema.trackReflectionTexts)
        .where(
          and(
            eq(schema.trackReflectionTexts.trackReflectionId, reflectionId),
            eq(schema.trackReflectionTexts.locale, locale),
          ),
        );
      continue;
    }
    await tx
      .insert(schema.trackReflectionTexts)
      .values({
        trackReflectionId: reflectionId,
        locale,
        body: text.document,
        bodyText: text.text,
      })
      .onConflictDoUpdate({
        target: [
          schema.trackReflectionTexts.trackReflectionId,
          schema.trackReflectionTexts.locale,
        ],
        set: {
          body: text.document,
          bodyText: text.text,
          updatedAt: sql`now()`,
        },
      });
  }
}
