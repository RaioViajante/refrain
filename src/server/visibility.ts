// The one place that decides what the public may see (AGENTS.md § 4). Every
// public read composes these predicates; none writes its own WHERE for it.
import { and, eq, sql, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";

import { mixtapes, siteTexts } from "@/db/schema";

/** A mixtape is public only once published. */
export const publicMixtape: SQL = eq(mixtapes.status, "published");

/** An owner's site text is public only once published. */
export const publicSiteText: SQL = eq(siteTexts.published, true);

/**
 * The join condition for an image shown on a public page: the referenced
 * image, and only if the owner confirmed the right to publish it.
 */
export function publicImageJoin(
  table: { id: PgColumn; rightsConfirmed: PgColumn },
  reference: PgColumn,
): SQL {
  return and(eq(table.id, reference), eq(table.rightsConfirmed, true))!;
}

/**
 * Whether a photograph may be served to anyone: its rights are confirmed AND
 * it is in public use (the cover or support photo of a published tape, or a
 * fixed slot of a public page). Anything else is served only to the signed-in
 * owner. Revoking rights or unpublishing the tape takes effect immediately.
 */
export function photoIsPublic(imageId: string): SQL {
  return sql`exists (
    select 1 from images i
    where i.id = ${imageId}
      and i.rights_confirmed
      and (
        exists (
          select 1 from mixtapes m
          where m.status = 'published'
            and (m.cover_image_id = i.id or m.detail_image_id = i.id)
        )
        or exists (select 1 from site_images s where s.image_id = i.id)
      )
  )`;
}
