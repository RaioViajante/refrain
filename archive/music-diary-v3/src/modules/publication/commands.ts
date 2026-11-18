import "server-only";

import { sql } from "drizzle-orm";

import {
  isOneOf,
  type DatabaseExecutor,
  type Locale,
  type Transaction,
  type VisibilityStatus,
} from "@/db";
import type { AuthorizedAuthor } from "@/modules/identity";

import { PublicationError, type PublicationFailure } from "./errors";
import { lockEntry, lockLiveEntry } from "./lock";
import { isNormalizedSlug, suffixSlug } from "./slug";

export { PublicationError, type PublicationFailure };

// Publication commands other than publishing itself: unpublishing, restoring,
// slug changes, and the slug rules around permanent deletion. Each runs in
// one transaction (data model, transaction boundaries 4 and 6); called with a
// transaction, it runs in a savepoint of it.
//
// There is deliberately no function here that makes a version public. That is
// `publishLanguageVersion` in ./publish, which verifies a confirmation token
// under the entry lock (ADR 0006 § 9). Commands that take the
// `AuthorizedAuthor` do so as the type-level signal of ADR 0006 § 10; the
// others authorize nothing by themselves, and callers check the author's
// session first (docs/security.md).

const unpublishedStatuses = ["draft", "private"] as const;

/**
 * Unpublishes one language version, moving it to `draft` or `private`.
 * `published_at` is cleared; the publication history (`first_published_at`
 * on the version and on the entry) is kept. Nothing is deleted.
 *
 * It can only reduce what the public sees, so it needs no confirmation token
 * (ADR 0006 § 4; owner decision R4). Setting the version's `updated_at` is
 * what invalidates a token issued before it.
 */
export async function unpublishLanguageVersion(
  db: DatabaseExecutor,
  _author: AuthorizedAuthor,
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
 * Restores an entry from Recently deleted, in the caller's transaction, under
 * the owner-accepted restoration policy (docs/roadmap.md):
 *
 * - every language version that is `published` returns as `private`, with
 *   `published_at` cleared, so a restore never makes writing public. Versions
 *   that are `draft` or `private` keep that status;
 * - the publication history (`first_published_at` on each version and on the
 *   entry), the writing, the slugs and their `was_published` marks, and the
 *   entry's `version` are not touched, so every slug rule of ADR 0002 and
 *   ADR 0003 stays in force and the current slug stays current;
 * - `deleted_at` is cleared in the same transaction as the demotion, so no
 *   other connection can ever see a live entry with a published version.
 *
 * Refused with `entry_not_deleted` when the entry is not in Recently deleted,
 * which is also what a repeated or concurrent second restore receives: the
 * entry row lock serializes them, and only the first finds it deleted.
 * Returns the locales that were published and are now private.
 *
 * Must run inside a transaction that already holds the caller's own checks
 * (the kind of entry, the author). It authorizes nothing by itself.
 */
export async function restoreDeletedEntry(
  tx: Transaction,
  entryId: string,
): Promise<{ madePrivate: Locale[] }> {
  const entry = await lockEntry(tx, entryId);
  if (!entry.deleted) {
    throw new PublicationError("entry_not_deleted");
  }
  // Demote first and undelete second. Both are in this transaction, so the
  // order is invisible to other connections; it keeps the statement that can
  // make the entry visible last.
  const demoted = await tx.execute<{ locale: Locale }>(sql`
    update entry_texts
       set status = 'private', published_at = null, updated_at = now()
     where entry_id = ${entryId} and status = 'published'
    returning locale`);
  await tx.execute(sql`
    update entries set deleted_at = null, updated_at = now()
     where id = ${entryId}`);
  return { madePrivate: demoted.rows.map((row) => row.locale).sort() };
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

// More collisions than this on one base is not a collision but a bug.
const MAX_SLUG_ATTEMPTS = 100;

/**
 * Reserves an entry's first current slug, inside the transaction that creates
 * the entry (data model, transaction boundary 2): `base`, then `base-2`,
 * `base-3`, ... until one is free (ADR 0002, D7.3). The slug is never marked
 * as published: it becomes a public address only when a version is published.
 *
 * Safe under concurrency: each attempt is an `INSERT ... ON CONFLICT DO
 * NOTHING`, which waits for a concurrent claim of the same slug to finish and
 * then moves on to the next candidate, so two entries never share a slug and
 * a collision never surfaces as a database error.
 *
 * `base` must already be normalized (see `normalizeSlug`) and non-empty. Must
 * run in a transaction that holds the entry row, before the entry is visible.
 * Refused with `slug_taken` only if every candidate is taken.
 */
export async function reserveInitialSlug(
  tx: Transaction,
  entryId: string,
  base: string,
): Promise<string> {
  if (!isNormalizedSlug(base)) {
    throw new PublicationError("invalid_slug");
  }
  const entry = await lockLiveEntry(tx, entryId);
  for (let attempt = 1; attempt <= MAX_SLUG_ATTEMPTS; attempt++) {
    const slug = suffixSlug(base, attempt);
    const inserted = await tx.execute<{ slug: string }>(sql`
      insert into entry_slugs (kind, slug, entry_id, is_current, was_published)
      values (${entry.kind}, ${slug}, ${entryId}, true, false)
      on conflict (kind, slug) do nothing
      returning slug`);
    if (inserted.rows.length > 0) {
      return slug;
    }
  }
  throw new PublicationError("slug_taken");
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
