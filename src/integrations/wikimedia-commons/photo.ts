import { createHash } from "node:crypto";

import { photoLicenseNamed, type PhotoLicense } from "./license";

// Artist photographs from Wikimedia Commons: the one form Refrain stores, and
// the only image addresses it ever renders. Pure functions, no network.
//
// The catalog stores a photograph in the artist row (M3.3):
//
//   photo_source_url  https://commons.wikimedia.org/wiki/File:<encoded name>
//   photo_url         https://thumb.wikimedia.org/wikipedia/commons/thumb/
//                       <h>/<hh>/<encoded name>/330px-<encoded name>
//   photo_license     an allow-listed license name (./license.ts)
//   photo_credit      the credit line the license asks for, as plain text
//   photo_file_sha1, photo_file_timestamp, photo_chosen_at   (provenance)
//
// `<name>` is the file's name on Commons with underscores for spaces (its
// database key); `<h>/<hh>` are the first one and two hexadecimal digits of
// the MD5 of that name, and the name is percent-encoded like PHP's
// `rawurlencode`, which is how Commons builds its own thumbnail addresses
// (checked live; docs/evidence/m3-3.md). Every reader parses the stored row
// strictly and rebuilds the addresses from the name: a row that differs in
// any way (another host, another width, a query, a name that does not match
// the source page, an unknown license, a credit that is not plain text) is
// not a photograph, and the page shows its fallback. The Content-Security-
// Policy allows images from `thumb.wikimedia.org` on the studio only
// (src/security-headers.ts).

export const COMMONS_ORIGIN = "https://commons.wikimedia.org";
export const THUMBNAIL_ORIGIN = "https://thumb.wikimedia.org";
export const PHOTO_SOURCE = "Wikimedia Commons";

/** The image hosts a photograph request may reach, for `img-src`. */
export const PHOTO_IMAGE_HOSTS = [THUMBNAIL_ORIGIN] as const;

/**
 * The widths Wikimedia serves thumbnails at. A direct request for any other
 * width is refused (https://www.mediawiki.org/wiki/Common_thumbnail_sizes;
 * a 400 for 400 px, seen live).
 */
export const STANDARD_THUMBNAIL_WIDTHS = [
  20, 40, 60, 120, 250, 330, 500, 960, 1280, 1920, 3840,
] as const;

/** The width of the stored thumbnail address. */
export const STORED_THUMBNAIL_WIDTH = 330;
/** The widths offered to the browser. Every accepted file is wider than all. */
export const PHOTO_SRCSET_WIDTHS = [330, 500] as const;
/** The smallest file accepted: its 500 px thumbnail must be a reduction. */
export const MIN_PHOTO_WIDTH = 600;
export const MIN_PHOTO_HEIGHT = 400;

/** The longest credit line stored, in characters. */
export const MAX_CREDIT_LENGTH = 300;

// Commons names longer than this are rare, and MediaWiki shortens the
// thumbnail names of very long ones, which this module does not rebuild.
const MAX_NAME_BYTES = 150;

// What a stored file name may contain: letters, marks, digits, and the
// punctuation Commons titles commonly use. Never `/`, `:`, `\`, `#`, `?`,
// `%`, brackets, braces, `|`, `<`, `>`, quotes, or whitespace (spaces are
// underscores), so a name can never change an address's structure.
const NAME =
  /^[\p{L}\p{M}\p{N}][\p{L}\p{M}\p{N}_\-.,()'!&+;=@$~]*\.[A-Za-z0-9]{2,5}$/u;
const PHOTO_EXTENSION = /\.(jpe?g|png)$/i;

/** A file's name as stored (its database key), or null if not acceptable. */
export function photoFileName(value: unknown): string | null {
  const name = commonsFileName(value);
  return name && PHOTO_EXTENSION.test(name) ? name : null;
}

/** Whether a file name has an extension Refrain accepts for photographs. */
export function hasPhotoExtension(fileName: string): boolean {
  return PHOTO_EXTENSION.test(fileName);
}

/**
 * A Commons file name of a safe shape, whatever its format, or null. Used to
 * read titles, so that a file in another format is still seen (and refused
 * by the assessment, with its reason) rather than silently dropped.
 */
export function commonsFileName(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  if (
    !NAME.test(value) ||
    value.includes("__") ||
    value.endsWith("_") ||
    value.includes("..") ||
    Buffer.byteLength(value, "utf8") > MAX_NAME_BYTES ||
    value.normalize("NFC") !== value
  ) {
    return null;
  }
  return value;
}

/**
 * The name of a `File:` title ("File:Some photo.jpg" → "Some_photo.jpg"), of
 * any format, or null.
 */
export function photoFileNameOfTitle(title: unknown): string | null {
  if (typeof title !== "string" || !title.startsWith("File:")) {
    return null;
  }
  return commonsFileName(title.slice("File:".length).replace(/ /g, "_"));
}

/** The title shown to people: the name with spaces, without "File:". */
export function photoTitleOf(fileName: string): string {
  return fileName.replace(/_/g, " ");
}

/** Percent-encodes like PHP's `rawurlencode` (only A–Z a–z 0–9 - _ . ~ kept). */
export function encodePhotoName(fileName: string): string {
  return encodeURIComponent(fileName).replace(
    /[!'()*]/g,
    (character) =>
      `%${character.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`,
  );
}

function hashPath(fileName: string): string {
  const hash = createHash("md5").update(fileName, "utf8").digest("hex");
  return `${hash[0]}/${hash.slice(0, 2)}`;
}

/** The file's description page on Commons. */
export function photoSourceUrl(fileName: string): string {
  return `${COMMONS_ORIGIN}/wiki/File:${encodePhotoName(fileName)}`;
}

/** A thumbnail of the file at one of the standard widths. */
export function photoThumbnailUrl(fileName: string, width: number): string {
  const encoded = encodePhotoName(fileName);
  return `${THUMBNAIL_ORIGIN}/wikipedia/commons/thumb/${hashPath(fileName)}/${encoded}/${width}px-${encoded}`;
}

const SOURCE_URL =
  /^https:\/\/commons\.wikimedia\.org\/wiki\/File:([A-Za-z0-9%._~-]+)$/;

/** The file name of a stored description-page address, or null. */
export function parsePhotoSourceUrl(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const match = SOURCE_URL.exec(value);
  if (!match) {
    return null;
  }
  let decoded: string;
  try {
    decoded = decodeURIComponent(match[1]!);
  } catch {
    return null;
  }
  const fileName = photoFileName(decoded);
  // Only the canonical encoding is accepted, so one file has one stored form.
  return fileName && photoSourceUrl(fileName) === value ? fileName : null;
}

/** What a page needs to show a photograph: built, never stored. */
export interface PhotoImage {
  /** The 330 px thumbnail. */
  src: string;
  /** The 330 and 500 px thumbnails, for `srcset`. */
  srcSet: string;
}

export function photoImageOf(fileName: string): PhotoImage {
  return {
    src: photoThumbnailUrl(fileName, STORED_THUMBNAIL_WIDTH),
    srcSet: PHOTO_SRCSET_WIDTHS.map(
      (width) => `${photoThumbnailUrl(fileName, width)} ${width}w`,
    ).join(", "),
  };
}

/** The modification Refrain makes, stated with every attribution. */
export const PHOTO_MODIFICATIONS =
  "Resized, and cropped to fit the frame. No other changes.";

// Characters that can change how a credit reads without being visible:
// bidirectional embeddings, overrides, isolates, and marks (an unclosed
// override would reorder the rest of the caption, including the license),
// zero-width and other invisible format characters (except the joiners some
// scripts need), and C1 controls.
const HIDDEN_FORMATTING =
  /[\u0080-\u009F\u00AD\u061C\u180E\u200B\u200E\u200F\u202A-\u202E\u2060-\u2064\u2066-\u206F\uFEFF\uFFF9-\uFFFB]/;

/**
 * A credit line as stored: plain text on one line, nothing that reads as
 * markup, and nothing invisible that could change how it reads.
 */
export function isPlainCredit(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 1 &&
    value.length <= MAX_CREDIT_LENGTH &&
    value === value.trim() &&
    !/[\u0000-\u001F\u007F<>]/.test(value) &&
    !HIDDEN_FORMATTING.test(value) &&
    !/\s{2,}/.test(value)
  );
}

/**
 * The credit as a caption under the photograph. A file's own attribution
 * sometimes begins with "Photo:" already; the stored credit stays exactly as
 * the file asks, and only the caption's prefix is left out, so it never reads
 * "Photo: Photo:". Shared by the studio and the public artist page.
 */
export function photoCreditCaption(credit: string): string {
  return /^(?:photo|photograph|foto)(?:\s+by\b|\s*[:©])/i.test(credit)
    ? credit
    : `Photo: ${credit}`;
}

/** A stored artist photograph, with everything an attribution needs. */
export interface ArtistPhoto extends PhotoImage {
  fileName: string;
  /** "Some photo.jpg": the work's title, as Commons names it. */
  title: string;
  /** The file's description page: the source. */
  sourceUrl: string;
  /** The credit line the license asks for. */
  credit: string;
  license: PhotoLicense;
  modifications: string;
}

/** The photo columns of an artist row, as read from the database. */
export interface StoredArtistPhoto {
  photoUrl: string | null;
  photoCredit: string | null;
  photoLicense: string | null;
  photoSourceUrl: string | null;
  photoFileSha1: string | null;
  photoFileTimestamp: Date | string | null;
  photoChosenAt: Date | string | null;
}

/**
 * The photograph to show for an artist's stored columns, or null (show the
 * fallback). Every column must hold exactly what Refrain writes.
 */
export function artistPhotoOf(stored: StoredArtistPhoto): ArtistPhoto | null {
  const fileName = parsePhotoSourceUrl(stored.photoSourceUrl);
  if (!fileName) {
    return null;
  }
  if (stored.photoUrl !== photoThumbnailUrl(fileName, STORED_THUMBNAIL_WIDTH)) {
    return null;
  }
  const license = photoLicenseNamed(stored.photoLicense);
  if (!license || !isPlainCredit(stored.photoCredit)) {
    return null;
  }
  if (
    typeof stored.photoFileSha1 !== "string" ||
    !/^[0-9a-f]{40}$/.test(stored.photoFileSha1) ||
    stored.photoFileTimestamp === null ||
    stored.photoChosenAt === null
  ) {
    return null;
  }
  return {
    ...photoImageOf(fileName),
    fileName,
    title: photoTitleOf(fileName),
    sourceUrl: photoSourceUrl(fileName),
    credit: stored.photoCredit,
    license,
    modifications: PHOTO_MODIFICATIONS,
  };
}
