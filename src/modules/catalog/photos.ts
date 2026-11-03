import "server-only";

import { createHash } from "node:crypto";

import { sql } from "drizzle-orm";
import { z } from "zod";

import type { DatabaseExecutor } from "@/db";
import { ProviderError } from "@/integrations/provider";
import {
  artistPhotoOf,
  assessCommonsFile,
  photoFileName,
  photoPlanOf,
  wikimedia,
  type ArtistPhoto,
  type CommonsFile,
  type PhotoAssessment,
  type PhotoImage,
  type PhotoLicense,
  type PhotoRefusal,
  type StoredArtistPhoto,
  type WikimediaClient,
} from "@/integrations/wikimedia-commons";
import type { AuthorizedAuthor } from "@/modules/identity";
import {
  isArtistOnPublicPage,
  lockArtistPublicExposure,
} from "@/modules/publication";
import { fieldErrorsOf } from "@/validation";

import { CatalogError } from "./errors";
import { reviewOf } from "./music";

// An artist's photograph from Wikimedia Commons (M3.3; docs/data-model.md §
// Transaction boundaries, boundary 1, catalog writes).
//
// The rules, in the order a request meets them:
//
// 1. The author finds candidates: Commons search with the words they type,
//    and, for an artist linked to MusicBrainz, suggestions through Wikidata
//    (the one item with the artist's MusicBrainz ID: its image, and files
//    that say they depict it). A suggestion is a lead, not proof of
//    identity; nothing is ever chosen or imported automatically, and no
//    search rank or popularity counts as identity.
// 2. Only files the license and attribution policy accepts are offered
//    (src/integrations/wikimedia-commons/assess.ts). A refused file is never
//    shown or loaded; the review page says why it cannot be used.
// 3. The review shows exactly what would be stored, with a fingerprint of it
//    (`review`, a SHA-256 of the plan; not a secret). Opening it writes
//    nothing.
// 4. On approval the command asks Commons again, before any transaction
//    opens (never inside one), assesses the file again, and writes only if
//    the plan's fingerprint is the one the author reviewed. Otherwise
//    `review_stale`, and nothing is written.
// 5. Every change, setting or removing, sends the stored photograph the
//    author was looking at (`expectedPhoto`, a fingerprint of the seven photo
//    columns, or null for none), compared under the artist's row lock. A
//    change made elsewhere meanwhile is never silently replaced.
// 6. An archived artist's photograph is not set; it can be removed, because
//    removing only takes something away (a rights holder's request need not
//    wait for a restore).
//
// Public pages (M3.5): the public artist page shows the photograph, so a
// change to it would reach readers without a confirmation (gate G8). Setting
// or replacing a photograph is therefore refused while the artist's page is
// public (`public_page`), decided by the publication predicate under
// `FOR SHARE` locks on every album-journal entry about an album that credits
// the artist, taken before the artist's row (ADR 0006 § 7, L3; the multi-entry
// share lock is proposed amendment A5, for the owner's review). Removing a
// photograph is always allowed: it only takes something away from a page (the
// fallback frame shows instead), as unpublishing does (ADR 0006, R4), and it
// is the takedown path for a rights holder or a person shown. The studio asks
// before it removes.

export interface PhotoProviders {
  wikimedia: WikimediaClient;
}

export function defaultPhotoProviders(): PhotoProviders {
  return { wikimedia: wikimedia() };
}

function parse<Schema extends z.ZodType>(
  schema: Schema,
  input: unknown,
): z.output<Schema> {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new CatalogError("invalid_input", {
      fields: fieldErrorsOf(result.error),
    });
  }
  return result.data;
}

/** Runs a provider call; its failure becomes a fixed catalog failure. */
async function provided<Result>(work: () => Promise<Result>): Promise<Result> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof ProviderError) {
      throw new CatalogError(
        error.failure === "not_found"
          ? "provider_not_found"
          : "provider_unavailable",
      );
    }
    throw error;
  }
}

/** A file name from a request: spaces read as underscores, then strict. */
const fileInput = z
  .string()
  .max(400)
  .transform((value) =>
    value
      .trim()
      .replace(/^File:/, "")
      .replace(/ /g, "_"),
  )
  .refine((value) => photoFileName(value) !== null);

const reviewToken = z.string().regex(/^[0-9a-f]{64}$/);
const expectedPhoto = z
  .string()
  .regex(/^[0-9a-f]{64}$/)
  .nullable();

// ---------------------------------------------------------------------------
// The stored photograph
// ---------------------------------------------------------------------------

interface ArtistRow {
  name: string;
  archived: boolean;
  mbArtistId: string | null;
  stored: StoredArtistPhoto;
}

async function artistRow(
  db: DatabaseExecutor,
  artistId: string,
  lock: boolean,
): Promise<ArtistRow | null> {
  const result = await db.execute<{
    name: string;
    archived: boolean;
    mb_artist_id: string | null;
    photo_url: string | null;
    photo_credit: string | null;
    photo_license: string | null;
    photo_source_url: string | null;
    photo_file_sha1: string | null;
    photo_file_timestamp: string | null;
    photo_chosen_at: string | null;
  }>(sql`
    select name, archived_at is not null as archived, mb_artist_id,
           photo_url, photo_credit, photo_license, photo_source_url,
           photo_file_sha1,
           to_char(photo_file_timestamp at time zone 'UTC',
                   'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as photo_file_timestamp,
           to_char(photo_chosen_at at time zone 'UTC',
                   'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as photo_chosen_at
      from artists
     where id = ${artistId}
     ${lock ? sql`for no key update` : sql``}`);
  const row = result.rows[0];
  return row
    ? {
        name: row.name,
        archived: row.archived,
        mbArtistId: row.mb_artist_id,
        stored: {
          photoUrl: row.photo_url,
          photoCredit: row.photo_credit,
          photoLicense: row.photo_license,
          photoSourceUrl: row.photo_source_url,
          photoFileSha1: row.photo_file_sha1,
          photoFileTimestamp: row.photo_file_timestamp,
          photoChosenAt: row.photo_chosen_at,
        },
      }
    : null;
}

/**
 * A fingerprint of the stored photo columns, or null when they are all
 * empty. Any change to any of them changes it.
 */
export function photoStateOf(stored: StoredArtistPhoto): string | null {
  const values = [
    stored.photoUrl,
    stored.photoCredit,
    stored.photoLicense,
    stored.photoSourceUrl,
    stored.photoFileSha1,
    stored.photoFileTimestamp === null
      ? null
      : new Date(stored.photoFileTimestamp).toISOString(),
    stored.photoChosenAt === null
      ? null
      : new Date(stored.photoChosenAt).toISOString(),
  ];
  if (values.every((value) => value === null)) {
    return null;
  }
  return createHash("sha256").update(JSON.stringify(values)).digest("hex");
}

/** The stored photograph and what it is, for the studio. */
export interface StoredPhotoView {
  /** The photograph, or null when there is none or it cannot be shown. */
  photo: ArtistPhoto | null;
  /** Columns are set, but not in the one form Refrain writes. */
  unreadable: boolean;
  /** Send back as `expectedPhoto`. */
  state: string | null;
  sha1: string | null;
  fileTimestamp: string | null;
  chosenAt: string | null;
}

export function storedPhotoView(stored: StoredArtistPhoto): StoredPhotoView {
  const state = photoStateOf(stored);
  const photo = artistPhotoOf(stored);
  const iso = (value: Date | string | null) =>
    value === null ? null : new Date(value).toISOString();
  return {
    photo,
    unreadable: state !== null && photo === null,
    state,
    sha1: photo ? stored.photoFileSha1 : null,
    fileTimestamp: photo ? iso(stored.photoFileTimestamp) : null,
    chosenAt: photo ? iso(stored.photoChosenAt) : null,
  };
}

// ---------------------------------------------------------------------------
// Candidates
// ---------------------------------------------------------------------------

/** A file the author may choose: usable under the policy. */
export interface PhotoChoice {
  fileName: string;
  title: string;
  image: PhotoImage;
  credit: string;
  license: PhotoLicense;
  width: number;
  height: number;
}

function choicesOf(files: CommonsFile[]): {
  choices: PhotoChoice[];
  refused: number;
} {
  const choices: PhotoChoice[] = [];
  let refused = 0;
  for (const file of files) {
    const assessment = assessCommonsFile(file);
    if (
      assessment.image &&
      assessment.license &&
      assessment.credit !== null &&
      assessment.refusals.length === 0
    ) {
      choices.push({
        fileName: assessment.fileName,
        title: assessment.title,
        image: assessment.image,
        credit: assessment.credit,
        license: assessment.license,
        width: assessment.width,
        height: assessment.height,
      });
    } else {
      refused += 1;
    }
  }
  return { choices, refused };
}

/**
 * How the photograph on file compares with Commons now: the same version,
 * a new version of the file, changed license or credit, a file that is gone
 * or can no longer be used, or unknown (Commons did not answer).
 */
export type CurrentPhotoCheck =
  | "unchanged"
  | "new_version"
  | "details_changed"
  | "missing"
  | "not_usable"
  | "unavailable";

export type SuggestionState =
  "not_linked" | "no_item" | "found" | "unavailable";

export interface ArtistPhotoChoices {
  artist: {
    id: string;
    name: string;
    archived: boolean;
    linked: boolean;
    /** The artist has a public page, so its photograph cannot be replaced. */
    onPublicPage: boolean;
  };
  current: StoredPhotoView;
  currentCheck: CurrentPhotoCheck | null;
  query: string;
  /** Null when no search was asked for. */
  results: PhotoChoice[] | null;
  /** How many results could not be offered (license, credit, format). */
  refused: number;
  searchUnavailable: boolean;
  suggestions: PhotoChoice[];
  suggestionsRefused: number;
  suggestionState: SuggestionState;
}

const choicesInput = z.object({
  artistId: z.uuid(),
  query: z
    .string()
    .max(1000)
    .transform((value) => value.replace(/\s+/g, " ").trim().slice(0, 200)),
});

async function checkCurrent(
  view: StoredPhotoView,
  providers: PhotoProviders,
): Promise<CurrentPhotoCheck | null> {
  if (!view.photo) {
    return null;
  }
  let lookup: { files: CommonsFile[]; missing: string[] };
  try {
    lookup = await providers.wikimedia.getFiles([view.photo.fileName]);
  } catch (error) {
    if (error instanceof ProviderError) {
      return "unavailable";
    }
    throw error;
  }
  const file = lookup.files[0];
  if (!file || file.fileName !== view.photo.fileName) {
    return lookup.missing.includes(view.photo.fileName)
      ? "missing"
      : "unavailable";
  }
  const plan = photoPlanOf(assessCommonsFile(file));
  if (!plan) {
    return "not_usable";
  }
  if (plan.sha1 !== view.sha1) {
    return "new_version";
  }
  if (
    plan.photoCredit !== view.photo.credit ||
    plan.photoLicense !== view.photo.license.name
  ) {
    return "details_changed";
  }
  return "unchanged";
}

async function suggestionsFor(
  mbArtistId: string | null,
  providers: PhotoProviders,
): Promise<{
  state: SuggestionState;
  choices: PhotoChoice[];
  refused: number;
}> {
  if (!mbArtistId) {
    return { state: "not_linked", choices: [], refused: 0 };
  }
  try {
    const item = await providers.wikimedia.itemForMusicBrainzArtist(mbArtistId);
    if (!item) {
      return { state: "no_item", choices: [], refused: 0 };
    }
    const images = await providers.wikimedia.itemImages(item);
    const { files: imageFiles } = await providers.wikimedia.getFiles(images);
    const depicting = await providers.wikimedia.filesDepicting(item);
    const seen = new Set<string>();
    const files = [...imageFiles, ...depicting].filter((file) => {
      if (seen.has(file.fileName)) {
        return false;
      }
      seen.add(file.fileName);
      return true;
    });
    const { choices, refused } = choicesOf(files);
    return { state: "found", choices, refused };
  } catch (error) {
    if (error instanceof ProviderError) {
      return { state: "unavailable", choices: [], refused: 0 };
    }
    throw error;
  }
}

/**
 * The artist's photograph and the candidates the author may choose from:
 * suggestions through Wikidata when the artist is linked to MusicBrainz, and
 * the results of a search when `query` has words. Reads only; writes
 * nothing. Null when the artist does not exist.
 */
export async function listArtistPhotoChoices(
  db: DatabaseExecutor,
  _author: AuthorizedAuthor,
  input: unknown,
  providers: PhotoProviders = defaultPhotoProviders(),
): Promise<ArtistPhotoChoices | null> {
  const parsed = choicesInput.safeParse(input);
  if (!parsed.success) {
    return null;
  }
  const { artistId, query } = parsed.data;
  const row = await artistRow(db, artistId, false);
  if (!row) {
    return null;
  }
  const current = storedPhotoView(row.stored);
  const base = {
    artist: {
      id: artistId,
      name: row.name,
      archived: row.archived,
      linked: row.mbArtistId !== null,
      onPublicPage: await isArtistOnPublicPage(db, artistId),
    },
    current,
    query,
  };
  if (row.archived) {
    return {
      ...base,
      currentCheck: null,
      results: null,
      refused: 0,
      searchUnavailable: false,
      suggestions: [],
      suggestionsRefused: 0,
      suggestionState: row.mbArtistId ? "no_item" : "not_linked",
    };
  }

  // In series: one request at a time (the client spaces them anyway). Once
  // Wikimedia has failed, nothing more is asked of it for this page, so a
  // slow or unreachable provider costs one deadline, not one per call.
  const currentCheck = await checkCurrent(current, providers);
  let down = currentCheck === "unavailable";
  const suggestions = down
    ? row.mbArtistId
      ? { state: "unavailable" as const, choices: [], refused: 0 }
      : { state: "not_linked" as const, choices: [], refused: 0 }
    : await suggestionsFor(row.mbArtistId, providers);
  down ||= suggestions.state === "unavailable";
  let results: PhotoChoice[] | null = null;
  let refused = 0;
  let searchUnavailable = false;
  if (query !== "" && down) {
    searchUnavailable = true;
    results = [];
  } else if (query !== "") {
    try {
      const found = choicesOf(await providers.wikimedia.searchFiles(query));
      results = found.choices;
      refused = found.refused;
    } catch (error) {
      if (!(error instanceof ProviderError)) {
        throw error;
      }
      searchUnavailable = true;
      results = [];
    }
  }
  return {
    ...base,
    currentCheck,
    results,
    refused,
    searchUnavailable,
    suggestions: suggestions.choices,
    suggestionsRefused: suggestions.refused,
    suggestionState: suggestions.state,
  };
}

// ---------------------------------------------------------------------------
// The review of one file
// ---------------------------------------------------------------------------

export interface ArtistPhotoReview {
  artist: {
    id: string;
    name: string;
    archived: boolean;
    /** The artist has a public page, so its photograph cannot be replaced. */
    onPublicPage: boolean;
  };
  current: StoredPhotoView;
  /** Null when Commons has no such file. */
  assessment: PhotoAssessment | null;
  /** The fingerprint to approve with; null when the file cannot be used. */
  review: string | null;
  /** The file is the photograph on file, in the same version. */
  isCurrent: boolean;
}

const reviewInput = z.object({ artistId: z.uuid(), file: fileInput });

/**
 * Everything about one file the author needs to decide: the image (only if
 * usable), the creator, the credit to be stored, the source, the license
 * and its terms, restrictions, size and format, the version, and why a file
 * cannot be used. Reads only. Null when the artist does not exist.
 */
export async function reviewArtistPhoto(
  db: DatabaseExecutor,
  _author: AuthorizedAuthor,
  input: unknown,
  providers: PhotoProviders = defaultPhotoProviders(),
): Promise<ArtistPhotoReview | null> {
  const { artistId, file } = parse(reviewInput, input);
  const row = await artistRow(db, artistId, false);
  if (!row) {
    return null;
  }
  const { files } = await provided(() => providers.wikimedia.getFiles([file]));
  const found = files.find((candidate) => candidate.fileName === file);
  const assessment = found ? assessCommonsFile(found) : null;
  const plan = assessment ? photoPlanOf(assessment) : null;
  const current = storedPhotoView(row.stored);
  return {
    artist: {
      id: artistId,
      name: row.name,
      archived: row.archived,
      onPublicPage: await isArtistOnPublicPage(db, artistId),
    },
    current,
    assessment,
    review: plan ? reviewOf(plan) : null,
    isCurrent:
      current.photo !== null &&
      plan !== null &&
      current.photo.fileName === plan.fileName &&
      current.sha1 === plan.sha1 &&
      current.photo.credit === plan.photoCredit &&
      current.photo.license.name === plan.photoLicense,
  };
}

// ---------------------------------------------------------------------------
// Setting and removing
// ---------------------------------------------------------------------------

const setPhotoInput = z.object({
  artistId: z.uuid(),
  file: fileInput,
  review: reviewToken,
  expectedPhoto,
});

/**
 * Sets an artist's photograph to a reviewed Commons file, with its
 * provenance. Refused if the file or its metadata changed since the review
 * (`review_stale`), if it is no longer usable (`photo_not_usable`), if
 * Commons no longer has it (`provider_not_found`), if the stored photograph
 * changed since the author looked (`review_stale`), if the artist is
 * archived (`archived_reference`), or while the artist has a public page
 * (`public_page`, gate G8). Writes nothing else.
 */
export async function setArtistPhoto(
  db: DatabaseExecutor,
  _author: AuthorizedAuthor,
  input: unknown,
  providers: PhotoProviders = defaultPhotoProviders(),
): Promise<void> {
  const { artistId, file, review, expectedPhoto } = parse(setPhotoInput, input);

  // Every external call happens before the transaction (docs/data-model.md).
  const { files } = await provided(() =>
    providers.wikimedia.getFiles([file], { fresh: true }),
  );
  const found = files.find((candidate) => candidate.fileName === file);
  if (!found) {
    throw new CatalogError("provider_not_found");
  }
  const plan = photoPlanOf(assessCommonsFile(found));
  if (!plan) {
    throw new CatalogError("photo_not_usable");
  }
  if (reviewOf(plan) !== review) {
    throw new CatalogError("review_stale");
  }

  await db.transaction(async (tx) => {
    // The entries first, then the artist (ADR 0006 § 7, L3): every journal
    // entry that could put the artist on a public page is locked FOR SHARE
    // and the predicate decides, so a publish waits for this change, or this
    // change sees the publish.
    if (await lockArtistPublicExposure(tx, artistId)) {
      throw new CatalogError("public_page");
    }
    const row = await artistRow(tx, artistId, true);
    if (!row) {
      throw new CatalogError("not_found");
    }
    if (row.archived) {
      throw new CatalogError("archived_reference");
    }
    if (photoStateOf(row.stored) !== expectedPhoto) {
      throw new CatalogError("review_stale");
    }
    await tx.execute(sql`
      update artists
         set photo_url = ${plan.photoUrl},
             photo_credit = ${plan.photoCredit},
             photo_license = ${plan.photoLicense},
             photo_source_url = ${plan.photoSourceUrl},
             photo_file_sha1 = ${plan.sha1},
             photo_file_timestamp = ${plan.timestamp}::timestamptz,
             photo_chosen_at = now(),
             updated_at = now()
       where id = ${artistId}`);
  });
}

const removePhotoInput = z.object({ artistId: z.uuid(), expectedPhoto });

/**
 * Removes an artist's photograph and its provenance, if it is still the one
 * the author saw. Allowed for an archived artist, and while the artist has a
 * public page: removing only takes something away (the page shows its
 * fallback frame instead), so it is the takedown path. Asks nothing of
 * Commons, so it works while Commons is down.
 */
export async function removeArtistPhoto(
  db: DatabaseExecutor,
  _author: AuthorizedAuthor,
  input: unknown,
): Promise<void> {
  const { artistId, expectedPhoto } = parse(removePhotoInput, input);
  await db.transaction(async (tx) => {
    const row = await artistRow(tx, artistId, true);
    if (!row) {
      throw new CatalogError("not_found");
    }
    if (photoStateOf(row.stored) !== expectedPhoto) {
      throw new CatalogError("review_stale");
    }
    if (expectedPhoto === null) {
      return;
    }
    await tx.execute(sql`
      update artists
         set photo_url = null, photo_credit = null, photo_license = null,
             photo_source_url = null, photo_file_sha1 = null,
             photo_file_timestamp = null, photo_chosen_at = null,
             updated_at = now()
       where id = ${artistId}`);
  });
}

export type { PhotoRefusal };
