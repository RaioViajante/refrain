import "server-only";

import { createHash } from "node:crypto";

import { sql, type SQL } from "drizzle-orm";
import { z } from "zod";

import type { DatabaseExecutor, Locale, Transaction } from "@/db";
import {
  CONFIRMATION_VALIDITY_MS,
  confirmationAvailable,
  confirmationIsCurrent,
  signConfirmation,
  verifyConfirmation,
  type AuthorizedAuthor,
  type VerifiedConfirmation,
} from "@/modules/identity";

import {
  catalogPublicImpact,
  parseCatalogChange,
  type AtomChange,
  type CatalogChange,
  type CatalogPublicImpact,
  type ImpactSurface,
} from "./catalog-impact";
import { canonicalJson } from "./disclosure";
import { PublicationError } from "./errors";

// Confirmed catalog changes (ADR 0013 §§ 2 to 4, step 3). A catalog edit that
// would change the wording of a served page needs the author's confirmation:
//
//   previewCatalogChange              computes the public impact, and mints a
//                                     `catalog_change` token for exactly it.
//                                     Writes nothing to a shared table.
//   verifyCatalogChangeConfirmation   authenticates a token before any lock.
//   requireCatalogChangeConfirmation  the gate, inside the command's
//                                     transaction after its locks: recomputes
//                                     the impact and the fingerprint, checks
//                                     the expiry by the database clock, and
//                                     refuses (`confirmation_required`,
//                                     `_expired`, `_stale`) before anything
//                                     is written.
//
// The token is ADR 0006's `ct1` with the third purpose `catalog_change`
// (ADR 0013 § 3, the owner's decision 1): `e` is the catalog subject and `n`
// is the constant 1. Freshness comes from the fingerprint, which binds the
// subject, the exact operation, every affected page with each changed atom
// before and after, every moved artist address, each affected entry's version
// and stamps, and the subject's `updated_at` read with microseconds. Every
// guarded writer moves that `updated_at` strictly forward, so an applied
// token can never match again, even after A → B → A.

export type CatalogSubjectKind = "artist" | "album" | "track";

export interface CatalogSubject {
  kind: CatalogSubjectKind;
  id: string;
}

const subjectSchema = z.strictObject({
  kind: z.enum(["artist", "album", "track"]),
  id: z.uuid(),
});

function subjectOf(input: CatalogSubject): CatalogSubject {
  const parsed = subjectSchema.safeParse(input);
  if (!parsed.success) {
    throw new PublicationError("invalid_input");
  }
  return parsed.data;
}

const subjectKey = (subject: CatalogSubject) => `${subject.kind}:${subject.id}`;

/** What the Studio shows: no internal identifier, no writing. */
export interface CatalogChangeReview {
  pages: {
    surface: ImpactSurface;
    /** The interface language, or null for the sitemap. */
    locale: Locale | null;
    /** The English address before; the Studio adds `/pt`. */
    path: string;
    /** The address after, when the page moves. */
    pathAfter: string | null;
    changes: AtomChange[];
  }[];
  /** Every public artist address that moves, opens, or closes. */
  addresses: { before: string | null; after: string | null }[];
}

export interface CatalogChangePreview {
  review: CatalogChangeReview;
  /** Null when nothing served changes, or when the change is refused. */
  confirmation: string | null;
  expiresAtMs: number | null;
  /** True: the change would open an artist page, which is refused (A5). */
  opensArtistPage: boolean;
}

function reviewOf(impact: CatalogPublicImpact): CatalogChangeReview {
  return {
    pages: impact.pages.map((page) => ({
      surface: page.surface,
      locale: page.locale,
      path: page.path,
      pathAfter: page.pathAfter,
      changes: page.changes,
    })),
    addresses: impact.artistAddresses.map((change) => ({
      before: change.before,
      after: change.after,
    })),
  };
}

const RETRY_CODES = new Set(["40P01", "40001"]);

function sqlStateOf(error: unknown): string | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current; depth++) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === "string") {
      return code;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

/**
 * The impact, failing closed: anything that keeps it from being computed
 * reliably (the `TEMPORARY` privilege missing, a limit reached, a copy in the
 * way, any database error) is `impact_unavailable`; a deadlock or
 * serialization failure is `retry`. No database message reaches the caller.
 */
/** Internal; exported for the unit test of its mapping only. */
export async function computeImpact(
  db: DatabaseExecutor,
  change: CatalogChange,
): Promise<CatalogPublicImpact> {
  try {
    return await catalogPublicImpact(db, change);
  } catch (error) {
    if (error instanceof PublicationError) {
      throw error;
    }
    const code = sqlStateOf(error);
    if (code !== undefined && RETRY_CODES.has(code)) {
      throw new PublicationError("retry");
    }
    throw new PublicationError("impact_unavailable");
  }
}

interface CatalogState {
  subjectUpdatedAt: string | null;
  entries: unknown[];
  nowMs: number;
}

// UTC text with microseconds: never a JavaScript Date, whose milliseconds
// would hide two edits made within one millisecond (ADR 0013 § 3.5).
const utc = (column: SQL) =>
  sql`to_char(${column} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US')`;

/** The publication state the fingerprint binds, read in the caller's view. */
async function catalogStateOf(
  db: DatabaseExecutor,
  subject: CatalogSubject,
  impact: CatalogPublicImpact,
): Promise<CatalogState> {
  const stamp =
    subject.kind === "artist"
      ? sql`select ${utc(sql`updated_at`)} as at from artists where id = ${subject.id}`
      : subject.kind === "album"
        ? sql`select ${utc(sql`updated_at`)} as at from albums where id = ${subject.id}`
        : sql`select ${utc(sql`updated_at`)} as at from tracks where id = ${subject.id}`;
  const subjectRow = await db.execute<{ at: string }>(stamp);
  const entryIds = [
    ...new Set(
      impact.pages.flatMap((page) =>
        page.entryId === null ? [] : [page.entryId],
      ),
    ),
  ].sort();
  const entries =
    entryIds.length === 0
      ? []
      : (
          await db.execute<{ id: string; state: unknown }>(sql`
            select e.id,
                   json_build_object(
                     'version', e.version,
                     'updatedAt', ${utc(sql`e.updated_at`)},
                     'deleted', e.deleted_at is not null,
                     'versions', (select json_agg(json_build_object(
                                    'locale', t.locale, 'status', t.status,
                                    'updatedAt', ${utc(sql`t.updated_at`)})
                                    order by t.locale)
                                    from entry_texts t
                                   where t.entry_id = e.id)) as state
              from entries e
             where e.id in (${sql.join(
               entryIds.map((id) => sql`${id}`),
               sql`, `,
             )})
             order by e.id`)
        ).rows;
  const now = await db.execute<{ now_ms: string }>(sql`
    select floor(extract(epoch from clock_timestamp()) * 1000)::bigint::text
             as now_ms`);
  return {
    subjectUpdatedAt: subjectRow.rows[0]?.at ?? null,
    entries,
    nowMs: Number(now.rows[0]!.now_ms),
  };
}

function fingerprintOf(
  subject: CatalogSubject,
  change: CatalogChange,
  impact: CatalogPublicImpact,
  state: CatalogState,
): string {
  const material = {
    operation: "catalog_change",
    subject: subjectKey(subject),
    change: parseCatalogChange(change),
    impact,
    state: {
      subjectUpdatedAt: state.subjectUpdatedAt,
      entries: state.entries,
    },
  };
  return createHash("sha256")
    .update(canonicalJson(material), "utf8")
    .digest("base64url");
}

/**
 * Computes the public impact of `buildChange`'s operations, in one snapshot,
 * and returns it with a `catalog_change` token for exactly that, or no token
 * when nothing served changes or the change would open an artist page (A5:
 * refused, never confirmed). Writes nothing to a shared table, holds no lock.
 */
export async function previewCatalogChange(
  db: DatabaseExecutor,
  author: AuthorizedAuthor,
  input: CatalogSubject,
  buildChange: (executor: DatabaseExecutor) => Promise<CatalogChange>,
): Promise<CatalogChangePreview> {
  const subject = subjectOf(input);
  const nested = "rollback" in db;
  const read = await db.transaction(
    async (tx) => {
      const change = await buildChange(tx);
      if (change.length === 0) {
        return null;
      }
      const impact = await computeImpact(tx, change);
      return {
        change,
        impact,
        state: await catalogStateOf(tx, subject, impact),
      };
    },
    nested ? undefined : { isolationLevel: "repeatable read" },
  );
  const empty: CatalogChangePreview = {
    review: { pages: [], addresses: [] },
    confirmation: null,
    expiresAtMs: null,
    opensArtistPage: false,
  };
  if (read === null) {
    return empty;
  }
  const { change, impact, state } = read;
  const review = reviewOf(impact);
  if (impact.opensArtistPage) {
    return { ...empty, review, opensArtistPage: true };
  }
  if (impact.pages.length === 0 && impact.artistAddresses.length === 0) {
    return { ...empty, review };
  }
  if (!confirmationAvailable()) {
    throw new PublicationError("unavailable");
  }
  const signed = signConfirmation(author, {
    purpose: "catalog_change",
    entryId: subjectKey(subject),
    entryVersion: 1,
    fingerprint: fingerprintOf(subject, change, impact, state),
    issuedAtMs: state.nowMs,
  });
  if (!signed.ok) {
    throw new PublicationError("unavailable");
  }
  return {
    review,
    confirmation: signed.token,
    expiresAtMs: state.nowMs + CONFIRMATION_VALIDITY_MS,
    opensArtistPage: false,
  };
}

/**
 * Authenticates a `catalog_change` token before any lock is taken: the key,
 * the MAC, the purpose, the author's session, and the subject. Expiry and the
 * fingerprint are checked later, under the command's locks.
 */
export function verifyCatalogChangeConfirmation(
  author: AuthorizedAuthor,
  token: string,
  input: CatalogSubject,
): VerifiedConfirmation {
  const subject = subjectOf(input);
  const verified = verifyConfirmation(author, token, {
    purpose: "catalog_change",
    entryId: subjectKey(subject),
    entryVersion: 1,
  });
  if (!verified.ok) {
    throw new PublicationError(
      verified.reason === "unavailable"
        ? "unavailable"
        : "confirmation_invalid",
    );
  }
  return verified.claims;
}

/**
 * The gate of a catalog command (ADR 0013 § 4.2), called inside its
 * transaction after ADR 0013 § 4.1's locks and before anything is written.
 * Returns the impact. Refuses, with nothing written:
 * - `confirmation_required`: the change affects a served page and no token
 *   was given (also when the preview found none: fail closed, § 4.3);
 * - `confirmation_expired`: by the database clock, read after the locks;
 * - `confirmation_stale`: the impact, a page's state, the subject's
 *   `updated_at`, or the operation differs from the reviewed one.
 * The caller refuses an impact that opens an artist page (A5) itself, token
 * or not.
 */
export async function requireCatalogChangeConfirmation(
  tx: Transaction,
  input: {
    subject: CatalogSubject;
    change: CatalogChange;
    confirmation?: VerifiedConfirmation;
  },
): Promise<CatalogPublicImpact> {
  const subject = subjectOf(input.subject);
  const impact = await computeImpact(tx, input.change);
  if (impact.opensArtistPage) {
    return impact;
  }
  const presented = input.confirmation;
  const empty =
    impact.pages.length === 0 && impact.artistAddresses.length === 0;
  // A token that was presented is always checked, even when nothing served
  // changes now: an applied or outdated token is refused, never ignored.
  if (empty && presented === undefined) {
    return impact;
  }
  if (presented === undefined) {
    throw new PublicationError("confirmation_required");
  }
  const state = await catalogStateOf(tx, subject, impact);
  if (!confirmationIsCurrent(presented, state.nowMs)) {
    throw new PublicationError("confirmation_expired");
  }
  if (
    presented.fingerprint !==
    fingerprintOf(subject, input.change, impact, state)
  ) {
    throw new PublicationError("confirmation_stale");
  }
  return impact;
}
