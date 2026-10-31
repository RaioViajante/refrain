import "server-only";

import { sql } from "drizzle-orm";

import {
  isOneOf,
  type DatabaseExecutor,
  type EntryKind,
  type Locale,
  type Transaction,
  type VisibilityStatus,
} from "@/db";

import { isNormalizedSlug } from "./slug";

// Publication commands: visibility transitions and slug changes. Each runs in
// one transaction (data model, transaction boundaries 4 and 6); called with a
// transaction, it runs in a savepoint of it. They hold no authorization
// logic: callers check the author's session first (docs/security.md).

export type PublicationFailure =
  | "entry_not_found"
  | "entry_deleted"
  | "entry_not_deleted"
  | "version_not_found"
  | "no_current_slug"
  | "invalid_status"
  | "invalid_slug"
  | "slug_taken";

export class PublicationError extends Error {
  override name = "PublicationError";
  constructor(readonly failure: PublicationFailure) {
    super(`Publication refused: ${failure}`);
  }
}

interface LockedEntry {
  kind: EntryKind;
  deleted: boolean;
  everPublished: boolean;
}

// Locks the entry row for the rest of the transaction, so concurrent
// transitions on the same entry run one after the other.
async function lockEntry(
  tx: Transaction,
  entryId: string,
): Promise<LockedEntry> {
  const result = await tx.execute<{
    kind: EntryKind;
    deleted: boolean;
    ever_published: boolean;
  }>(sql`
    select kind, deleted_at is not null as deleted,
           first_published_at is not null as ever_published
      from entries
     where id = ${entryId}
       for update`);
  const row = result.rows[0];
  if (!row) {
    throw new PublicationError("entry_not_found");
  }
  return {
    kind: row.kind,
    deleted: row.deleted,
    everPublished: row.ever_published,
  };
}

async function lockLiveEntry(tx: Transaction, entryId: string) {
  const entry = await lockEntry(tx, entryId);
  if (entry.deleted) {
    throw new PublicationError("entry_deleted");
  }
  return entry;
}

/**
 * Publishes one language version (ADR 0002, D3.2 and D4.1).
 *
 * - `published_at` becomes now; publishing an already published version
 *   changes nothing.
 * - `first_published_at` is set only by the version's first publication and
 *   is never overwritten.
 * - `entries.first_published_at` stays the earliest first publication of any
 *   version.
 * - The entry's current slug is marked as published, so it stays reserved
 *   even after a permanent deletion (ADR 0003).
 *
 * Refused for a deleted entry, and for an entry without a current slug
 * (D7.1): published writing always has an address. Track reflections are not
 * affected (D5.2).
 */
export async function publishLanguageVersion(
  db: DatabaseExecutor,
  entryId: string,
  locale: Locale,
): Promise<void> {
  await db.transaction(async (tx) => {
    await lockLiveEntry(tx, entryId);

    const updated = await tx.execute(sql`
      update entry_texts
         set status = 'published',
             published_at = case when status = 'published'
                                 then published_at else now() end,
             first_published_at = coalesce(first_published_at, now()),
             updated_at = now()
       where entry_id = ${entryId} and locale = ${locale}
      returning locale`);
    if (updated.rows.length === 0) {
      throw new PublicationError("version_not_found");
    }

    await tx.execute(sql`
      update entries
         set first_published_at = least(
               first_published_at,
               (select min(t.first_published_at)
                  from entry_texts t
                 where t.entry_id = ${entryId})),
             updated_at = now()
       where id = ${entryId}`);

    const marked = await tx.execute(sql`
      update entry_slugs
         set was_published = true
       where entry_id = ${entryId} and is_current
      returning slug`);
    if (marked.rows.length === 0) {
      throw new PublicationError("no_current_slug");
    }
  });
}

const unpublishedStatuses = ["draft", "private"] as const;

/**
 * Unpublishes one language version, moving it to `draft` or `private`.
 * `published_at` is cleared; the publication history (`first_published_at`
 * on the version and on the entry) is kept. Nothing is deleted.
 */
export async function unpublishLanguageVersion(
  db: DatabaseExecutor,
  entryId: string,
  locale: Locale,
  status: Exclude<VisibilityStatus, "published">,
): Promise<void> {
  if (!isOneOf(unpublishedStatuses, status)) {
    throw new PublicationError("invalid_status");
  }
  await db.transaction(async (tx) => {
    await lockLiveEntry(tx, entryId);
    const updated = await tx.execute(sql`
      update entry_texts
         set status = ${status}, published_at = null, updated_at = now()
       where entry_id = ${entryId} and locale = ${locale}
      returning locale`);
    if (updated.rows.length === 0) {
      throw new PublicationError("version_not_found");
    }
  });
}

/**
 * Changes an entry's public slug (ADR 0002, D7.4 and D7.5).
 *
 * - Before the entry's first publication, the slug changes freely: the old,
 *   never-published slug is released.
 * - After it, the old slug stays as a previous slug (D7.5). It redirects
 *   while the entry is publicly visible only if it was itself ever public
 *   (`was_published`); a slug chosen while the entry was unpublished never
 *   becomes a public address once replaced. The new slug is marked as
 *   published when the entry is publicly visible now; otherwise when it is
 *   next published.
 * - Returning to one of the entry's own previous slugs makes it current again.
 * - A slug held by another entry, or retired after a permanent deletion, is
 *   refused with `slug_taken`.
 *
 * `newSlug` must already be normalized (see `normalizeSlug`).
 */
export async function changeEntrySlug(
  db: DatabaseExecutor,
  entryId: string,
  newSlug: string,
): Promise<void> {
  if (!isNormalizedSlug(newSlug)) {
    throw new PublicationError("invalid_slug");
  }
  await db.transaction(async (tx) => {
    const entry = await lockLiveEntry(tx, entryId);

    const existing = await tx.execute<{
      entry_id: string | null;
      is_current: boolean;
    }>(sql`
      select entry_id, is_current from entry_slugs
       where kind = ${entry.kind} and slug = ${newSlug}`);
    const holder = existing.rows[0];
    if (holder && holder.entry_id !== entryId) {
      throw new PublicationError("slug_taken");
    }
    if (holder?.is_current) {
      return;
    }

    const visible = await tx.execute<{ visible: boolean }>(sql`
      select exists (select 1 from entry_texts
                      where entry_id = ${entryId} and status = 'published')
             as visible`);
    const publiclyVisible = visible.rows[0]?.visible === true;

    if (!entry.everPublished) {
      // Never published, so the current slug was never public: release it.
      await tx.execute(sql`
        delete from entry_slugs
         where entry_id = ${entryId} and is_current and not was_published`);
    }
    await tx.execute(sql`
      update entry_slugs set is_current = false
       where entry_id = ${entryId} and is_current`);

    if (holder) {
      await tx.execute(sql`
        update entry_slugs
           set is_current = true,
               was_published = was_published or ${publiclyVisible}
         where kind = ${entry.kind} and slug = ${newSlug}`);
    } else {
      // A concurrent transaction may claim the same slug after the check
      // above. ON CONFLICT waits for it and then reports the slug as taken,
      // instead of failing with a raw unique violation.
      const inserted = await tx.execute(sql`
        insert into entry_slugs (kind, slug, entry_id, is_current, was_published)
        values (${entry.kind}, ${newSlug}, ${entryId}, true, ${publiclyVisible})
        on conflict (kind, slug) do nothing
        returning slug`);
      if (inserted.rows.length === 0) {
        throw new PublicationError("slug_taken");
      }
    }
  });
}

/**
 * Prepares an entry's slugs for its permanent deletion (ADR 0003). Must run
 * inside the deletion transaction, before the entry row is deleted. Refused
 * unless the entry is in Recently deleted, so it can never detach the slugs
 * of a live entry:
 *
 * - slugs that never identified published writing are deleted, so they can
 *   be used again and no trace of them remains;
 * - published slugs are retired: detached from the entry and kept with only
 *   their kind and text, so they are never reassigned to other writing.
 *
 * A retired slug resolves exactly like an unknown slug (`not_found`).
 */
export async function retireEntrySlugs(
  tx: Transaction,
  entryId: string,
): Promise<void> {
  const entry = await lockEntry(tx, entryId);
  if (!entry.deleted) {
    throw new PublicationError("entry_not_deleted");
  }
  await tx.execute(sql`
    delete from entry_slugs where entry_id = ${entryId} and not was_published`);
  await tx.execute(sql`
    update entry_slugs set entry_id = null, is_current = false
     where entry_id = ${entryId}`);
}
