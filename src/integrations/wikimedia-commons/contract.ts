import { z } from "zod";

import { photoFileNameOfTitle } from "./photo";

// The parts of the MediaWiki Action API's answers that Refrain reads, with
// `format=json&formatversion=2` (https://www.mediawiki.org/wiki/API:Imageinfo,
// https://www.mediawiki.org/wiki/API:Search, Wikibase `wbgetclaims`). Shapes
// were checked against live answers (docs/evidence/m3-3.md): `missing: true`
// and `invalid: true` on pages, `thumburl` on thumb.wikimedia.org with a
// tracking query, and every extended-metadata field an object with a string
// `value`. A page that does not match is dropped, never partly used.

/** The extended-metadata fields requested; no others are read. */
export const METADATA_FIELDS = [
  "Artist",
  "Attribution",
  "AttributionRequired",
  "Credit",
  "LicenseShortName",
  "LicenseUrl",
  "License",
  "UsageTerms",
  "Copyrighted",
  "NonFree",
  "Restrictions",
  "DeletionReason",
] as const;
export type MetadataField = (typeof METADATA_FIELDS)[number];

const metadataValue = z.object({
  value: z
    .union([z.string().max(20_000), z.number(), z.boolean()])
    .transform(String),
});

const imageInfo = z.object({
  timestamp: z.iso.datetime(),
  width: z.number().int().nonnegative().max(1_000_000),
  height: z.number().int().nonnegative().max(1_000_000),
  canonicaltitle: z.string().max(400),
  thumburl: z.string().max(2000),
  thumbwidth: z.number().int().positive(),
  descriptionurl: z.string().max(2000),
  sha1: z.string().regex(/^[0-9a-f]{40}$/),
  mime: z.string().max(100),
  mediatype: z.string().max(40),
  extmetadata: z.record(z.string(), z.unknown()).optional(),
});

const page = z.object({
  title: z.string().max(400),
  missing: z.boolean().optional(),
  invalid: z.boolean().optional(),
  index: z.number().int().optional(),
  imagerepository: z.string().max(40).optional(),
  imageinfo: z.array(z.unknown()).max(1).optional(),
});

/** The top level of a `query` answer. Pages are checked one by one. */
export const queryResponse = z.object({
  query: z
    .object({ pages: z.array(z.unknown()).max(500).optional() })
    .optional(),
});

/** One file as Commons describes it; validated, not yet judged. */
export interface CommonsFile {
  fileName: string;
  /** The order of a search result (1 first); 0 for a lookup. */
  index: number;
  sha1: string;
  /** When the current version was uploaded (ISO 8601, UTC). */
  timestamp: string;
  width: number;
  height: number;
  mime: string;
  mediaType: string;
  /** Without its tracking query. */
  thumbUrl: string;
  thumbWidth: number;
  descriptionUrl: string;
  /** Each requested metadata field's raw value (HTML), "" when absent. */
  metadata: Record<MetadataField, string>;
}

/** A page of a `query` answer: a file, a missing file, or neither (null). */
export type PageResult =
  | { kind: "file"; file: CommonsFile }
  | { kind: "missing"; fileName: string }
  | null;

function withoutQuery(value: string): string | null {
  try {
    const url = new URL(value);
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

export function pageResultOf(input: unknown): PageResult {
  const parsed = page.safeParse(input);
  if (!parsed.success) {
    return null;
  }
  const fileName = photoFileNameOfTitle(parsed.data.title);
  if (parsed.data.missing) {
    return fileName ? { kind: "missing", fileName } : null;
  }
  if (parsed.data.invalid || !fileName) {
    return null;
  }
  // A file shared from another wiki is not a Commons file.
  if (parsed.data.imagerepository !== "local") {
    return null;
  }
  const info = imageInfo.safeParse(parsed.data.imageinfo?.[0]);
  if (!info.success) {
    return null;
  }
  if (photoFileNameOfTitle(info.data.canonicaltitle) !== fileName) {
    return null;
  }
  const thumbUrl = withoutQuery(info.data.thumburl);
  if (!thumbUrl) {
    return null;
  }
  const raw = info.data.extmetadata ?? {};
  const metadata = {} as Record<MetadataField, string>;
  for (const field of METADATA_FIELDS) {
    const value = metadataValue.safeParse(raw[field]);
    metadata[field] = value.success ? value.data.value : "";
  }
  return {
    kind: "file",
    file: {
      fileName,
      index: parsed.data.index ?? 0,
      sha1: info.data.sha1,
      timestamp: new Date(info.data.timestamp).toISOString(),
      width: info.data.width,
      height: info.data.height,
      mime: info.data.mime,
      mediaType: info.data.mediatype,
      thumbUrl,
      thumbWidth: info.data.thumbwidth,
      descriptionUrl: info.data.descriptionurl,
      metadata,
    },
  };
}

/** `list=search` titles (Wikidata items or Commons files). */
export const searchResponse = z.object({
  query: z.object({
    search: z.array(z.object({ title: z.string().max(400) })).max(50),
  }),
});

/** `wbgetclaims` for one property: the statements' file names. */
export const claimsResponse = z.object({
  claims: z.record(
    z.string(),
    z
      .array(
        z.object({
          rank: z.string().max(20).optional(),
          mainsnak: z.object({
            snaktype: z.string().max(20),
            datavalue: z
              .object({ value: z.unknown(), type: z.string().max(40) })
              .optional(),
          }),
        }),
      )
      .max(100),
  ),
});
