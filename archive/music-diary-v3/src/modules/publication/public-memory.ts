import "server-only";

import { sql } from "drizzle-orm";

import type { DatabaseExecutor, Locale } from "@/db";

import { readMemoryMusic, type PublicMemoryMusic } from "./memory-music";
import { choosePublicVersion } from "./public-album-journal";
import { publicLanguageVersions } from "./predicate";
import {
  getPublicLanguageVersion,
  listPublicLanguageVersions,
  servedMemoryAddresses,
} from "./queries";
import { isFilled } from "./text";

// The read model of a public memory page (M3.7). A memory is shown only while
// one of its language versions is publicly visible (the publication
// predicate, `predicate.ts`), at its served address, and the page shows only
// what a reader may see: the title, the writing, the remembered-when text,
// the publication date and language of the version shown, and its music with
// catalog wording (`memory-music.ts`). No status, no deletion state, no
// unpublished language, no identifier, and no track reflection of any album
// journal: a memory is independent writing.

export type { PublicMemoryArtist, PublicMemoryMusic } from "./memory-music";

export interface PublicMemory {
  /** The page's own address is `/memories/<slug>`. */
  slug: string;
  /** The language of the version shown, and whether it is the original. */
  locale: Locale;
  isOriginal: boolean;
  /** When the version shown was published. */
  publishedAt: Date;
  title: string;
  body: unknown;
  /** "A date, a season, a year", when the memory has one. */
  rememberedWhen: string | null;
  music: PublicMemoryMusic[];
}

/**
 * The public page of a memory, or null when no language version of it is
 * publicly visible (or it stopped being visible between statements).
 * `readerLocale` selects the version only (ADR 0002, D1.2).
 */
export async function getPublicMemory(
  db: DatabaseExecutor,
  entryId: string,
  readerLocale: Locale,
): Promise<PublicMemory | null> {
  const chosen = choosePublicVersion(
    await listPublicLanguageVersions(db, entryId),
    readerLocale,
  );
  if (!chosen) {
    return null;
  }
  const version = await getPublicLanguageVersion(db, entryId, chosen.locale);
  if (!version || version.kind !== "memory") {
    return null;
  }

  // Each statement below starts from the visible language version or the
  // served address, so a memory that stopped being visible in between yields
  // nothing.
  const head = await db.execute<{
    remembered_when: string | null;
    slug: string;
  }>(sql`
    select m.remembered_when, served.slug
      from (${publicLanguageVersions}) pv
      join memories m on m.entry_id = pv.entry_id
      join (${servedMemoryAddresses}) served on served.entry_id = pv.entry_id
     where pv.entry_id = ${entryId} and pv.locale = ${version.locale}`);
  const row = head.rows[0];
  if (!row) {
    return null;
  }
  const music = await readMemoryMusic(db, entryId, { onlyIfPublic: true });

  return {
    slug: row.slug,
    locale: version.locale,
    isOriginal: version.isOriginal,
    publishedAt: version.publishedAt,
    // The memory commands require a title, and publishing refuses a memory
    // without one; only a write outside the application could leave it empty.
    title: version.title ?? "",
    body: version.body,
    rememberedWhen: isFilled(row.remembered_when) ? row.remembered_when : null,
    music,
  };
}

/**
 * The current address of every publicly visible memory, for the sitemap:
 * exactly the addresses `resolvePublicSlug` finds for a memory.
 */
export async function listPublicMemoryAddresses(
  db: DatabaseExecutor,
): Promise<string[]> {
  const result = await db.execute<{ slug: string }>(sql`
    select served.slug
      from (${servedMemoryAddresses}) served
     order by served.slug asc`);
  return result.rows.map((row) => row.slug);
}
